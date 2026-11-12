import Redis, { type Cluster } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RedisIdempotencyStorage, type RedisClientLike } from '../../src/storage/redis.storage';
import { runStorageContract } from './storage-contract';

const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.warn('REDIS_URL is not set: skipping the Redis storage contract suite.');
}

let client: Redis | undefined;

runStorageContract({
  name: 'RedisIdempotencyStorage',
  skip: !REDIS_URL,
  create: () => {
    client = new Redis(REDIS_URL as string);
    return new RedisIdempotencyStorage({ client, keyPrefix: 'test:contract:' });
  },
  destroy: async () => {
    await client?.quit();
  },
});

describe.skipIf(!REDIS_URL)('RedisIdempotencyStorage specifics', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(REDIS_URL as string);
  });

  afterAll(async () => {
    await redis.quit();
  });

  it('accepts an ioredis client without casts', () => {
    // Compile-time check: both ioredis client classes satisfy RedisClientLike.
    const _types: [RedisClientLike, RedisClientLike] = [redis, null as unknown as Cluster];
    expect(_types).toHaveLength(2);
    expect(() => new RedisIdempotencyStorage({ client: redis })).not.toThrow();
  });

  it('requires a client', () => {
    expect(
      () =>
        new RedisIdempotencyStorage({} as ConstructorParameters<typeof RedisIdempotencyStorage>[0]),
    ).toThrow(TypeError);
  });

  it('writes under the key prefix with a server-side expiry', async () => {
    const storage = new RedisIdempotencyStorage({ client: redis, keyPrefix: 'test:prefix:' });
    await storage.acquire('abc', { fingerprint: 'fp', lockTimeoutMs: 5_000 });
    const ttl = await redis.pttl('test:prefix:abc');
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(5_000);
    await redis.del('test:prefix:abc');
  });

  it('uses the default prefix "idempotency:"', async () => {
    const storage = new RedisIdempotencyStorage({ client: redis });
    const key = `default-prefix-${Date.now()}`;
    await storage.acquire(key, { fingerprint: 'fp', lockTimeoutMs: 5_000 });
    expect(await redis.exists(`idempotency:${key}`)).toBe(1);
    await redis.del(`idempotency:${key}`);
  });

  it('recovers when the script cache is flushed', async () => {
    const storage = new RedisIdempotencyStorage({ client: redis, keyPrefix: 'test:flush:' });
    await storage.get('warm-up');
    await redis.script('FLUSH');
    await expect(storage.get('missing')).resolves.toBeNull();
  });

  it('rejects non-positive timeouts', async () => {
    const storage = new RedisIdempotencyStorage({ client: redis, keyPrefix: 'test:range:' });
    await expect(storage.acquire('k', { fingerprint: 'fp', lockTimeoutMs: 0 })).rejects.toThrow(
      RangeError,
    );
  });
});
