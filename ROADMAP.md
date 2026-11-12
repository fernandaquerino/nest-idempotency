# Roadmap

Phase 1 (complete): `IdempotencyModule` with `forRoot` / `forRootAsync`, the `@Idempotent()`
decorator, in-memory and Redis storage, a shared storage contract suite and end-to-end tests for
every documented behaviour, on NestJS 10 and 11 with Express.

The items below are planned, not implemented. Each links to a full issue description with the
problem, scope and acceptance criteria in [docs/ISSUES.md](./docs/ISSUES.md). The order is a rough
priority, not a commitment.

| #   | Item                                                                                                                                                         | Area        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 1   | [Fastify adapter support](./docs/ISSUES.md#1-fastify-adapter-support)                                                                                        | Platforms   |
| 2   | [Prisma / PostgreSQL storage adapter](./docs/ISSUES.md#2-prisma--postgresql-storage-adapter)                                                                 | Storage     |
| 3   | [TypeORM storage adapter](./docs/ISSUES.md#3-typeorm-storage-adapter)                                                                                        | Storage     |
| 4   | [Response header allow-list and deny-list options](./docs/ISSUES.md#4-response-header-allow-list-and-deny-list-options)                                      | Options     |
| 5   | [Metrics hooks (hit, miss, conflict, reuse)](./docs/ISSUES.md#5-metrics-hooks-hit-miss-conflict-reuse)                                                       | Operations  |
| 6   | [GraphQL mutations support](./docs/ISSUES.md#6-graphql-mutations-support)                                                                                    | Platforms   |
| 7   | [Microservices (message patterns) support](./docs/ISSUES.md#7-microservices-message-patterns-support-with-a-message-id-key)                                  | Platforms   |
| 8   | [Docs site deployed with GitHub Pages](./docs/ISSUES.md#8-docs-site-deployed-with-github-pages)                                                              | Docs        |
| 9   | [Benchmarks](./docs/ISSUES.md#9-benchmarks)                                                                                                                  | Operations  |
| 10  | [`forFeature` per-module options](./docs/ISSUES.md#10-forfeature-per-module-options)                                                                         | Options     |
| 11  | [Body size limit for stored responses](./docs/ISSUES.md#11-body-size-limit-for-stored-responses)                                                             | Options     |
| 12  | [Example: payments endpoint with Stripe-style semantics](./docs/ISSUES.md#12-example-payments-endpoint-with-stripe-style-semantics)                          | Docs        |
| 13  | [Compatibility table and tests against the latest Nest release](./docs/ISSUES.md#13-compatibility-table-and-automated-tests-against-the-latest-nest-release) | Maintenance |

Want to work on one? Open an issue (or comment on the existing one) first, as described in
[CONTRIBUTING.md](./CONTRIBUTING.md).
