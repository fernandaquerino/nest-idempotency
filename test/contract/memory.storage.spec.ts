import { describe, expect, it } from 'vitest';
import { MemoryIdempotencyStorage } from '../../src/storage/memory.storage';
import { runStorageContract } from './storage-contract';

runStorageContract({
  name: 'MemoryIdempotencyStorage',
  create: () => new MemoryIdempotencyStorage(),
  destroy: (storage) => (storage as MemoryIdempotencyStorage).close(),
});

describe('MemoryIdempotencyStorage specifics', () => {
  it('uses the injected clock for expiry', async () => {
    let now = 1_000;
    const storage = new MemoryIdempotencyStorage({ now: () => now, sweepIntervalMs: 0 });
    await storage.acquire('k', { fingerprint: 'fp', lockTimeoutMs: 100 });
    now += 99;
    expect(await storage.get('k')).not.toBeNull();
    now += 1;
    expect(await storage.get('k')).toBeNull();
  });

  it('clear removes every record', async () => {
    const storage = new MemoryIdempotencyStorage({ sweepIntervalMs: 0 });
    await storage.acquire('a', { fingerprint: 'fp', lockTimeoutMs: 10_000 });
    await storage.acquire('b', { fingerprint: 'fp', lockTimeoutMs: 10_000 });
    storage.clear();
    expect(await storage.get('a')).toBeNull();
    expect(await storage.get('b')).toBeNull();
  });

  it('sweeps expired records in the background', async () => {
    let now = 0;
    const storage = new MemoryIdempotencyStorage({ now: () => now, sweepIntervalMs: 20 });
    await storage.acquire('k', { fingerprint: 'fp', lockTimeoutMs: 10 });
    now = 1_000;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect((storage as unknown as { entries: Map<string, unknown> }).entries.size).toBe(0);
    storage.close();
  });
});
