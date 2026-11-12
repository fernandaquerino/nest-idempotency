import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import { IdempotencyConfigurationError } from './errors';
import type { IdempotencyStorage } from './storage/storage.interface';

/**
 * The parts of the incoming request that the module and your callbacks read. An Express
 * `Request` satisfies it, so callbacks can declare `(req: Request) => ...`.
 */
export interface IdempotencyRequest {
  method: string;
  /** Path without the query string. */
  path: string;
  /** Path and query string as received. */
  originalUrl?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  /** Set by Express to the matched route. */
  route?: { path?: unknown };
  /** Set by authentication middleware such as Passport. */
  user?: unknown;
}

/** Options for `IdempotencyModule.forRoot()`. */
export interface IdempotencyModuleOptions {
  /** Where records are kept, for example `new RedisIdempotencyStorage({ client })`. */
  storage: IdempotencyStorage;

  /** How long a completed response is kept and replayed, in seconds. Default: `86_400` (24 h). */
  ttlSeconds?: number;

  /**
   * How long the lock of an in-flight request lives, in seconds. If the process dies while
   * handling a request, the key can be retried once this expires. Set it above your slowest
   * handler. Default: `60`.
   */
  lockTimeoutSeconds?: number;

  /**
   * Store and replay `4xx` responses, whether the handler returned them or threw an
   * `HttpException`. When `false`, the lock is released and a retry runs the handler again.
   * `5xx` responses are never stored. Default: `true`.
   */
  cacheClientErrors?: boolean;

  /** Value of the `Retry-After` header on `409` responses, in seconds. Default: `1`. */
  retryAfterSeconds?: number;

  /**
   * Computes the request fingerprint compared on retries. Default: SHA-256 of the method,
   * path and canonical JSON body (see `computeFingerprint`).
   */
  fingerprint?(request: IdempotencyRequest): string | Promise<string>;

  /**
   * Extra namespace for keys, typically the authenticated user, so that two clients that
   * pick the same key never collide: `scope: (req) => req.user?.id`. Return `undefined` or
   * `null` for no extra namespace. Keys are always namespaced by method and route.
   */
  scope?(request: IdempotencyRequest): string | number | undefined | null;
}

/** Builds options for `forRootAsync({ useClass })` or `forRootAsync({ useExisting })`. */
export interface IdempotencyOptionsFactory {
  createIdempotencyOptions(): IdempotencyModuleOptions | Promise<IdempotencyModuleOptions>;
}

/** Options for `IdempotencyModule.forRootAsync()`. Provide exactly one of the `use*` keys. */
export interface IdempotencyModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useFactory?: (...args: any[]) => IdempotencyModuleOptions | Promise<IdempotencyModuleOptions>;
  inject?: (InjectionToken | OptionalFactoryDependency)[];
  useClass?: Type<IdempotencyOptionsFactory>;
  useExisting?: InjectionToken;
}

/** @internal */
export interface ResolvedIdempotencyOptions {
  storage: IdempotencyStorage;
  ttlSeconds: number;
  lockTimeoutSeconds: number;
  cacheClientErrors: boolean;
  retryAfterSeconds: number;
  fingerprint?: IdempotencyModuleOptions['fingerprint'];
  scope?: IdempotencyModuleOptions['scope'];
}

/** @internal */
export function assertPositive(value: unknown, name: string): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new IdempotencyConfigurationError(`${name} must be a positive number, got ${value}`);
  }
}

/** @internal */
export function resolveOptions(options: IdempotencyModuleOptions): ResolvedIdempotencyOptions {
  if (!options || typeof options !== 'object') {
    throw new IdempotencyConfigurationError('IdempotencyModule options are required');
  }
  const { storage } = options;
  const methods = ['acquire', 'complete', 'release', 'get'] as const;
  if (!storage || methods.some((m) => typeof storage[m] !== 'function')) {
    throw new IdempotencyConfigurationError(
      'IdempotencyModule: `storage` must implement IdempotencyStorage (acquire, complete, release, get)',
    );
  }
  assertPositive(options.ttlSeconds, 'ttlSeconds');
  assertPositive(options.lockTimeoutSeconds, 'lockTimeoutSeconds');
  assertPositive(options.retryAfterSeconds, 'retryAfterSeconds');
  for (const fn of ['fingerprint', 'scope'] as const) {
    if (options[fn] !== undefined && typeof options[fn] !== 'function') {
      throw new IdempotencyConfigurationError(`IdempotencyModule: \`${fn}\` must be a function`);
    }
  }

  return {
    storage,
    ttlSeconds: options.ttlSeconds ?? 86_400,
    lockTimeoutSeconds: options.lockTimeoutSeconds ?? 60,
    cacheClientErrors: options.cacheClientErrors ?? true,
    retryAfterSeconds: options.retryAfterSeconds ?? 1,
    fingerprint: options.fingerprint,
    scope: options.scope,
  };
}
