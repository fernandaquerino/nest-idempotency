# nest-idempotency: Specification

> Hand this file to the coding agent as the project brief. Save it in the repository as `docs/SPEC.md`.

## 1. Product

**What it is.** An open-source NestJS module that makes HTTP endpoints safe to retry with an
`Idempotency-Key` header, following the IETF `Idempotency-Key` HTTP header draft. Retried requests
with the same key get the original response instead of running the handler twice.

**Who it is for.** NestJS developers building payment, order or any create endpoint where client
retries and flaky networks must not create duplicates.

**Package name.** `nest-idempotency` on npm (available at the time of writing; confirm before the
first publish). Fallback: `@fernandaquerino/nestjs-idempotency`.

**Usage target (what the README shows first):**

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
  @Idempotent()                 // header required
  create(@Body() dto: CreateOrderDto) { ... }

  @Post('quote')
  @Idempotent({ required: false })  // header optional
  quote(@Body() dto: QuoteDto) { ... }
}
```

## 2. Behaviour (Phase 1)

| Situation                                          | Result                                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| No header on `@Idempotent()` route                 | `400` `IDEMPOTENCY_KEY_MISSING`                                                         |
| No header and `required: false`                    | Handler runs normally, nothing stored                                                   |
| Key format invalid (not 1–255 visible ASCII chars) | `400` `IDEMPOTENCY_KEY_INVALID`                                                         |
| First request with a key                           | Lock acquired (`IN_PROGRESS`), handler runs, response stored (`COMPLETED`)              |
| Same key + same fingerprint, completed             | Stored status, headers (allow-list) and body replayed; adds `Idempotent-Replayed: true` |
| Same key while first is still running              | `409` `IDEMPOTENCY_REQUEST_IN_PROGRESS` with `Retry-After`                              |
| Same key + different fingerprint                   | `422` `IDEMPOTENCY_KEY_REUSED`                                                          |
| Handler throws `5xx` or the process dies           | Lock released (or expires after `lockTimeoutSeconds`), so a retry can run again         |
| Handler returns or throws `4xx`                    | Stored and replayed (configurable with `cacheClientErrors`)                             |

- **Fingerprint:** SHA-256 of method + route path + a canonical JSON of the body. Configurable with a
  `fingerprint(request)` option.
- **Scope:** keys are namespaced per route by default and optionally per user via
  `scope: (req) => req.user?.id`, so two users can't collide.
- **Locking is atomic in the storage adapter** (Redis `SET NX PX`, in-memory map with a mutex).
  Never "read then write" without atomicity.
- Streaming responses (`StreamableFile`, SSE) are rejected at startup when decorated, with a clear error.

## 3. Package structure

```
nest-idempotency/
├── src/
│   ├── idempotency.module.ts      # forRoot / forRootAsync
│   ├── idempotent.decorator.ts
│   ├── idempotency.interceptor.ts
│   ├── fingerprint.ts             # pure
│   ├── key.ts                     # validation, pure
│   ├── errors.ts                  # stable error codes
│   └── storage/
│       ├── storage.interface.ts   # acquire, complete, release, get
│       ├── memory.storage.ts
│       └── redis.storage.ts       # ioredis, peer dependency
├── test/
│   ├── unit/
│   ├── contract/                  # one shared suite every storage adapter must pass
│   └── e2e/                       # real Nest app + supertest, Redis via docker compose
├── examples/basic-app/            # runnable sample NestJS app
├── docs/
├── .changeset/
└── .github/workflows/{ci.yml,release.yml}
```

- Build with `tsup` to ESM + CJS with type declarations; `exports` map in `package.json`.
- Peer dependencies: `@nestjs/common`, `@nestjs/core`, `rxjs`, `reflect-metadata`; optional peer `ioredis`.
- Supported: NestJS 10 and 11 on Express. CI matrix runs both Nest versions on Node 20, 22 and 24.

## 4. Phase 1 build order (commit after each step)

1. Repo hygiene: LICENSE, README skeleton, `.gitignore`, `package.json` with exports, tsup, Vitest or Jest, ESLint/Prettier, CI matrix.
2. Key validation and fingerprint (pure) with unit tests, including canonical JSON ordering.
3. Storage interface, in-memory adapter and the **storage contract test suite**.
4. Redis adapter passing the same contract suite against a real Redis (docker compose in CI).
5. Decorator, interceptor and module (`forRoot`, `forRootAsync`) with e2e tests for every row of the behaviour table, including 20 concurrent requests with the same key producing one handler call.
6. `examples/basic-app` and a README with install, quick start, options table, error codes and FAQ.
7. Changesets and a release workflow that publishes to npm with provenance when a version PR is merged (uses the `NPM_TOKEN` repository secret; do not publish from the agent).
8. CONTRIBUTING.md, issue templates, SECURITY.md, ROADMAP.md and `docs/ISSUES.md`.

**Stop after step 8.** The author publishes v0.1.0 herself. Do not implement roadmap items.

## 5. Roadmap (write to ROADMAP.md and docs/ISSUES.md, do not implement)

Each item needs a title, problem, scope and acceptance criteria.

1. Fastify adapter support.
2. Prisma / PostgreSQL storage adapter (row lock with `INSERT ... ON CONFLICT`).
3. TypeORM storage adapter.
4. Response header allow-list and deny-list options.
5. Metrics hooks (hit, miss, conflict, reuse) for Prometheus or OpenTelemetry.
6. GraphQL mutations support.
7. Microservices (message patterns) support with a message-id key.
8. Docs site (VitePress or Docusaurus) deployed with GitHub Pages.
9. Benchmarks: overhead per request with memory and Redis storage.
10. `forFeature` per-module options.
11. Body size limit for stored responses, with a clear error.
12. Example: payments endpoint with Stripe-style semantics.
13. Compatibility table and automated tests against the latest Nest release.

## 6. Repository rules (apply to all work)

- **License:** MIT, `Copyright (c) 2026 fernandaquerino`, in `LICENSE` at the root.
- **README:** what it does, who it is for, install, quick start, options, error codes, how to run tests, status, link to ROADMAP.md.
- **Secrets:** never commit secrets; npm token only as a GitHub secret.
- **Git:** commit after each completed step with Conventional Commits. Do not squash, rewrite history, backdate commits or force-push. Use the git identity already configured on the machine.
- **Quality gates before each commit:** lint, typecheck, tests and build pass. Report only commands that were actually run.
- **Public API discipline:** everything exported from `src/index.ts` is public and documented; nothing else is.
