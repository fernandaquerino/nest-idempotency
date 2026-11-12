# Releasing

Releases are automated with [Changesets](https://github.com/changesets/changesets) and the
[Release workflow](../.github/workflows/release.yml). Nobody publishes from a laptop.

## Day to day

1. Every pull request that changes the published package adds a changeset:

   ```bash
   npx changeset
   ```

   Pick the bump (`patch` for fixes, `minor` for features, `major` for breaking changes; while
   the version is `0.x`, breaking changes are `minor`) and write a one-line summary for the
   changelog. Commit the generated file in `.changeset/`.

2. When pull requests with changesets are merged into `main`, the Release workflow opens or
   updates a **"chore: version packages"** pull request. It bumps `package.json`, writes
   `CHANGELOG.md` and deletes the consumed changesets.

3. Merging that pull request runs the workflow again. With no changesets left, it runs the
   quality gates, builds and publishes the new version to npm **with provenance**, then pushes a
   `vX.Y.Z` git tag.

## One-time setup before the first release

1. Confirm the package name `nest-idempotency` is still free on npm (`npm view nest-idempotency`
   should return 404). If it is taken, rename the package to the fallback
   `@fernandaquerino/nestjs-idempotency` in `package.json`, `.changeset/initial-release.md`
   and the README.
2. Create an npm **granular access token** with publish rights for the package and add it as
   the `NPM_TOKEN` repository secret (Settings → Secrets and variables → Actions). Never commit
   it.
3. Allow the workflow to open pull requests: Settings → Actions → General → Workflow
   permissions → "Allow GitHub Actions to create and approve pull requests".
4. Make sure the default branch is `main`.

The pending changeset `.changeset/initial-release.md` is a `minor` bump from `0.0.0`, so the
first version pull request releases **v0.1.0**.

## Checking a release locally (without publishing)

```bash
npm run check
```

```bash
npm pack --dry-run
```

`npm pack --dry-run` lists the files that would be published: `dist/`, `README.md`, `LICENSE`
and `package.json`.
