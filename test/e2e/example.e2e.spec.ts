import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../examples/basic-app/src/app.module';

// Keeps examples/basic-app working: the README walks through exactly this flow.
describe('examples/basic-app', () => {
  let app: INestApplication;
  const redisUrl = process.env.REDIS_URL;

  beforeAll(async () => {
    delete process.env.REDIS_URL; // use in-memory storage
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0);
  });

  afterAll(async () => {
    await app?.close();
    if (redisUrl !== undefined) process.env.REDIS_URL = redisUrl;
  });

  it('creates one order for a request and its retries', async () => {
    const server = app.getHttpServer();
    const order = { item: 'book', quantity: 1 };

    const missing = await request(server).post('/orders').send(order);
    expect(missing.status).toBe(400);

    const first = request(server)
      .post('/orders')
      .set('Idempotency-Key', 'order-123')
      .send(order)
      .then((r) => r);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const during = await request(server)
      .post('/orders')
      .set('Idempotency-Key', 'order-123')
      .send(order);
    expect(during.status).toBe(409);

    const created = await first;
    expect(created.status).toBe(201);

    const retry = await request(server)
      .post('/orders')
      .set('Idempotency-Key', 'order-123')
      .send(order);
    expect(retry.status).toBe(201);
    expect(retry.body).toEqual(created.body);
    expect(retry.headers['idempotent-replayed']).toBe('true');

    const reused = await request(server)
      .post('/orders')
      .set('Idempotency-Key', 'order-123')
      .send({ item: 'pen', quantity: 2 });
    expect(reused.status).toBe(422);

    const count = await request(server).get('/orders/count');
    expect(count.body).toEqual({ count: 1 });
  });

  it('runs the optional route without a key', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders/quote')
      .send({ item: 'book', quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body.total).toBeCloseTo(19.98);
  });
});
