import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  InternalServerErrorException,
  Module,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  type INestApplication,
  type DynamicModule,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  Idempotent,
  IdempotencyModule,
  type IdempotencyModuleOptions,
  type IdempotencyStorage,
} from 'nest-idempotency';
import type {
  AcquireOptions,
  CompleteOptions,
  IdempotencyRecord,
} from '../../src/storage/storage.interface';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Counts handler executions per route. */
@Injectable()
export class Calls {
  private readonly counts = new Map<string, number>();
  hit(route: string): number {
    const n = (this.counts.get(route) ?? 0) + 1;
    this.counts.set(route, n);
    return n;
  }
  of(route: string): number {
    return this.counts.get(route) ?? 0;
  }
}

/** Lets a test hold a handler open, simulating a long request or a dead process. */
@Injectable()
export class Gate {
  private waiters: (() => void)[] = [];
  wait(): Promise<void> {
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  open(): void {
    for (const resolve of this.waiters.splice(0)) resolve();
  }
}

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly calls: Calls,
    private readonly gate: Gate,
  ) {}

  @Post()
  @Idempotent()
  create(@Body() body: Record<string, unknown>) {
    const id = this.calls.hit('create');
    return { id, ...body };
  }

  @Post('optional')
  @Idempotent({ required: false })
  optional(@Body() body: Record<string, unknown>) {
    return { call: this.calls.hit('optional'), ...body };
  }

  @Post('other')
  @Idempotent()
  other() {
    return { call: this.calls.hit('other') };
  }

  @Post('slow')
  @Idempotent()
  async slow(@Body() body: { delayMs?: number }) {
    const call = this.calls.hit('slow');
    await sleep(body.delayMs ?? 300);
    return { call };
  }

  @Post('gated')
  @Idempotent({ lockTimeoutSeconds: 0.5 })
  async gated() {
    const call = this.calls.hit('gated');
    if (call === 1) await this.gate.wait();
    return { call };
  }

  @Post('server-error')
  @Idempotent()
  serverError() {
    const call = this.calls.hit('server-error');
    if (call === 1) throw new InternalServerErrorException('boom');
    return { call };
  }

  @Post('crash')
  @Idempotent()
  crash() {
    const call = this.calls.hit('crash');
    if (call === 1) throw new Error('unexpected');
    return { call };
  }

  @Post('not-found')
  @Idempotent()
  notFound() {
    this.calls.hit('not-found');
    throw new NotFoundException('Order not found');
  }

  @Post('returned-client-error')
  @Idempotent()
  @HttpCode(400)
  returnedClientError() {
    return { error: 'declined', call: this.calls.hit('returned-client-error') };
  }

  @Post('no-cache-client-errors')
  @Idempotent({ cacheClientErrors: false })
  noCacheClientErrors() {
    this.calls.hit('no-cache-client-errors');
    throw new BadRequestException('try again');
  }

  @Post('pipe')
  @Idempotent()
  pipe(@Query('n', ParseIntPipe) n: number) {
    return { n, call: this.calls.hit('pipe') };
  }

  @Post('text')
  @Idempotent()
  text() {
    return `plain text ${this.calls.hit('text')}`;
  }

  @Post('binary')
  @Idempotent()
  @Header('Content-Type', 'application/octet-stream')
  binary() {
    return Buffer.from([0, 1, 2, this.calls.hit('binary')]);
  }

  @Post('empty')
  @Idempotent()
  @HttpCode(204)
  empty() {
    this.calls.hit('empty');
  }

  @Post('headers')
  @Idempotent()
  @Header('Location', '/orders/1')
  @Header('X-Request-Id', 'first-request')
  headers() {
    return { call: this.calls.hit('headers') };
  }

  @Post(':id/pay')
  @Idempotent()
  pay(@Param('id') id: string) {
    return { id, call: this.calls.hit('pay') };
  }

  @Post('plain')
  plain() {
    return { call: this.calls.hit('plain') };
  }

  @Get('ping')
  @Idempotent()
  ping() {
    return { call: this.calls.hit('ping') };
  }
}

/** Delegates to a real storage and records which keys were touched. */
export class RecordingStorage implements IdempotencyStorage {
  readonly acquired: string[] = [];
  constructor(readonly inner: IdempotencyStorage) {}
  acquire(key: string, options: AcquireOptions) {
    this.acquired.push(key);
    return this.inner.acquire(key, options);
  }
  complete(key: string, options: CompleteOptions) {
    return this.inner.complete(key, options);
  }
  release(key: string, lockToken: string) {
    return this.inner.release(key, lockToken);
  }
  get(key: string): Promise<IdempotencyRecord | null> {
    return this.inner.get(key);
  }
  lastKey(): string {
    const key = this.acquired.at(-1);
    if (!key) throw new Error('no key acquired');
    return key;
  }
}

export interface TestApp {
  app: INestApplication;
  calls: Calls;
  gate: Gate;
}

export async function createApp(
  idempotency:
    DynamicModule | (Partial<IdempotencyModuleOptions> & Pick<IdempotencyModuleOptions, 'storage'>),
  controllers: (new (...args: never[]) => unknown)[] = [OrdersController],
): Promise<TestApp> {
  const imported = 'module' in idempotency ? idempotency : IdempotencyModule.forRoot(idempotency);

  @Module({ imports: [imported], controllers, providers: [Calls, Gate] })
  class AppModule {}

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0);
  return { app, calls: app.get(Calls), gate: app.get(Gate) };
}
