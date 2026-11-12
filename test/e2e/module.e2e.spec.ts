import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Post,
  Redirect,
  Res,
  Sse,
  StreamableFile,
  UseInterceptors,
  type CallHandler,
  type NestInterceptor,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { map, of } from 'rxjs';
import {
  IDEMPOTENCY_MODULE_OPTIONS,
  Idempotent,
  IdempotencyConfigurationError,
  IdempotencyModule,
  type IdempotencyModuleOptions,
  type IdempotencyOptionsFactory,
  MemoryIdempotencyStorage,
} from 'nest-idempotency';
import { Calls, createApp, OrdersController, RecordingStorage, sleep, type TestApp } from './app';

let current: TestApp | undefined;

async function start(...args: Parameters<typeof createApp>): Promise<TestApp> {
  current = await createApp(...args);
  return current;
}

afterEach(async () => {
  await current?.app.close();
  current = undefined;
});

const http = () => request(current!.app.getHttpServer());

describe('module options', () => {
  it('scopes keys per user with the scope option', async () => {
    await start({
      storage: new MemoryIdempotencyStorage(),
      scope: (req) => req.headers['x-user'] as string | undefined,
    });
    const alice = await http()
      .post('/orders')
      .set('Idempotency-Key', 'same')
      .set('X-User', 'alice')
      .send({ amount: 1 });
    const bob = await http()
      .post('/orders')
      .set('Idempotency-Key', 'same')
      .set('X-User', 'bob')
      .send({ amount: 2 });
    expect(alice.status).toBe(201);
    expect(bob.status).toBe(201);
    expect(bob.headers['idempotent-replayed']).toBeUndefined();
    const aliceAgain = await http()
      .post('/orders')
      .set('Idempotency-Key', 'same')
      .set('X-User', 'alice')
      .send({ amount: 1 });
    expect(aliceAgain.headers['idempotent-replayed']).toBe('true');
    expect(aliceAgain.body).toEqual(alice.body);
  });

  it('keeps scoped and unscoped namespaces apart, even if a scope contains ":"', async () => {
    const storage = new RecordingStorage(new MemoryIdempotencyStorage());
    await start({ storage, scope: (req) => req.headers['x-user'] as string | undefined });
    await http().post('/orders').set('Idempotency-Key', 'k').set('X-User', 'a:b').send({});
    await http().post('/orders').set('Idempotency-Key', 'k').send({});
    expect(storage.acquired).toEqual(['a%3Ab:POST:%2Forders:k', ':POST:%2Forders:k']);
  });

  it('uses a custom fingerprint function', async () => {
    await start({
      storage: new MemoryIdempotencyStorage(),
      // Ignore the body entirely: only method and path matter.
      fingerprint: (req) => `${req.method} ${req.path}`,
    });
    await http().post('/orders').set('Idempotency-Key', 'k').send({ amount: 1 });
    const res = await http().post('/orders').set('Idempotency-Key', 'k').send({ amount: 2 });
    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBe('true');
    expect(res.body).toEqual({ id: 1, amount: 1 });
  });

  it('supports an async fingerprint function', async () => {
    await start({
      storage: new MemoryIdempotencyStorage(),
      fingerprint: async () => 'constant',
    });
    await http().post('/orders').set('Idempotency-Key', 'k').send({ amount: 1 });
    const res = await http().post('/orders').set('Idempotency-Key', 'k').send({ amount: 2 });
    expect(res.headers['idempotent-replayed']).toBe('true');
  });

  it('does not store 4xx when cacheClientErrors is false for the module', async () => {
    const { calls } = await start({
      storage: new MemoryIdempotencyStorage(),
      cacheClientErrors: false,
    });
    await http().post('/orders/not-found').set('Idempotency-Key', 'k');
    const second = await http().post('/orders/not-found').set('Idempotency-Key', 'k');
    expect(second.status).toBe(404);
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect(calls.of('not-found')).toBe(2);
  });

  it('sends the configured Retry-After', async () => {
    await start({ storage: new MemoryIdempotencyStorage(), retryAfterSeconds: 7 });
    const first = http()
      .post('/orders/slow')
      .set('Idempotency-Key', 'k')
      .send({})
      .then((r) => r);
    await sleep(100);
    const res = await http().post('/orders/slow').set('Idempotency-Key', 'k').send({});
    expect(res.status).toBe(409);
    expect(res.headers['retry-after']).toBe('7');
    await first;
  });

  it('forgets completed responses after ttlSeconds', async () => {
    const { calls } = await start({ storage: new MemoryIdempotencyStorage(), ttlSeconds: 0.2 });
    await http().post('/orders').set('Idempotency-Key', 'k').send({});
    await sleep(300);
    const res = await http().post('/orders').set('Idempotency-Key', 'k').send({});
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(calls.of('create')).toBe(2);
  });

  it('rejects invalid options at the import site', () => {
    expect(() =>
      IdempotencyModule.forRoot({ storage: {} as unknown as MemoryIdempotencyStorage }),
    ).toThrow(IdempotencyConfigurationError);
    expect(() =>
      IdempotencyModule.forRoot({ storage: new MemoryIdempotencyStorage(), ttlSeconds: 0 }),
    ).toThrow(/ttlSeconds/);
    expect(() =>
      IdempotencyModule.forRoot({
        storage: new MemoryIdempotencyStorage(),
        lockTimeoutSeconds: -1,
      }),
    ).toThrow(/lockTimeoutSeconds/);
  });

  it('rejects invalid @Idempotent() options', () => {
    expect(() => Idempotent({ ttlSeconds: 0 })).toThrow(IdempotencyConfigurationError);
    expect(() => Idempotent({ lockTimeoutSeconds: Number.NaN })).toThrow(/lockTimeoutSeconds/);
  });
});

