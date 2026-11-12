import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { IDEMPOTENT_METADATA } from './constants';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { assertPositive } from './options';

/** Per-route options for `@Idempotent()`. Unset values fall back to the module options. */
export interface IdempotentOptions {
  /**
   * Reject requests without an `Idempotency-Key` header with `400 IDEMPOTENCY_KEY_MISSING`.
   * When `false`, requests without the header run normally and nothing is stored.
   * Default: `true`.
   */
  required?: boolean;
  /** Overrides the module `ttlSeconds` for this route. */
  ttlSeconds?: number;
  /** Overrides the module `lockTimeoutSeconds` for this route. */
  lockTimeoutSeconds?: number;
  /** Overrides the module `cacheClientErrors` for this route. */
  cacheClientErrors?: boolean;
}

/**
 * Makes a route idempotent with the `Idempotency-Key` request header: the first request with
 * a key runs the handler and stores its response, and retries with the same key and payload
 * get the stored response back instead of running the handler again.
 *
 * Requires `IdempotencyModule.forRoot()` (or `forRootAsync()`) in the application.
 *
 * @example
 * ```ts
 * @Post()
 * @Idempotent()
 * create(@Body() dto: CreateOrderDto) { ... }
 * ```
 */
export function Idempotent(options: IdempotentOptions = {}): MethodDecorator {
  assertPositive(options.ttlSeconds, '@Idempotent() ttlSeconds');
  assertPositive(options.lockTimeoutSeconds, '@Idempotent() lockTimeoutSeconds');
  const metadata: IdempotentOptions = { ...options, required: options.required ?? true };
  return applyDecorators(
    SetMetadata(IDEMPOTENT_METADATA, metadata),
    UseInterceptors(IdempotencyInterceptor),
  );
}
