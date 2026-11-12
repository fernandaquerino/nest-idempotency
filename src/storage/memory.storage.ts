import { randomUUID } from 'node:crypto';
import type {
  AcquireOptions,
  AcquireResult,
  CompleteOptions,
  IdempotencyRecord,
  IdempotencyStorage,
} from './storage.interface';

/** Options for {@link MemoryIdempotencyStorage}. */
export interface MemoryIdempotencyStorageOptions {
  /**
   * How often expired records are swept from memory, in milliseconds. Expired records are
   * never returned even before a sweep. Set to `0` to disable the timer. Default: `60_000`.
   */
  sweepIntervalMs?: number;
  /** Clock used for expiry, in epoch milliseconds. Default: `Date.now`. */
  now?: () => number;
}

interface Entry {
  record: IdempotencyRecord;
  lockToken: string;
  expiresAt: number;
}

/**
 * In-process storage backed by a `Map`. Suitable for tests, local development and
 * single-instance deployments. Records are lost on restart and are not shared between
 * processes, so use {@link RedisIdempotencyStorage} when running more than one instance.
 *
 * Atomicity: every operation reads and writes the map in one synchronous step, with no
 * `await` in between. Because JavaScript runs one step at a time on the event loop, that
 * step acts as the mutex: no other operation can interleave with it.
 */
export class MemoryIdempotencyStorage implements IdempotencyStorage {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly timer: NodeJS.Timeout | undefined;

  constructor(options: MemoryIdempotencyStorageOptions = {}) {
    this.now = options.now ?? Date.now;
    const sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
    if (sweepIntervalMs > 0) {
      this.timer = setInterval(() => this.sweep(), sweepIntervalMs);
      this.timer.unref();
    }
  }

  async acquire(key: string, options: AcquireOptions): Promise<AcquireResult> {
    const existing = this.live(key);
    if (existing) return { acquired: false, record: clone(existing.record) };

    const now = this.now();
    const lockToken = randomUUID();
    const lockExpiresAt = now + options.lockTimeoutMs;
    this.entries.set(key, {
      record: {
        status: 'IN_PROGRESS',
        fingerprint: options.fingerprint,
        createdAt: now,
        lockExpiresAt,
      },
      lockToken,
      expiresAt: lockExpiresAt,
    });
    return { acquired: true, lockToken };
  }

  async complete(key: string, options: CompleteOptions): Promise<boolean> {
    const existing = this.live(key);
    if (existing) {
      if (existing.record.status !== 'IN_PROGRESS') return false;
      if (existing.lockToken !== options.lockToken) return false;
    }

    const now = this.now();
    this.entries.set(key, {
      record: {
        status: 'COMPLETED',
        fingerprint: options.fingerprint,
        createdAt: existing?.record.createdAt ?? now,
        completedAt: now,
        response: clone(options.response),
      },
      lockToken: options.lockToken,
      expiresAt: now + options.ttlMs,
    });
    return true;
  }

  async release(key: string, lockToken: string): Promise<boolean> {
    const existing = this.live(key);
    if (!existing || existing.record.status !== 'IN_PROGRESS') return false;
    if (existing.lockToken !== lockToken) return false;
    this.entries.delete(key);
    return true;
  }

  async get(key: string): Promise<IdempotencyRecord | null> {
    const existing = this.live(key);
    return existing ? clone(existing.record) : null;
  }

  /** Removes every record. */
  clear(): void {
    this.entries.clear();
  }

  /** Stops the background sweep timer. The storage keeps working without it. */
  close(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
