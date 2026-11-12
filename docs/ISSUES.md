# Roadmap issues

Ready-to-file issue descriptions for every item in [ROADMAP.md](../ROADMAP.md). Each has a
problem statement, a scope (with what is out of scope) and acceptance criteria. Copy one into a
GitHub issue when work starts and link the issue back here.

None of these are implemented in Phase 1.

---

## 1. Fastify adapter support

**Problem.** Phase 1 supports `@nestjs/platform-express` only, and the app fails at startup
when `@Idempotent()` is used with another HTTP adapter. Teams on `@nestjs/platform-fastify`
cannot use the module.

**Scope.**

- Read the key, method, path, matched route pattern and body from a Fastify request.
- Capture the status code and headers from a Fastify reply, and set them on replay.
- Remove the startup rejection for the `fastify` adapter type.
- Run the existing end-to-end behaviour suite against a Fastify app in addition to Express.
- Out of scope: other adapters.

**Acceptance criteria.**

- [ ] Every test in the end-to-end behaviour suite passes on Fastify with memory and Redis storage.
- [ ] Route namespaces use the Fastify route pattern (`routeOptions.url`), so `/orders/:id` is one namespace.
- [ ] `@nestjs/platform-fastify` is an optional peer dependency; Express users do not need it installed.
- [ ] CI runs the Fastify suite for Nest 10 and 11.
- [ ] README compatibility table and FAQ updated.

---

## 2. Prisma / PostgreSQL storage adapter

**Problem.** Teams that already run PostgreSQL may not want to operate Redis just for
idempotency, and some need idempotency records in the same database as their business data.

**Scope.**

- A `PrismaIdempotencyStorage` (or a generic PostgreSQL adapter usable from Prisma) with a
  documented table schema and a migration snippet.
- `acquire` uses a single `INSERT ... ON CONFLICT` statement so taking the lock is atomic; an
  expired lock is taken over atomically in the same statement (conditional `DO UPDATE ... WHERE`).
- `complete` and `release` are single conditional `UPDATE` / `DELETE` statements on the lock token.
- Expired rows are ignored on read; a documented cleanup query (or optional sweep) deletes them.
- Out of scope: other SQL databases.

**Acceptance criteria.**

- [ ] Passes the storage contract suite unchanged against a real PostgreSQL in CI (docker compose).
- [ ] No read-then-write sequences outside a single statement.
- [ ] `@prisma/client` (or the chosen driver) is an optional peer dependency.
- [ ] README documents the schema, migration and cleanup.

---

## 3. TypeORM storage adapter

**Problem.** Many NestJS apps use TypeORM; they want idempotency records in their existing
database through the ORM they already configure.

**Scope.**

- A `TypeOrmIdempotencyStorage` taking a `DataSource` (or repository), with an exported entity.
- Atomic operations using database-level conflict handling (`INSERT ... ON CONFLICT` on
  PostgreSQL, the equivalent on MySQL), never read-then-write.
- Out of scope: databases without an atomic upsert.

**Acceptance criteria.**

- [ ] Passes the storage contract suite unchanged against PostgreSQL and MySQL in CI.
- [ ] `typeorm` is an optional peer dependency.
- [ ] README documents entity registration and migrations.

---

## 4. Response header allow-list and deny-list options

**Problem.** Phase 1 replays a fixed allow-list of headers (`content-type`, `content-language`,
`content-location`, `location`, `etag`, `last-modified`, `link`). Apps that return meaningful
custom headers (for example `x-resource-version`) cannot have them replayed, and some may want
to drop a default header.

**Scope.**

- Module and `@Idempotent()` options: `replayHeaders` (replaces the allow-list) and
  `excludeHeaders` (removes names from it), case-insensitive.
- `set-cookie` stays excluded unless explicitly allowed, with a warning in the docs.
- Out of scope: per-header transformation.

**Acceptance criteria.**

- [ ] End-to-end tests show a custom header replayed when allowed and dropped when denied.
- [ ] Defaults unchanged when the options are not set.
- [ ] Options validated at startup with a clear `IdempotencyConfigurationError`.
- [ ] README options table updated.

---

## 5. Metrics hooks (hit, miss, conflict, reuse)

**Problem.** Operators cannot see how often retries are replayed, how often clients collide or
reuse keys, or how long locks are held, which makes tuning TTLs and lock timeouts guesswork.

**Scope.**

- An `events` (or `hooks`) module option receiving typed events: `miss` (first execution),
  `hit` (replay), `conflict` (409), `reuse` (422), `released` (5xx), `storageError`, each with
  route, scope-free key namespace and duration where relevant.
- Documented recipes for Prometheus (`prom-client`) and OpenTelemetry metrics, without adding
  either as a dependency.
- Hooks must never throw into the request path.

**Acceptance criteria.**

- [ ] End-to-end tests assert the exact event sequence for each behaviour-table row.
- [ ] A throwing hook does not change the HTTP response.
- [ ] No new runtime dependencies.
- [ ] README includes Prometheus and OpenTelemetry examples.

---

## 6. GraphQL mutations support

**Problem.** `@Idempotent()` only applies to HTTP routes. GraphQL mutations have the same
duplicate-on-retry risk.

**Scope.**

- Support `@Idempotent()` on `@Mutation()` resolvers with `@nestjs/graphql` (Apollo and
  Mercurius drivers), reading the key from the HTTP request header.
