import Redis from 'ioredis';
import { RedisIdempotencyStorage } from 'nest-idempotency';
import { runBehaviourSuite } from './behaviour';

const REDIS_URL = process.env.REDIS_URL;
let client: Redis | undefined;

runBehaviourSuite({
  name: 'redis',
  skip: !REDIS_URL,
  createStorage: () => {
    client = new Redis(REDIS_URL as string);
    return new RedisIdempotencyStorage({ client, keyPrefix: 'test:e2e:' });
  },
  destroyStorage: async () => {
    await client?.quit();
  },
});
