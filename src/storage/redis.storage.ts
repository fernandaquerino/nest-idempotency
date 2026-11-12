import { createHash, randomUUID } from 'node:crypto';
import type {
  AcquireOptions,
  AcquireResult,
  CompleteOptions,
  IdempotencyRecord,
  IdempotencyStorage,
  StoredResponse,
} from './storage.interface';

/**
 * The subset of an `ioredis` client (`Redis` or `Cluster`) that the adapter uses. Typed
 * structurally so that the package's type declarations do not require `ioredis`.
 */
export interface RedisClientLike {
  evalsha(sha1: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
}

/** Options for {@link RedisIdempotencyStorage}. */
export interface RedisIdempotencyStorageOptions {
  /** An `ioredis` `Redis` or `Cluster` instance. The adapter never closes it. */
  client: RedisClientLike;
  /** Prefix added to every Redis key. Default: `'idempotency:'`. */
  keyPrefix?: string;
}

/*
 * Each record is a Redis hash with short field names:
 *   s = status, t = lock token, f = fingerprint, c = createdAt, l = lockExpiresAt,
 *   d = completedAt, r = response JSON
 * The key's PX expiry is the lock timeout while IN_PROGRESS and the TTL once COMPLETED.
 * Every write runs inside one Lua script, which Redis executes atomically.
 */

// KEYS[1] key; ARGV token, fingerprint, createdAt, lockExpiresAt, lockTimeoutMs
const ACQUIRE = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return redis.call('HGETALL', KEYS[1])
end
redis.call('HSET', KEYS[1], 's', 'IN_PROGRESS', 't', ARGV[1], 'f', ARGV[2], 'c', ARGV[3], 'l', ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return false
`;

// KEYS[1] key; ARGV token, fingerprint, completedAt, response JSON, ttlMs
const COMPLETE = `
local createdAt = ARGV[3]
if redis.call('EXISTS', KEYS[1]) == 1 then
  local cur = redis.call('HMGET', KEYS[1], 's', 't', 'c')
  if cur[1] ~= 'IN_PROGRESS' or cur[2] ~= ARGV[1] then
    return 0
  end
  createdAt = cur[3]
  redis.call('DEL', KEYS[1])
end
redis.call('HSET', KEYS[1], 's', 'COMPLETED', 't', ARGV[1], 'f', ARGV[2], 'c', createdAt, 'd', ARGV[3], 'r', ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`;

// KEYS[1] key; ARGV token
const RELEASE = `
local cur = redis.call('HMGET', KEYS[1], 's', 't')
if cur[1] == 'IN_PROGRESS' and cur[2] == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
`;

// KEYS[1] key
const GET = `return redis.call('HGETALL', KEYS[1])`;

interface Script {
  source: string;
  sha1: string;
}

function script(source: string): Script {
  return { source, sha1: createHash('sha1').update(source).digest('hex') };
}

const SCRIPTS = {
  acquire: script(ACQUIRE),
  complete: script(COMPLETE),
  release: script(RELEASE),
  get: script(GET),
};

/**
 * Storage backed by Redis through an `ioredis` client (an optional peer dependency).
 * Share it between instances of your application so that retries reaching any instance
 * see the same records.
 *
 * Locking is atomic: each operation is a single Lua script, and records expire on the
 * Redis server with `PEXPIRE`, so a crashed process never leaves a key locked for longer
 * than the lock timeout. Every script touches exactly one key, so Redis Cluster works.
 */
export class RedisIdempotencyStorage implements IdempotencyStorage {
  private readonly client: RedisClientLike;
  private readonly keyPrefix: string;

  constructor(options: RedisIdempotencyStorageOptions) {
    if (!options?.client) {
      throw new TypeError('RedisIdempotencyStorage: the `client` option is required');
    }
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'idempotency:';
  }

  async acquire(key: string, options: AcquireOptions): Promise<AcquireResult> {
    const now = Date.now();
    const lockTimeoutMs = toPositiveInt(options.lockTimeoutMs, 'lockTimeoutMs');
    const lockToken = randomUUID();
    const reply = await this.run(SCRIPTS.acquire, key, [
      lockToken,
      options.fingerprint,
      now,
      now + lockTimeoutMs,
      lockTimeoutMs,
    ]);
    if (reply === null || reply === undefined) return { acquired: true, lockToken };
    const record = parseRecord(reply);
    if (!record) throw new Error(`RedisIdempotencyStorage: unreadable record for key "${key}"`);
    return { acquired: false, record };
  }

  async complete(key: string, options: CompleteOptions): Promise<boolean> {
    const ttlMs = toPositiveInt(options.ttlMs, 'ttlMs');
    const reply = await this.run(SCRIPTS.complete, key, [
      options.lockToken,
      options.fingerprint,
      Date.now(),
      JSON.stringify(options.response),
      ttlMs,
    ]);
    return Number(reply) === 1;
  }

  async release(key: string, lockToken: string): Promise<boolean> {
    const reply = await this.run(SCRIPTS.release, key, [lockToken]);
    return Number(reply) === 1;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    return parseRecord(await this.run(SCRIPTS.get, key, []));
  }

  private async run(s: Script, key: string, args: (string | number)[]): Promise<unknown> {
    const fullKey = this.keyPrefix + key;
    try {
      return await this.client.evalsha(s.sha1, 1, fullKey, ...args);
    } catch (error) {
      if (!isNoScript(error)) throw error;
      // The script cache was flushed or this node has not seen the script yet.
      return this.client.eval(s.source, 1, fullKey, ...args);
    }
  }
}

function isNoScript(error: unknown): boolean {
  return error instanceof Error && error.message.includes('NOSCRIPT');
}

function toPositiveInt(value: number, name: string): number {
  const n = Math.ceil(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new RangeError(`RedisIdempotencyStorage: ${name} must be a positive number`);
  }
  return n;
}

function parseRecord(reply: unknown): IdempotencyRecord | null {
  if (!Array.isArray(reply) || reply.length === 0) return null;
  const h: Record<string, string> = {};
  for (let i = 0; i + 1 < reply.length; i += 2) {
    h[String(reply[i])] = String(reply[i + 1]);
  }
  const fingerprint = h.f ?? '';
  const createdAt = Number(h.c);
  if (h.s === 'IN_PROGRESS') {
    return { status: 'IN_PROGRESS', fingerprint, createdAt, lockExpiresAt: Number(h.l) };
  }
  if (h.s === 'COMPLETED' && h.r !== undefined) {
    return {
      status: 'COMPLETED',
      fingerprint,
      createdAt,
      completedAt: Number(h.d),
      response: JSON.parse(h.r) as StoredResponse,
    };
  }
  return null;
}