describe('interceptor ordering', () => {
  it('runs an interceptor placed above @Idempotent() inside it, so replays skip it', async () => {
    let runs = 0;
    @Injectable()
    class WrapInterceptor implements NestInterceptor {
      intercept(_context: unknown, next: CallHandler) {
        runs++;
        return next.handle().pipe(map((value) => ({ wrapped: value })));
      }
    }
    @Controller('wrapped')
    class WrappedController {
      @Post()
      @UseInterceptors(WrapInterceptor)
      @Idempotent()
      create() {
        return { ok: true };
      }
    }
    const app = await start({ storage: new MemoryIdempotencyStorage() }, [WrappedController]);
    const server = app.app.getHttpServer();
    const first = await request(server).post('/wrapped').set('Idempotency-Key', 'k');
    const second = await request(server).post('/wrapped').set('Idempotency-Key', 'k');
    expect(first.body).toEqual({ wrapped: { ok: true } });
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(runs).toBe(1);
  });
});

describe('storage failures', () => {
  it('fails closed with 500 when the storage cannot take the lock', async () => {
    const storage = new MemoryIdempotencyStorage();
    storage.acquire = async () => {
      throw new Error('storage down');
    };
    const { calls } = await start({ storage });
    const res = await http().post('/orders').set('Idempotency-Key', 'k').send({});
    expect(res.status).toBe(500);
    expect(calls.of('create')).toBe(0);
  });

  it('still sends the response when storing it fails, and keeps the lock', async () => {
    const storage = new MemoryIdempotencyStorage();
    storage.complete = async () => {
      throw new Error('storage down');
    };
    const { calls } = await start({ storage });
    const first = await http().post('/orders').set('Idempotency-Key', 'k').send({});
    expect(first.status).toBe(201);
    const retry = await http().post('/orders').set('Idempotency-Key', 'k').send({});
    expect(retry.status).toBe(409);
    expect(calls.of('create')).toBe(1);
  });
});

describe('forRootAsync', () => {
  @Injectable()
  class Config {
    readonly ttlSeconds = 0.2;
    readonly storage = new MemoryIdempotencyStorage();
  }

  @Module({ providers: [Config], exports: [Config] })
  class ConfigModule {}

  it('builds options with useFactory and inject', async () => {
    const { calls } = await start(
      IdempotencyModule.forRootAsync({
        imports: [ConfigModule],
        inject: [Config],
        useFactory: async (config: Config) => ({
          storage: config.storage,
          ttlSeconds: config.ttlSeconds,
        }),
      }),
    );
    await http().post('/orders').set('Idempotency-Key', 'k').send({});
    const replay = await http().post('/orders').set('Idempotency-Key', 'k').send({});
    expect(replay.headers['idempotent-replayed']).toBe('true');
    await sleep(300);
    await http().post('/orders').set('Idempotency-Key', 'k').send({});
    expect(calls.of('create')).toBe(2);
  });

  it('builds options with useClass', async () => {
    @Injectable()
    class OptionsFactory implements IdempotencyOptionsFactory {
      constructor(@Inject(Config) private readonly config: Config) {}
      createIdempotencyOptions(): IdempotencyModuleOptions {
        return { storage: this.config.storage };
      }
    }
    await start(
      IdempotencyModule.forRootAsync({ imports: [ConfigModule], useClass: OptionsFactory }),
    );
    await http().post('/orders').set('Idempotency-Key', 'k').send({});
    const replay = await http().post('/orders').set('Idempotency-Key', 'k').send({});
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(current!.app.get(IDEMPOTENCY_MODULE_OPTIONS)).toEqual({ storage: expect.any(Object) });
  });

  it('builds options with useExisting', async () => {
    @Injectable()
    class ExistingFactory implements IdempotencyOptionsFactory {
      createIdempotencyOptions(): IdempotencyModuleOptions {
        return { storage: new MemoryIdempotencyStorage() };
      }
    }
    @Module({ providers: [ExistingFactory], exports: [ExistingFactory] })
    class FactoryModule {}

    await start(
      IdempotencyModule.forRootAsync({ imports: [FactoryModule], useExisting: ExistingFactory }),
    );
    await http().post('/orders').set('Idempotency-Key', 'k').send({});
    const replay = await http().post('/orders').set('Idempotency-Key', 'k').send({});
    expect(replay.headers['idempotent-replayed']).toBe('true');
  });

  it('requires exactly one of useFactory, useClass or useExisting', () => {
    expect(() => IdempotencyModule.forRootAsync({})).toThrow(IdempotencyConfigurationError);
    expect(() =>
      IdempotencyModule.forRootAsync({
        useFactory: () => ({ storage: new MemoryIdempotencyStorage() }),
        useExisting: Config,
      }),
    ).toThrow(IdempotencyConfigurationError);
  });

  it('validates the resolved options at startup', async () => {
    await expect(
      createApp(
        IdempotencyModule.forRootAsync({
          useFactory: () => ({ storage: new MemoryIdempotencyStorage(), ttlSeconds: -5 }),
        }),
      ),
    ).rejects.toThrow(/ttlSeconds/);
  });
});

