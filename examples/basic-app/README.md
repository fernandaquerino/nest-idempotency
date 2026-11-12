# basic-app

A small NestJS app that uses `nest-idempotency` to make order creation safe to retry.

- `POST /orders` requires an `Idempotency-Key` header. Creating an order takes one second, so
  you can see what a concurrent retry gets.
- `POST /orders/quote` accepts the header but does not require it.
- `GET /orders/count` shows how many orders exist.

Storage is in memory by default, or Redis when `REDIS_URL` is set. Keys are scoped per user
with the `X-User-Id` header.

## Run it

From the repository root:

```bash
npm install
npm run example
```

With Redis:

```bash
docker compose up -d --wait redis
REDIS_URL=redis://localhost:6379 npm run example
```

The app lives inside the package, so `import ... from 'nest-idempotency'` resolves to the
locally built package. In your own app, install it from npm instead.

## Try it

Without a key, the request is rejected with `400 IDEMPOTENCY_KEY_MISSING`:

```bash
curl -i -X POST localhost:3000/orders -H 'Content-Type: application/json' -d '{"item":"book","quantity":1}'
```

Create an order:

```bash
curl -i -X POST localhost:3000/orders -H 'Idempotency-Key: order-123' -H 'Content-Type: application/json' -d '{"item":"book","quantity":1}'
```

Run the same command again within a second and you get `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`
with `Retry-After: 1`. Run it after that and you get the same `201` response with
`idempotent-replayed: true`, and no new order:

```bash
curl localhost:3000/orders/count
```

Reuse the key with a different body and you get `422 IDEMPOTENCY_KEY_REUSED`:

```bash
curl -i -X POST localhost:3000/orders -H 'Idempotency-Key: order-123' -H 'Content-Type: application/json' -d '{"item":"pen","quantity":2}'
```

The same key from another user is a separate operation:

```bash
curl -i -X POST localhost:3000/orders -H 'Idempotency-Key: order-123' -H 'X-User-Id: alice' -H 'Content-Type: application/json' -d '{"item":"pen","quantity":2}'
```
