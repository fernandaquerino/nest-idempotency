import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { IdempotencyStorage, StoredResponse } from '../../src/storage/storage.interface';

export interface StorageContractHarness {
  /** Adapter name used in the test titles. */
  name: string;
  /** Creates (or returns) the adapter under test. Called once before the suite. */
  create: () => Promise<IdempotencyStorage> | IdempotencyStorage;
  /** Releases resources after the suite. */
  destroy?: (storage: IdempotencyStorage) => Promise<void> | void;
  /** Skip the whole suite, for example when the backing service is not configured. */
  skip?: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const LONG = 60_000;
const SHORT = 150;
const PAST_SHORT = 400;

const jsonResponse: StoredResponse = {
  statusCode: 201,
  headers: { 'content-type': 'application/json; charset=utf-8', location: '/orders/1' },
  body: { type: 'json', value: { id: 1, items: [{ sku: 'a', qty: 2 }], note: 'ünïcødé ✓' } },
};

/**
 * The storage contract. Every `IdempotencyStorage` adapter must pass this suite unchanged.
 * Timing-based cases use real time, so adapters with server-side expiry are covered too.
 */
export function runStorageContract(harness: StorageContractHarness): void {
  describe.skipIf(harness.skip ?? false)(`storage contract: ${harness.name}`, () => {
    let storage: IdempotencyStorage;
    let key: string;

    beforeAll(async () => {
      storage = await harness.create();
    });

    afterAll(async () => {
      if (storage) await harness.destroy?.(storage);
    });

    beforeEach(() => {
      key = `contract:${randomUUID()}`;
    });

    describe('get', () => {
      it('returns null for an unknown key', async () => {
        expect(await storage.get(key)).toBeNull();
      });
    });

    describe('acquire', () => {
      it('takes the lock for a new key and returns a token', async () => {
        const result = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        expect(result.acquired).toBe(true);
        if (result.acquired) expect(result.lockToken).toEqual(expect.any(String));
      });

      it('stores an IN_PROGRESS record with the fingerprint and lock expiry', async () => {
        const before = Date.now();
        await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        const record = await storage.get(key);
        expect(record).toMatchObject({ status: 'IN_PROGRESS', fingerprint: 'fp1' });
        if (record?.status !== 'IN_PROGRESS') throw new Error('expected IN_PROGRESS');
        expect(record.createdAt).toBeGreaterThanOrEqual(before - 1000);
        expect(record.lockExpiresAt).toBeGreaterThanOrEqual(record.createdAt + LONG - 1000);
        expect(record.lockExpiresAt).toBeLessThanOrEqual(Date.now() + LONG + 1000);
      });

      it('returns the existing IN_PROGRESS record without changing it', async () => {
        await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        const second = await storage.acquire(key, { fingerprint: 'fp2', lockTimeoutMs: LONG });
        expect(second.acquired).toBe(false);
        if (!second.acquired) {
          expect(second.record).toMatchObject({ status: 'IN_PROGRESS', fingerprint: 'fp1' });
        }
      });

      it('returns the COMPLETED record once a response is stored', async () => {
        const first = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        if (!first.acquired) throw new Error('expected lock');
        await storage.complete(key, {
          fingerprint: 'fp1',
          lockToken: first.lockToken,
          response: jsonResponse,
          ttlMs: LONG,
        });
        const second = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        expect(second.acquired).toBe(false);
        if (!second.acquired) {
          expect(second.record).toMatchObject({ status: 'COMPLETED', fingerprint: 'fp1' });
        }
      });

      it('gives each lock a different token', async () => {
        const a = await storage.acquire(key, { fingerprint: 'fp', lockTimeoutMs: LONG });
        if (!a.acquired) throw new Error('expected lock');
        await storage.release(key, a.lockToken);
        const b = await storage.acquire(key, { fingerprint: 'fp', lockTimeoutMs: LONG });
        if (!b.acquired) throw new Error('expected lock');
        expect(b.lockToken).not.toBe(a.lockToken);
      });

      it('keeps keys independent', async () => {
        const other = `${key}:other`;
        const a = await storage.acquire(key, { fingerprint: 'fp', lockTimeoutMs: LONG });
        const b = await storage.acquire(other, { fingerprint: 'fp', lockTimeoutMs: LONG });
        expect(a.acquired).toBe(true);
        expect(b.acquired).toBe(true);
      });

      it('grants the lock to exactly one of 20 concurrent callers', async () => {
        const results = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            storage.acquire(key, { fingerprint: `fp${i}`, lockTimeoutMs: LONG }),
          ),
        );
        const winners = results.filter((r) => r.acquired);
        expect(winners).toHaveLength(1);
        const losers = results.filter((r) => !r.acquired);
        expect(losers).toHaveLength(19);
        for (const loser of losers) {
          if (!loser.acquired) expect(loser.record.status).toBe('IN_PROGRESS');
        }
      });

      it('lets a new caller take the key after the lock expires', async () => {
        const first = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: SHORT });
        expect(first.acquired).toBe(true);
        await sleep(PAST_SHORT);
        expect(await storage.get(key)).toBeNull();
        const second = await storage.acquire(key, { fingerprint: 'fp2', lockTimeoutMs: LONG });
        expect(second.acquired).toBe(true);
      });
    });

    describe('complete', () => {
      it('stores the response so get returns it exactly', async () => {
        const lock = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        if (!lock.acquired) throw new Error('expected lock');
        const before = Date.now();
        const ok = await storage.complete(key, {
          fingerprint: 'fp1',
          lockToken: lock.lockToken,
          response: jsonResponse,
          ttlMs: LONG,
        });
        expect(ok).toBe(true);
        const record = await storage.get(key);
        expect(record).toMatchObject({
          status: 'COMPLETED',
          fingerprint: 'fp1',
          response: jsonResponse,
        });
        if (record?.status !== 'COMPLETED') throw new Error('expected COMPLETED');
        expect(record.completedAt).toBeGreaterThanOrEqual(before - 1000);
      });

      it.each<[string, StoredResponse]>([
        ['text', { statusCode: 200, headers: {}, body: { type: 'text', value: 'plain ✓' } }],
        ['binary', { statusCode: 200, headers: {}, body: { type: 'binary', base64: 'AAEC/w==' } }],
        ['empty', { statusCode: 204, headers: {}, body: { type: 'empty' } }],
        ['json null', { statusCode: 200, headers: {}, body: { type: 'json', value: null } }],
        ['json scalar', { statusCode: 200, headers: {}, body: { type: 'json', value: 42 } }],
        [
          'client error',
          {
            statusCode: 404,
            headers: { 'content-type': 'application/json' },
            body: { type: 'json', value: { statusCode: 404, message: 'Not Found' } },
          },
        ],
      ])('round-trips a %s body', async (_label, response) => {
        const lock = await storage.acquire(key, { fingerprint: 'fp', lockTimeoutMs: LONG });
        if (!lock.acquired) throw new Error('expected lock');
        await storage.complete(key, {
          fingerprint: 'fp',
          lockToken: lock.lockToken,
          response,
          ttlMs: LONG,
        });
        const record = await storage.get(key);
        expect(record?.status === 'COMPLETED' && record.response).toEqual(response);
      });

      it('refuses a wrong token and leaves the lock in place', async () => {
        await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        const ok = await storage.complete(key, {
          fingerprint: 'fp1',
          lockToken: 'not-the-token',
          response: jsonResponse,
          ttlMs: LONG,
        });
        expect(ok).toBe(false);
        expect(await storage.get(key)).toMatchObject({ status: 'IN_PROGRESS' });
      });

      it('refuses to overwrite a stored response', async () => {
        const lock = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        if (!lock.acquired) throw new Error('expected lock');
        const options = {
          fingerprint: 'fp1',
          lockToken: lock.lockToken,
          response: jsonResponse,
          ttlMs: LONG,
        };
        expect(await storage.complete(key, options)).toBe(true);
        const other = { ...jsonResponse, statusCode: 500 };
        expect(await storage.complete(key, { ...options, response: other })).toBe(false);
        const record = await storage.get(key);
        expect(record?.status === 'COMPLETED' && record.response.statusCode).toBe(201);
      });

      it('refuses when another caller took the key after the lock expired', async () => {
        const stale = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: SHORT });
        if (!stale.acquired) throw new Error('expected lock');
        await sleep(PAST_SHORT);
        const fresh = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        expect(fresh.acquired).toBe(true);
        const ok = await storage.complete(key, {
          fingerprint: 'fp1',
          lockToken: stale.lockToken,
          response: jsonResponse,
          ttlMs: LONG,
        });
        expect(ok).toBe(false);
        expect(await storage.get(key)).toMatchObject({ status: 'IN_PROGRESS' });
      });

      it('stores the response when the lock expired and nobody took the key', async () => {
        const lock = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: SHORT });
        if (!lock.acquired) throw new Error('expected lock');
        await sleep(PAST_SHORT);
        const ok = await storage.complete(key, {
          fingerprint: 'fp1',
          lockToken: lock.lockToken,
          response: jsonResponse,
          ttlMs: LONG,
        });
        expect(ok).toBe(true);
        expect(await storage.get(key)).toMatchObject({ status: 'COMPLETED', fingerprint: 'fp1' });
      });

      it('expires the stored response after ttlMs', async () => {
        const lock = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        if (!lock.acquired) throw new Error('expected lock');
        await storage.complete(key, {
          fingerprint: 'fp1',
          lockToken: lock.lockToken,
          response: jsonResponse,
          ttlMs: SHORT,
        });
        expect(await storage.get(key)).not.toBeNull();
        await sleep(PAST_SHORT);
        expect(await storage.get(key)).toBeNull();
        const again = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        expect(again.acquired).toBe(true);
      });

      it('does not let callers mutate stored data', async () => {
        const lock = await storage.acquire(key, { fingerprint: 'fp', lockTimeoutMs: LONG });
        if (!lock.acquired) throw new Error('expected lock');
        const body = { type: 'json' as const, value: { n: 1 } };
        const response = { statusCode: 200, headers: { a: 'b' }, body };
        await storage.complete(key, {
          fingerprint: 'fp',
          lockToken: lock.lockToken,
          response,
          ttlMs: LONG,
        });
        (body.value as { n: number }).n = 2;
        const first = await storage.get(key);
        if (first?.status !== 'COMPLETED') throw new Error('expected COMPLETED');
        expect(first.response.body).toEqual({ type: 'json', value: { n: 1 } });
        (first.response.headers as Record<string, string>).a = 'changed';
        const second = await storage.get(key);
        expect(second?.status === 'COMPLETED' && second.response.headers.a).toBe('b');
      });
    });

    describe('release', () => {
      it('deletes the lock so the key can be acquired again', async () => {
        const lock = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        if (!lock.acquired) throw new Error('expected lock');
        expect(await storage.release(key, lock.lockToken)).toBe(true);
        expect(await storage.get(key)).toBeNull();
        const again = await storage.acquire(key, { fingerprint: 'fp2', lockTimeoutMs: LONG });
        expect(again.acquired).toBe(true);
      });

      it('refuses a wrong token', async () => {
        await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        expect(await storage.release(key, 'not-the-token')).toBe(false);
        expect(await storage.get(key)).toMatchObject({ status: 'IN_PROGRESS' });
      });

      it('returns false for an unknown key', async () => {
        expect(await storage.release(key, 'any')).toBe(false);
      });

      it('never deletes a stored response, even with the right token', async () => {
        const lock = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: LONG });
        if (!lock.acquired) throw new Error('expected lock');
        await storage.complete(key, {
          fingerprint: 'fp1',
          lockToken: lock.lockToken,
          response: jsonResponse,
          ttlMs: LONG,
        });
        expect(await storage.release(key, lock.lockToken)).toBe(false);
        expect(await storage.get(key)).toMatchObject({ status: 'COMPLETED' });
      });

      it('does not release a lock taken by someone else after expiry', async () => {
        const stale = await storage.acquire(key, { fingerprint: 'fp1', lockTimeoutMs: SHORT });
        if (!stale.acquired) throw new Error('expected lock');
        await sleep(PAST_SHORT);
        await storage.acquire(key, { fingerprint: 'fp2', lockTimeoutMs: LONG });
        expect(await storage.release(key, stale.lockToken)).toBe(false);
        expect(await storage.get(key)).toMatchObject({ status: 'IN_PROGRESS', fingerprint: 'fp2' });
      });
    });
  });
}