describe('startup checks', () => {
  const storage = () => new MemoryIdempotencyStorage();

  it('rejects @Idempotent() on a server-sent events route', async () => {
    @Controller('events')
    class SseController {
      @Sse('stream')
      @Idempotent()
      stream() {
        return of({ data: 'x' });
      }
    }
    await expect(createApp({ storage: storage() }, [SseController])).rejects.toThrow(
      /SseController\.stream: server-sent events/,
    );
  });

  it('rejects @Idempotent() on a route declared to return StreamableFile', async () => {
    @Controller('files')
    class FileController {
      @Get()
      @Idempotent()
      download(): StreamableFile {
        return new StreamableFile(Buffer.from('x'));
      }
    }
    await expect(createApp({ storage: storage() }, [FileController])).rejects.toThrow(
      /FileController\.download: StreamableFile/,
    );
  });

  it('rejects a StreamableFile at runtime when the return type is not declared', async () => {
    @Controller('files')
    class UntypedFileController {
      @Post()
      @Idempotent()
      async download() {
        return new StreamableFile(Buffer.from('x'));
      }
    }
    const app = await start({ storage: storage() }, [UntypedFileController]);
    const res = await request(app.app.getHttpServer()).post('/files').set('Idempotency-Key', 'k');
    expect(res.status).toBe(500);
    // The lock was released, not left behind.
    const again = await request(app.app.getHttpServer()).post('/files').set('Idempotency-Key', 'k');
    expect(again.status).toBe(500);
  });

  it('rejects @Res() without passthrough', async () => {
    @Controller('raw')
    class RawController {
      @Post()
      @Idempotent()
      send(@Res() res: Response) {
        res.json({ ok: true });
      }
    }
    await expect(createApp({ storage: storage() }, [RawController])).rejects.toThrow(
      /RawController\.send: handlers that send the response themselves/,
    );
  });

  it('rejects @Redirect()', async () => {
    @Controller('redirect')
    class RedirectController {
      @Post()
      @Idempotent()
      @Redirect('/elsewhere')
      go() {}
    }
    await expect(createApp({ storage: storage() }, [RedirectController])).rejects.toThrow(
      /@Redirect\(\)/,
    );
  });

  it('lists every invalid route in one error', async () => {
    @Controller('many')
    class ManyController {
      @Sse('a')
      @Idempotent()
      a() {
        return of({ data: 'x' });
      }
      @Post('b')
      @Idempotent()
      b(@Res() res: Response) {
        res.end();
      }
    }
    await expect(createApp({ storage: storage() }, [ManyController])).rejects.toThrow(
      /ManyController\.a[\s\S]*ManyController\.b/,
    );
  });

  it('allows @Res({ passthrough: true }) and replays headers it sets', async () => {
    @Controller('passthrough')
    class PassthroughController {
      constructor(@Inject(Calls) private readonly calls: Calls) {}
      @Post()
      @Idempotent()
      create(@Res({ passthrough: true }) res: Response, @Body() body: unknown) {
        res.status(202).setHeader('Location', '/jobs/1');
        return { call: this.calls.hit('passthrough'), body };
      }
    }
    const app = await start({ storage: storage() }, [PassthroughController]);
    const server = app.app.getHttpServer();
    const first = await request(server).post('/passthrough').set('Idempotency-Key', 'k').send({});
    const second = await request(server).post('/passthrough').set('Idempotency-Key', 'k').send({});
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.headers.location).toBe('/jobs/1');
    expect(second.body).toEqual({ call: 1, body: {} });
    expect(second.headers['idempotent-replayed']).toBe('true');
  });

  it('explains how to fix a missing IdempotencyModule', async () => {
    @Module({ controllers: [OrdersController], providers: [Calls] })
    class NoIdempotencyModule {}
    await expect(
      Test.createTestingModule({ imports: [NoIdempotencyModule] }).compile(),
    ).rejects.toThrow(/IdempotencyModule\.forRoot\(\)/);
  });
});
