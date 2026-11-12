# Contributing

Thanks for helping improve nest-idempotency. Bug reports, docs fixes and pull requests are all
welcome.

## Before you start

- For a bug, open an issue with the bug report template and a minimal reproduction.
- For a feature, check [ROADMAP.md](./ROADMAP.md) and [docs/ISSUES.md](./docs/ISSUES.md)
  first, then open an issue to agree on the approach before writing code.
- For a security problem, do not open an issue: follow [SECURITY.md](./SECURITY.md).

## Development setup

You need Node.js 20 or later and, for the Redis suites, Docker (or any Redis 7 on
`localhost:6379`).

```bash
npm install
```

```bash
docker compose up -d --wait redis
```

```bash
REDIS_URL=redis://localhost:6379 npm run check
```

`npm run check` runs lint, typecheck, all tests and the build. Without `REDIS_URL`, the Redis
suites are skipped.

| Script              | What it does                                              |
| ------------------- | --------------------------------------------------------- |
| `npm test`          | Unit, contract and end-to-end tests (Vitest)              |
| `npm run lint`      | ESLint and a Prettier check                               |
| `npm run format`    | Formats every file with Prettier                          |
| `npm run typecheck` | `tsc --noEmit` over sources, tests and the example        |
| `npm run build`     | Builds `dist/` (ESM, CJS and type declarations) with tsup |
| `npm run test:dist` | Builds, then runs the end-to-end suites against `dist/`   |
| `npm run example`   | Builds and starts `examples/basic-app`                    |

## Project layout

```
src/                 library sources; src/index.ts is the public API
  storage/           storage interface and adapters
test/unit/           pure functions (key parsing, fingerprint)
test/contract/       the storage contract suite every adapter must pass
test/e2e/            real Nest apps over HTTP with supertest
examples/basic-app/  runnable sample app
docs/                spec, releasing guide, roadmap issues
```

## Guidelines

- **Tests first for behaviour changes.** A change to request handling needs an end-to-end test;
  a change to an adapter must keep the contract suite passing unchanged. A new adapter runs the
  contract suite, not a copy of it.
- **Atomic storage.** Adapter operations must never read and then write in two steps that
  another request can interleave with.
- **Public API discipline.** Everything exported from `src/index.ts` is public and must be
  documented in the README; nothing else is. Adding an export is an API decision, so mention it
  in the pull request.
- **No decorator metadata in `src/`.** The bundle is built with esbuild, which does not emit
  `design:paramtypes`. Inject dependencies with explicit `@Inject(...)`.
- **Supported versions.** Code must work with NestJS 10 and 11 on Node 20, 22 and 24; CI tests
  every combination.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`).

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change with tests and docs.
3. Add a changeset if the published package changes: `npx changeset` (see
   [docs/RELEASING.md](./docs/RELEASING.md)). Docs-only and test-only changes do not need one.
4. Run `npm run check` (with `REDIS_URL` set) and make sure it passes.
5. Open the pull request and fill in the template.

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