- Fingerprint: operation name, field name and canonical JSON of the field arguments.
- Replay the resolver's return value; GraphQL errors follow the same 4xx/5xx-equivalent rules
  (documented mapping).
- Out of scope: subscriptions, batching multiple keyed mutations in one request.

**Acceptance criteria.**

- [ ] End-to-end tests with a real GraphQL app cover first call, replay, 409 and 422.
- [ ] Non-mutation resolvers decorated with `@Idempotent()` are rejected at startup.
- [ ] `@nestjs/graphql` remains an optional peer dependency.

---

## 7. Microservices (message patterns) support with a message-id key

**Problem.** Message brokers redeliver messages (at-least-once delivery), so `@MessagePattern`
and `@EventPattern` handlers can run twice. HTTP headers do not exist there.

**Scope.**

- Support `@Idempotent()` on microservice handlers, with a `key` option that extracts the key
  from the message or context (for example a message id header), defaulting per transport where
  a standard id exists.
- Replay the stored return value for request-response patterns; for events, skip duplicates.
- Out of scope: exactly-once guarantees across the broker and the database.

**Acceptance criteria.**

- [ ] Tests with at least the TCP and Redis transports show a redelivered message processed once.
- [ ] A missing key follows `required` semantics with a clear error.
- [ ] README documents per-transport key extraction.

---

## 8. Docs site deployed with GitHub Pages

**Problem.** The README is getting long; guides (adapters, recipes, FAQ) need structure and
search.

**Scope.**

- A VitePress (preferred for size) or Docusaurus site in `docs/site`, built in CI and deployed to
  GitHub Pages from `main`.
- Pages: getting started, behaviour, options, error codes, storage adapters, writing an adapter,
  recipes, FAQ, changelog.
- README keeps the quick start and links to the site.

**Acceptance criteria.**

- [ ] Site builds in CI on every pull request and deploys on `main`.
- [ ] All README sections have a corresponding page; links checked in CI.
- [ ] Code samples are type-checked against the package.

---

## 9. Benchmarks

**Problem.** Users want to know the overhead the interceptor adds per request before putting it
on a hot path.

**Scope.**

- A `bench/` setup measuring latency and throughput for an undecorated route versus an
  `@Idempotent()` route, for first execution and replay, with memory and Redis storage.
- Reproducible with one command (autocannon or similar) and documented hardware.
- Out of scope: comparisons with other libraries.

**Acceptance criteria.**

- [ ] `npm run bench` produces a results table.
- [ ] Results published in the docs with the environment used.
- [ ] Optional CI job (manual trigger) runs the benchmark.

---

## 10. `forFeature` per-module options

**Problem.** Options are global (with a few per-route overrides). Large apps want different
defaults per feature module, for example a longer TTL and a custom scope for payments only.

**Scope.**

- `IdempotencyModule.forFeature(options)` that overrides `ttlSeconds`, `lockTimeoutSeconds`,
  `cacheClientErrors`, `fingerprint` and `scope` for controllers in that module.
- Precedence: route options, then feature options, then root options.
- Storage stays root-level only.

**Acceptance criteria.**

- [ ] End-to-end tests prove precedence across two feature modules.
- [ ] Using `forFeature` without `forRoot` fails at startup with a clear error.
- [ ] README documents precedence.

---

## 11. Body size limit for stored responses

**Problem.** A handler returning a very large body stores it in Redis for the whole TTL, which can
exhaust memory.

**Scope.**

- A `maxStoredBodyBytes` option (module and route), measured on the serialised stored response.
- When exceeded: the response is still sent, nothing is stored, the lock is released and a
  warning is logged; or, with `onTooLarge: 'error'`, the request fails with a stable error code
  `IDEMPOTENCY_RESPONSE_TOO_LARGE`.
- Out of scope: compression.

**Acceptance criteria.**

- [ ] End-to-end tests cover under, at and over the limit for both behaviours.
- [ ] The new error code is documented with the others.
- [ ] Default is unlimited (no behaviour change).

---

## 12. Example: payments endpoint with Stripe-style semantics

**Problem.** Payment APIs are the main use case, and users want a reference for doing it right
end to end.

**Scope.**

- `examples/payments-app`: a `POST /payments` endpoint with per-customer scope, Redis storage,
  a simulated payment provider that is slow and sometimes fails with 5xx, and a client script
  that retries with backoff using the same key.
- README explaining key generation on the client, retry policy, TTL choice and how 4xx and 5xx
  outcomes behave.

**Acceptance criteria.**

- [ ] The client script demonstrates that retries never charge twice.
- [ ] An end-to-end test runs the example in CI.

---

## 13. Compatibility table and automated tests against the latest Nest release

**Problem.** Support for new NestJS majors (for example Nest 12) is only discovered when users
report breakage.

**Scope.**

- A scheduled CI workflow (weekly) that installs `@nestjs/*@latest` and `@nestjs/*@next` and runs
  the full suite, opening an issue on failure.
- A compatibility table in the README listing tested Nest, Node, Express and Redis versions,
  updated when the matrix changes.
- Add each new Nest major to the peer dependency range and the PR matrix once it passes.

**Acceptance criteria.**

- [ ] Scheduled workflow runs and reports failures as issues.
- [ ] README table matches the CI matrix.
- [ ] Peer dependency ranges match the tested versions.
