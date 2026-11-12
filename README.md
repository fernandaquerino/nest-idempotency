# nest-idempotency

[![CI](https://github.com/fernandaquerino/nest-idempotency/actions/workflows/ci.yml/badge.svg)](https://github.com/fernandaquerino/nest-idempotency/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Make NestJS HTTP endpoints safe to retry with an `Idempotency-Key` header, following the
[IETF Idempotency-Key HTTP header draft](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/).
A retried request with the same key gets the original response back instead of running the
handler a second time.

**Who it is for:** NestJS developers building payment, order or other create endpoints, where
client retries and flaky networks must not create duplicates.

```ts
@Module({
  imports: [
    IdempotencyModule.forRoot({
      storage: new RedisIdempotencyStorage({ client: redis }),
      ttlSeconds: 86_400,
    }),
  ],
})
export class AppModule {}

@Controller('orders')
export class OrdersController {
  @Post()
  @Idempotent() // header required
  create(@Body() dto: CreateOrderDto) { ... }

  @Post('quote')
  @Idempotent({ required: false }) // header optional
  quote(@Body() dto: QuoteDto) { ... }
}
```

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Options](#options)
- [Error codes](#error-codes)
- [Storage](#storage)
- [FAQ](#faq)
- [Running the tests](#running-the-tests)
- [Compatibility](#compatibility)
- [Status and roadmap](#status-and-roadmap)

## Install

```bash
npm install nest-idempotency
```

For Redis storage, also install `ioredis` (an optional peer dependency):

```bash
npm install ioredis
```

Peer dependencies: `@nestjs/common` and `@nestjs/core` 10 or 11, `rxjs` 7 and
`reflect-metadata`, which every Nest app already has.

## Quick start

**1. Import the module once, in your root module.** It is global, so `@Idempotent()` works in
every module.

```ts
import { Module } from '@nestjs/common';
import Redis from 'ioredis';
import { IdempotencyModule, RedisIdempotencyStorage } from 'nest-idempotency';

@Module({
  imports: [
    IdempotencyModule.forRoot({
      storage: new RedisIdempotencyStorage({ client: new Redis(process.env.REDIS_URL!) }),
      ttlSeconds: 86_400, // keep responses for 24 hours
    }),
  ],
})
export class AppModule {}
```

For local development or a single instance, `new MemoryIdempotencyStorage()` needs no Redis.

**2. Decorate the routes that must not run twice.**

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { Idempotent } from 'nest-idempotency';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Idempotent()
  create(@Body() dto: CreateOrderDto) {
    return this.orders.create(dto);
  }
}
```

**3. Clients send a unique key per operation**, typically a UUID, and reuse it on every retry
of that operation.

```bash
curl -X POST http://localhost:3000/orders \
  -H 'Idempotency-Key: 8e03978e-40d5-43e8-bc93-6894a57f9324' \
  -H 'Content-Type: application/json' \
  -d '{"item":"book","quantity":1}'
```

The first request creates the order. Retries with the same key and body get the same status
and body back, with an `Idempotent-Replayed: true` header, and no second order is created.

A complete runnable app is in [`examples/basic-app`](./examples/basic-app).

### Configuring from other providers

Use `forRootAsync` to build the options from, for example, `ConfigService`:

```ts
IdempotencyModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    storage: new RedisIdempotencyStorage({ client: new Redis(config.getOrThrow('REDIS_URL')) }),
    ttlSeconds: config.get('IDEMPOTENCY_TTL_SECONDS', 86_400),
  }),
});
```

`useClass` and `useExisting` work too, with a class that implements
`IdempotencyOptionsFactory` (`createIdempotencyOptions()`).

## How it works

| Situation                                          | Result                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| No header on an `@Idempotent()` route              | `400` `IDEMPOTENCY_KEY_MISSING`                                                             |
| No header and `required: false`                    | The handler runs normally and nothing is stored                                             |
| Key format invalid (not 1–255 visible ASCII chars) | `400` `IDEMPOTENCY_KEY_INVALID`                                                             |
| First request with a key                           | Lock acquired (`IN_PROGRESS`), handler runs, response stored (`COMPLETED`)                  |
| Same key and same fingerprint, completed           | Stored status, headers (allow-list) and body replayed, with `Idempotent-Replayed: true`     |
| Same key while the first request is still running  | `409` `IDEMPOTENCY_REQUEST_IN_PROGRESS` with `Retry-After`                                  |
| Same key and a different fingerprint               | `422` `IDEMPOTENCY_KEY_REUSED`                                                              |
| Handler throws a `5xx` or the process dies         | Lock released (or it expires after `lockTimeoutSeconds`), so a retry runs the handler again |
| Handler returns or throws a `4xx`                  | Stored and replayed (turn off with `cacheClientErrors: false`)                              |

- **The key** is read from the `Idempotency-Key` header. Both the bare form (`abc`) and the
  draft's Structured Field String form (`"abc"`) are accepted and mean the same key. A request
  with the header repeated is rejected as invalid.
- **The fingerprint** identifies "the same request". By default it is the SHA-256 of the HTTP
  method, the request path (with route parameters filled in, without the query string) and a
  canonical JSON of the body, with object keys sorted so that key order does not matter.
  Replace it with the `fingerprint` option.
- **Keys are namespaced per route** (method and route pattern), so the same key on two
  different endpoints never collides. Add a per-user namespace with the `scope` option.
- **Locking is atomic** in the storage adapter: a single Lua script in Redis, a single
  synchronous step in memory. Of 20 concurrent requests with the same key, exactly one runs the
  handler.
- **Replayed headers** are limited to an allow-list: `content-type`, `content-language`,
  `content-location`, `location`, `etag`, `last-modified` and `link`. Headers that belong to one
  specific response, such as cookies, dates or tracing ids, are not replayed.
- **Unsupported routes fail at startup.** `@Idempotent()` on a streaming route (`@Sse()` or a
  method declared to return `StreamableFile`), on `@Render()` or `@Redirect()` routes, or on a
  handler that sends the response itself with `@Res()` (without `passthrough: true`) throws an
  `IdempotencyConfigurationError` when the app starts, listing every offending route.

## Options

### `IdempotencyModule.forRoot(options)`

| Option               | Type                                             | Default            | Description                                                                                                                                                     |
| -------------------- | ------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`            | `IdempotencyStorage`                             | required           | Where records are kept: `RedisIdempotencyStorage`, `MemoryIdempotencyStorage` or your own adapter.                                                              |
| `ttlSeconds`         | `number`                                         | `86400` (24 h)     | How long a completed response is kept and replayed.                                                                                                             |
| `lockTimeoutSeconds` | `number`                                         | `60`               | How long the lock of an in-flight request lives. If the process dies mid-request, the key can be retried once it expires. Set it above your slowest handler.    |
| `cacheClientErrors`  | `boolean`                                        | `true`             | Store and replay `4xx` responses (returned or thrown). When `false`, the lock is released and a retry runs the handler again. `5xx` responses are never stored. |
| `retryAfterSeconds`  | `number`                                         | `1`                | Value of the `Retry-After` header on `409` responses.                                                                                                           |
| `fingerprint`        | `(req) => string \| Promise<string>`             | method, path, body | Computes the request fingerprint compared on retries. `computeFingerprint` and `canonicalJson` are exported to help build your own.                             |
| `scope`              | `(req) => string \| number \| undefined \| null` | none               | Extra key namespace, typically the user: `scope: (req) => req.user?.id`. Return `undefined` for no extra namespace.                                             |

`fingerprint` and `scope` receive the Express request (typed as `IdempotencyRequest`).

### `@Idempotent(options?)`

| Option               | Type      | Default             | Description                                                                                           |
| -------------------- | --------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| `required`           | `boolean` | `true`              | Reject requests without the header with `400`. When `false`, they run normally and nothing is stored. |
| `ttlSeconds`         | `number`  | module `ttlSeconds` | Overrides the module value for this route.                                                            |
| `lockTimeoutSeconds` | `number`  | module value        | Overrides the module value for this route.                                                            |
| `cacheClientErrors`  | `boolean` | module value        | Overrides the module value for this route.                                                            |

## Error codes

Every error response has a stable `code` field next to Nest's usual `statusCode`, `error` and
`message`:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "IDEMPOTENCY_REQUEST_IN_PROGRESS",
  "message": "A request with this Idempotency-Key is still being processed. Retry later."
}
```

| Code                              | Status | Meaning                                                           | What the client should do            |
| --------------------------------- | ------ | ----------------------------------------------------------------- | ------------------------------------ |
| `IDEMPOTENCY_KEY_MISSING`         | `400`  | The route requires an `Idempotency-Key` header and none was sent. | Send a key.                          |
| `IDEMPOTENCY_KEY_INVALID`         | `400`  | The key is not 1–255 visible ASCII characters, or was sent twice. | Fix the key, for example use a UUID. |
| `IDEMPOTENCY_REQUEST_IN_PROGRESS` | `409`  | A request with the same key is still running.                     | Retry after `Retry-After` seconds.   |
| `IDEMPOTENCY_KEY_REUSED`          | `422`  | The key was already used for a request with a different payload.  | Use a new key for a new operation.   |

The errors are `IdempotencyException` instances (a Nest `HttpException`), so your exception
filters handle them like any other. The codes are also exported as `IdempotencyErrorCode`.

## Storage

| Adapter                    | Use it for                                                  |
| -------------------------- | ----------------------------------------------------------- |
| `RedisIdempotencyStorage`  | Production, and any deployment with more than one instance. |
| `MemoryIdempotencyStorage` | Tests, local development, a single instance.                |

```ts
// Redis: pass an ioredis Redis or Cluster client. The adapter never closes it.
new RedisIdempotencyStorage({ client: redis, keyPrefix: 'idempotency:' });

// In memory: records live in the process and are lost on restart.
new MemoryIdempotencyStorage({ sweepIntervalMs: 60_000 });
```

`RedisIdempotencyStorage` stores each record as a hash under `keyPrefix` + key and lets Redis
expire it, so a crashed process never leaves a key locked longer than the lock timeout. Every
operation is a single-key Lua script, which also works with Redis Cluster.

### Writing your own adapter

Implement `IdempotencyStorage` (`acquire`, `complete`, `release`, `get`). `acquire`, `complete`
and `release` must each be atomic: never read a record and write it back in two steps that
another request can interleave with. Run the shared contract suite in
[`test/contract/storage-contract.ts`](./test/contract/storage-contract.ts) against your adapter;
both built-in adapters pass it unchanged.

## FAQ

**Why does a concurrent retry get `409` instead of waiting for the first request?**
Waiting would hold a connection open for as long as the slowest handler, and the IETF draft
recommends `409` for this case. Clients retry after `Retry-After` and then get the stored
response.

**What exactly is replayed?**
The status code, the allow-listed headers and the value your handler returned (or the
`HttpException` it threw). Replays go through Nest's normal response pipeline, so outer
interceptors and exception filters apply to them as they did to the first response.

**My response has class instances (for example `ClassSerializerInterceptor` with `@Exclude()`). Anything to watch?**
Yes. The handler's return value is stored as JSON, and to keep the first response and replays
identical, the first response is sent from the same JSON. Class instances therefore reach outer
interceptors as plain objects, and `@Exclude()` rules from an outer `ClassSerializerInterceptor`
no longer apply. Either return plain objects (DTOs) from idempotent handlers, or apply the
serializer inside the idempotency interceptor by placing it above `@Idempotent()`:

```ts
@Post()
@UseInterceptors(ClassSerializerInterceptor) // runs inside, so the stored value is serialised
@Idempotent()
create() { ... }
```

**How are thrown `4xx` errors replayed?**
As an `HttpException` with the stored status and response body, so the default exception filter
produces the same JSON. A custom filter that checks for a specific class (`instanceof
NotFoundException`) sees a plain `HttpException` on replays.

**Do guards and pipes interact with idempotency?**
Guards run before the interceptor, so a request rejected by a guard (for example `401`) never
takes a lock and nothing is stored. Pipes run inside it, so a validation error from a pipe is
a `4xx` response that is stored and replayed (unless `cacheClientErrors` is `false`).

**What happens if Redis is down?**
The module fails closed: if the lock cannot be taken, the request fails with `500` and the
handler does not run, so no duplicate is possible. If storing the response fails after the
handler ran, the response is still sent and the lock is kept until `lockTimeoutSeconds`, which
blocks immediate duplicate executions.

**Is the query string part of the fingerprint?**
Not by default: the method, path and body are. If your route's behaviour depends on the query
string, include it with a custom fingerprint, for example
`fingerprint: (req) => computeFingerprint({ method: req.method, path: req.originalUrl ?? req.path, body: req.body })`.

**Can two users collide on the same key?**
Keys are namespaced per route only, so yes if both pick the same key for the same route. Add
`scope: (req) => req.user?.id` to give every user their own namespace.

**How long should I keep keys?**
Long enough to cover your clients' retry window. 24 hours (the default) is a common choice.

**Does it work with Fastify, GraphQL or microservices?**
Not yet: Phase 1 supports HTTP routes on `@nestjs/platform-express`, and the app fails at
startup if `@Idempotent()` is used with another HTTP adapter. These are on the
[roadmap](./ROADMAP.md).

## Running the tests

```bash
npm install
npm test
```

The Redis contract and end-to-end suites run when `REDIS_URL` is set and are skipped otherwise.
To run everything, start Redis with Docker Compose:

```bash
docker compose up -d --wait redis
```

```bash
REDIS_URL=redis://localhost:6379 npm test
```

Other scripts: `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test:dist` (the
end-to-end suites against the built bundle) and `npm run check` (lint, typecheck, tests and
build). `npm run example` builds and starts [`examples/basic-app`](./examples/basic-app).

## Compatibility

| Package          | Versions                               |
| ---------------- | -------------------------------------- |
| Node.js          | 20, 22, 24                             |
| NestJS           | 10, 11 with `@nestjs/platform-express` |
| Redis (optional) | 7 (tested in CI), through `ioredis` 5  |

CI runs the full suite for each Node and NestJS combination, against a real Redis.

## Status and roadmap

**Status:** pre-release (`0.x`). Phase 1 is complete and tested; the API may still change
before `1.0`. See [ROADMAP.md](./ROADMAP.md) for what comes next.

Contributions are welcome: see [CONTRIBUTING.md](./CONTRIBUTING.md). Report security issues as
described in [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © 2026 fernandaquerino
