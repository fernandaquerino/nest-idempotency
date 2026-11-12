import { MemoryIdempotencyStorage } from 'nest-idempotency';
import { runBehaviourSuite } from './behaviour';

runBehaviourSuite({
  name: 'memory',
  createStorage: () => new MemoryIdempotencyStorage(),
  destroyStorage: (storage) => (storage as MemoryIdempotencyStorage).close(),
});
