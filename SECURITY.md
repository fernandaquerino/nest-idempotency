# Security policy

## Supported versions

Until 1.0, only the latest published `0.x` release receives security fixes.

| Version        | Supported |
| -------------- | --------- |
| latest `0.x`   | yes       |
| older releases | no        |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report it privately through GitHub: go to the repository's **Security** tab and choose
**Report a vulnerability** (GitHub private vulnerability reporting). Include:

- the affected version,
- a description of the issue and its impact,
- steps or a minimal app to reproduce it.

You can expect an acknowledgement within 7 days. Once the issue is confirmed, a fix is prepared
privately, released, and then disclosed in a GitHub security advisory that credits you unless you
prefer otherwise.

## Security notes for users

- **Stored responses can contain sensitive data.** The full response body of an idempotent route
  is kept in storage for `ttlSeconds`. Protect your Redis instance (authentication, TLS, network
  isolation) as you would your database, and keep the TTL no longer than your retry window.
- **Scope keys per user** with the `scope` option on authenticated routes. Without it, keys are
  namespaced per route only, and a client that guesses another client's key and payload for the
  same route would receive that client's stored response.
- **Class serialisation:** if you rely on `ClassSerializerInterceptor` and `@Exclude()` to hide
  fields, read the README FAQ: return plain objects from idempotent handlers or apply the
  serializer inside `@Idempotent()`, otherwise excluded fields can be stored and returned.
- **Fail-closed behaviour:** if the storage is unavailable, idempotent routes respond `500`
  rather than running the handler without protection.
