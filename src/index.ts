// Public API of nest-idempotency. Everything exported here is public and documented in the
// README; nothing else is.

export { IdempotencyModule } from './idempotency.module';
export type {
  IdempotencyModuleAsyncOptions,
  IdempotencyModuleOptions,
  IdempotencyOptionsFactory,
  IdempotencyRequest,
} from './options';
export { Idempotent, type IdempotentOptions } from './idempotent.decorator';
export { IDEMPOTENCY_MODULE_OPTIONS, IDEMPOTENT_REPLAYED_HEADER } from './constants';
export { IDEMPOTENCY_KEY_HEADER } from './key';

export {
  IdempotencyConfigurationError,
  IdempotencyErrorCode,
  IdempotencyException,
  type IdempotencyErrorBody,
} from './errors';

export { canonicalJson, computeFingerprint, type FingerprintInput } from './fingerprint';

export type {
  AcquireOptions,
  AcquireResult,
  CompletedRecord,
  CompleteOptions,
  IdempotencyRecord,
  IdempotencyStorage,
  InProgressRecord,
  StoredBody,
  StoredResponse,
} from './storage/storage.interface';
export {
  MemoryIdempotencyStorage,
  type MemoryIdempotencyStorageOptions,
} from './storage/memory.storage';
export {
  RedisIdempotencyStorage,
  type RedisClientLike,
  type RedisIdempotencyStorageOptions,
} from './storage/redis.storage';
