import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import {
  IdempotencyModule,
  MemoryIdempotencyStorage,
  RedisIdempotencyStorage,
  type IdempotencyStorage,
} from 'nest-idempotency';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/** Uses Redis when REDIS_URL is set, otherwise in-memory storage. */
export function createStorage(redisUrl = process.env.REDIS_URL): IdempotencyStorage {
  if (redisUrl) {
    return new RedisIdempotencyStorage({ client: new Redis(redisUrl), keyPrefix: 'example:' });
  }
  return new MemoryIdempotencyStorage();
}

@Module({
  imports: [
    IdempotencyModule.forRootAsync({
      useFactory: () => ({
        storage: createStorage(),
        ttlSeconds: 86_400,
        lockTimeoutSeconds: 30,
        // Each user gets their own key namespace. A real app would use req.user from auth.
        scope: (req) => req.headers['x-user-id'] as string | undefined,
      }),
    }),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class AppModule {}
