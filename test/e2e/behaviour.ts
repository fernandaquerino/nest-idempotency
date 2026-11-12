import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { IdempotencyStorage } from 'nest-idempotency';
import { createApp, RecordingStorage, sleep, type Calls, type Gate } from './app';

export interface BehaviourHarness {
  name: string;
  skip?: boolean;
  createStorage: () => Promise<IdempotencyStorage> | IdempotencyStorage;
  destroyStorage?: (storage: IdempotencyStorage) => Promise<void> | void;
}

let keyCounter = 0;
const newKey = () => `key-${process.pid}-${Date.now()}-${++keyCounter}`;

/**
 * One test per row of the behaviour table in docs/SPEC.md, run against a real Nest app over
 * HTTP. Shared by every storage adapter.
 */
export function runBehaviourSuite(harness: BehaviourHarness): void {
  describe.skipIf(harness.skip ?? false)(`behaviour (${harness.name} storage)`, () => {
    let storage: IdempotencyStorage;
    let recording: RecordingStorage;
    let app: INestApplication;
    let calls: Calls;
    let gate: Gate;
    let key: string;

    const http = () => request(app.getHttpServer());

    beforeAll(async () => {
      storage = await harness.createStorage();
    });

    afterAll(async () => {
      if (storage) await harness.destroyStorage?.(storage);
    });

    beforeEach(async () => {
      recording = new RecordingStorage(storage);
      ({ app, calls, gate } = await createApp({ storage: recording }));
      key = newKey();
    });

    afterEach(async () => {
      gate.open();
      await app.close();
    });

    describe('no header on an @Idempotent() route', () => {
      it('responds 400 IDEMPOTENCY_KEY_MISSING without running the handler', async () => {
        const res = await http().post('/orders').send({ amount: 1 });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({
          statusCode: 400,
          error: 'Bad Request',
          code: 'IDEMPOTENCY_KEY_MISSING',
          message: expect.any(String),
        });
        expect(calls.of('create')).toBe(0);
        expect(recording.acquired).toHaveLength(0);
      });

      it('treats an empty header as missing', async () => {
        const res = await http().post('/orders').set('Idempotency-Key', '').send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('IDEMPOTENCY_KEY_MISSING');
      });
    });

    describe('no header and required: false', () => {
      it('runs the handler every time and stores nothing', async () => {
        const first = await http().post('/orders/optional').send({ a: 1 });
        const second = await http().post('/orders/optional').send({ a: 1 });
        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        expect(second.body.call).toBe(2);
        expect(second.headers['idempotent-replayed']).toBeUndefined();
        expect(calls.of('optional')).toBe(2);
        expect(recording.acquired).toHaveLength(0);
      });

      it('still deduplicates when a key is sent', async () => {
        await http().post('/orders/optional').set('Idempotency-Key', key).send({ a: 1 });
        const second = await http()
          .post('/orders/optional')
          .set('Idempotency-Key', key)
          .send({ a: 1 });
        expect(second.headers['idempotent-replayed']).toBe('true');
        expect(calls.of('optional')).toBe(1);
      });
    });

    describe('invalid key format', () => {
      it.each([
        ['too long', 'x'.repeat(256)],
        ['containing a space', 'has space'],
        ['an empty quoted string', '""'],
      ])('responds 400 IDEMPOTENCY_KEY_INVALID for a key %s', async (_label, value) => {
        const res = await http().post('/orders').set('Idempotency-Key', value).send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('IDEMPOTENCY_KEY_INVALID');
        expect(calls.of('create')).toBe(0);
      });

      it('responds 400 IDEMPOTENCY_KEY_INVALID for repeated headers', async () => {
        // superagent sends an array as repeated headers; its types only allow that for Cookie.
        const twoKeys = ['a', 'b'] as unknown as string;
        const res = await http().post('/orders').set('Idempotency-Key', twoKeys).send({});
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('IDEMPOTENCY_KEY_INVALID');
      });

      it('accepts a 255-character key', async () => {
        const res = await http().post('/orders').set('Idempotency-Key', 'k'.repeat(255)).send({});
        expect(res.status).toBe(201);
      });
    });

    describe('first request with a key', () => {
      it('holds an IN_PROGRESS lock while the handler runs, then stores COMPLETED', async () => {
        const pending = http().post('/orders/slow').set('Idempotency-Key', key).send({});
        const done = pending.then((r) => r);
        await sleep(100);
        expect(await storage.get(recording.lastKey())).toMatchObject({ status: 'IN_PROGRESS' });
        const res = await done;
        expect(res.status).toBe(201);
        expect(res.headers['idempotent-replayed']).toBeUndefined();
        const record = await storage.get(recording.lastKey());
        expect(record).toMatchObject({
          status: 'COMPLETED',
          response: { statusCode: 201, body: { type: 'json', value: { call: 1 } } },
        });
      });
    });

    describe('same key and same fingerprint, completed', () => {
      it('replays status, body and allow-listed headers with Idempotent-Replayed: true', async () => {
        const first = await http()
          .post('/orders/headers')
          .set('Idempotency-Key', key)
          .send({ amount: 10 });
        const second = await http()
          .post('/orders/headers')
          .set('Idempotency-Key', key)
          .send({ amount: 10 });

        expect(calls.of('headers')).toBe(1);
        expect(first.status).toBe(201);
        expect(first.headers['idempotent-replayed']).toBeUndefined();
        expect(second.status).toBe(201);
        expect(second.body).toEqual(first.body);
        expect(second.text).toBe(first.text);
        expect(second.headers['idempotent-replayed']).toBe('true');
        expect(second.headers['content-type']).toBe(first.headers['content-type']);
        expect(second.headers.location).toBe('/orders/1');
        // Response-specific headers are not on the allow-list. Nest's @Header() sets them
        // again on every request, so check the stored record instead.
        const record = await storage.get(recording.lastKey());
        expect(record?.status === 'COMPLETED' && record.response.headers).toEqual({
          location: '/orders/1',
        });
      });

      it('replays even when the JSON body has its keys in another order', async () => {
        const first = await http().post('/orders').set('Idempotency-Key', key).send({ a: 1, b: 2 });
        const second = await http()
          .post('/orders')
          .set('Idempotency-Key', key)
          .send({ b: 2, a: 1 });
        expect(second.headers['idempotent-replayed']).toBe('true');
        expect(second.body).toEqual(first.body);
        expect(calls.of('create')).toBe(1);
      });

      it('treats a quoted Structured Field key like the bare key', async () => {
        await http().post('/orders').set('Idempotency-Key', key).send({});
        const second = await http().post('/orders').set('Idempotency-Key', `"${key}"`).send({});
        expect(second.headers['idempotent-replayed']).toBe('true');
        expect(calls.of('create')).toBe(1);
      });

      it.each([
        ['text', '/orders/text', 201],
        ['binary', '/orders/binary', 201],
        ['empty 204', '/orders/empty', 204],
      ])('replays a %s response byte for byte', async (_label, path, status) => {
        const first = await http().post(path).set('Idempotency-Key', key).buffer(true);
        const second = await http().post(path).set('Idempotency-Key', key).buffer(true);
        expect(first.status).toBe(status);
        expect(second.status).toBe(status);
        expect(second.headers['content-type']).toBe(first.headers['content-type']);
        const raw = (r: request.Response) =>
          Buffer.isBuffer(r.body) ? r.body : Buffer.from(r.text ?? '');
        expect(raw(second)).toEqual(raw(first));
        if (status !== 204) expect(raw(first).length).toBeGreaterThan(0);
        expect(second.headers['idempotent-replayed']).toBe('true');
      });

      it('works for GET routes too', async () => {
        await http().get('/orders/ping').set('Idempotency-Key', key);
        const second = await http().get('/orders/ping').set('Idempotency-Key', key);
        expect(second.status).toBe(200);
        expect(second.body).toEqual({ call: 1 });
      });
    });

    describe('same key while the first request is still running', () => {
      it('responds 409 IDEMPOTENCY_REQUEST_IN_PROGRESS with Retry-After', async () => {
        const first = http()
          .post('/orders/slow')
          .set('Idempotency-Key', key)
          .send({})
          .then((r) => r);
        await sleep(100);
        const second = await http().post('/orders/slow').set('Idempotency-Key', key).send({});
        expect(second.status).toBe(409);
        expect(second.body).toMatchObject({
          statusCode: 409,
          error: 'Conflict',
          code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        });
        expect(second.headers['retry-after']).toBe('1');
        expect((await first).status).toBe(201);
        expect(calls.of('slow')).toBe(1);
      });

      it('runs the handler once for 20 concurrent requests with the same key', async () => {
        const responses = await Promise.all(
          Array.from({ length: 20 }, () =>
            http().post('/orders/slow').set('Idempotency-Key', key).send({ delayMs: 300 }),
          ),
        );
        expect(calls.of('slow')).toBe(1);
        const statuses = responses.map((r) => r.status).sort();
        expect(statuses.filter((s) => s === 201)).toHaveLength(1);
        expect(statuses.filter((s) => s === 409)).toHaveLength(19);

        const retry = await http()
          .post('/orders/slow')
          .set('Idempotency-Key', key)
          .send({ delayMs: 300 });
        expect(retry.status).toBe(201);
        expect(retry.headers['idempotent-replayed']).toBe('true');
        expect(retry.body).toEqual({ call: 1 });
        expect(calls.of('slow')).toBe(1);
      });
    });

    describe('same key with a different fingerprint', () => {
      it('responds 422 IDEMPOTENCY_KEY_REUSED once completed', async () => {
        await http().post('/orders').set('Idempotency-Key', key).send({ amount: 10 });
        const res = await http().post('/orders').set('Idempotency-Key', key).send({ amount: 99 });
        expect(res.status).toBe(422);
        expect(res.body).toMatchObject({
          statusCode: 422,
          error: 'Unprocessable Entity',
          code: 'IDEMPOTENCY_KEY_REUSED',
        });
        expect(calls.of('create')).toBe(1);
      });

      it('responds 422 even while the first request is still running', async () => {
        const first = http()
          .post('/orders/slow')
          .set('Idempotency-Key', key)
          .send({ delayMs: 300 })
          .then((r) => r);
        await sleep(100);
        const res = await http()
          .post('/orders/slow')
          .set('Idempotency-Key', key)
          .send({ delayMs: 301 });
        expect(res.status).toBe(422);
        await first;
      });

      it('responds 422 when the same key is reused on another resource of the same route', async () => {
        await http().post('/orders/1/pay').set('Idempotency-Key', key);
        const res = await http().post('/orders/2/pay').set('Idempotency-Key', key);
        expect(res.status).toBe(422);
        expect(calls.of('pay')).toBe(1);
      });
    });

    describe('handler throws 5xx or the process dies', () => {
      it('releases the lock after an HttpException 5xx so a retry runs again', async () => {
        const first = await http().post('/orders/server-error').set('Idempotency-Key', key);
        expect(first.status).toBe(500);
        expect(await storage.get(recording.lastKey())).toBeNull();
        const retry = await http().post('/orders/server-error').set('Idempotency-Key', key);
        expect(retry.status).toBe(201);
        expect(retry.body).toEqual({ call: 2 });
        expect(retry.headers['idempotent-replayed']).toBeUndefined();
      });

      it('releases the lock after an unexpected error', async () => {
        const first = await http().post('/orders/crash').set('Idempotency-Key', key);
        expect(first.status).toBe(500);
        const retry = await http().post('/orders/crash').set('Idempotency-Key', key);
        expect(retry.status).toBe(201);
        expect(calls.of('crash')).toBe(2);
      });

      it('lets a retry run once the lock of a stuck request expires', async () => {
        // The first request never finishes on its own, like a process that died mid-request.
        const stuck = http()
          .post('/orders/gated')
          .set('Idempotency-Key', key)
          .then((r) => r);
        await sleep(100);
        const during = await http().post('/orders/gated').set('Idempotency-Key', key);
        expect(during.status).toBe(409);

        await sleep(700); // lockTimeoutSeconds is 0.5 on this route
        const after = await http().post('/orders/gated').set('Idempotency-Key', key);
        expect(after.status).toBe(201);
        expect(after.body).toEqual({ call: 2 });

        gate.open();
        expect((await stuck).status).toBe(201);
        // The stuck request lost its lock, so it must not overwrite the stored response.
        const replay = await http().post('/orders/gated').set('Idempotency-Key', key);
        expect(replay.body).toEqual({ call: 2 });
        expect(calls.of('gated')).toBe(2);
      });
    });

    describe('handler returns or throws 4xx', () => {
      it('stores and replays a thrown HttpException', async () => {
        const first = await http().post('/orders/not-found').set('Idempotency-Key', key);
        const second = await http().post('/orders/not-found').set('Idempotency-Key', key);
        expect(first.status).toBe(404);
        expect(second.status).toBe(404);
        expect(second.body).toEqual(first.body);
        expect(second.body).toEqual({
          statusCode: 404,
          error: 'Not Found',
          message: 'Order not found',
        });
        expect(second.headers['idempotent-replayed']).toBe('true');
        expect(calls.of('not-found')).toBe(1);
      });

      it('stores and replays a returned 4xx response', async () => {
        const first = await http()
          .post('/orders/returned-client-error')
          .set('Idempotency-Key', key);
        const second = await http()
          .post('/orders/returned-client-error')
          .set('Idempotency-Key', key);
        expect(first.status).toBe(400);
        expect(second.status).toBe(400);
        expect(second.body).toEqual({ error: 'declined', call: 1 });
        expect(second.headers['idempotent-replayed']).toBe('true');
      });

      it('stores and replays a 4xx thrown by a pipe', async () => {
        const first = await http().post('/orders/pipe?n=abc').set('Idempotency-Key', key);
        const second = await http().post('/orders/pipe?n=abc').set('Idempotency-Key', key);
        expect(first.status).toBe(400);
        expect(second.status).toBe(400);
        expect(second.body).toEqual(first.body);
        expect(second.headers['idempotent-replayed']).toBe('true');
      });

      it('does not store 4xx when cacheClientErrors is false on the route', async () => {
        const first = await http()
          .post('/orders/no-cache-client-errors')
          .set('Idempotency-Key', key);
        const second = await http()
          .post('/orders/no-cache-client-errors')
          .set('Idempotency-Key', key);
        expect(first.status).toBe(400);
        expect(second.status).toBe(400);
        expect(second.headers['idempotent-replayed']).toBeUndefined();
        expect(calls.of('no-cache-client-errors')).toBe(2);
      });
    });

    describe('key scope', () => {
      it('namespaces keys per route', async () => {
        await http().post('/orders').set('Idempotency-Key', key).send({});
        const other = await http().post('/orders/other').set('Idempotency-Key', key).send({});
        expect(other.status).toBe(201);
        expect(other.headers['idempotent-replayed']).toBeUndefined();
        expect(calls.of('other')).toBe(1);
      });

      it('leaves routes without @Idempotent() alone', async () => {
        await http().post('/orders/plain').set('Idempotency-Key', key);
        const second = await http().post('/orders/plain').set('Idempotency-Key', key);
        expect(second.body).toEqual({ call: 2 });
        expect(recording.acquired).toHaveLength(0);
      });
    });
  });
}
