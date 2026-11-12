/**
 * Body of a stored response, tagged by how it must be sent again on replay.
 *
 * - `json`: a JSON-serialisable value returned by the handler (object, array, number,
 *   boolean or `null`). Nest sends it again as `application/json`.
 * - `text`: a string returned by the handler.
 * - `binary`: a `Buffer` or typed array, stored as base64.
 * - `empty`: the handler returned `undefined`.
 * - `exception`: the handler threw an `HttpException` with a `4xx` status; `value` is its
 *   `getResponse()`. Replays throw an `HttpException` with this value and the stored status,
 *   so exception filters format it the same way.
 */
export type StoredBody =
  | { readonly type: 'json'; readonly value: unknown }
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'binary'; readonly base64: string }
  | { readonly type: 'empty' }
  | { readonly type: 'exception'; readonly value: unknown };

/** A response captured from the first execution of an idempotent handler. */
export interface StoredResponse {
  /** HTTP status code sent to the client. */
  readonly statusCode: number;
  /** Response headers kept for replay (lower-case names), already filtered by the allow-list. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: StoredBody;
}

/** A request with this key is running and holds the lock. */
export interface InProgressRecord {
  readonly status: 'IN_PROGRESS';
  readonly fingerprint: string;
  /** Epoch milliseconds when the lock was acquired. */
  readonly createdAt: number;
  /** Epoch milliseconds when the lock expires if it is not completed or released. */
  readonly lockExpiresAt: number;
}

/** The first request with this key finished and its response is stored. */
export interface CompletedRecord {
  readonly status: 'COMPLETED';
  readonly fingerprint: string;
  /** Epoch milliseconds when the lock was acquired. */
  readonly createdAt: number;
  /** Epoch milliseconds when the response was stored. */
  readonly completedAt: number;
  readonly response: StoredResponse;
}

/** What a storage adapter holds for one idempotency key. */
export type IdempotencyRecord = InProgressRecord | CompletedRecord;

/** Options for {@link IdempotencyStorage.acquire}. */
export interface AcquireOptions {
  /** Fingerprint of the request taking the lock. */
  readonly fingerprint: string;
  /** How long the lock lives before it expires on its own, in milliseconds. */
  readonly lockTimeoutMs: number;
}

/**
 * Result of {@link IdempotencyStorage.acquire}: either the caller now holds the lock and
 * gets a token that proves it, or the key is already taken and the caller gets the record.
 */
export type AcquireResult =
  | { readonly acquired: true; readonly lockToken: string }
  | { readonly acquired: false; readonly record: IdempotencyRecord };

/** Options for {@link IdempotencyStorage.complete}. */
export interface CompleteOptions {
  /** Fingerprint of the request that produced the response. */
  readonly fingerprint: string;
  /** Token returned by `acquire`. */
  readonly lockToken: string;
  readonly response: StoredResponse;
  /** How long the completed response is kept, in milliseconds. */
  readonly ttlMs: number;
}

/**
 * Storage contract for idempotency records. Every adapter must pass the shared contract
 * test suite in `test/contract`.
 *
 * Implementations **must** make `acquire`, `complete` and `release` atomic: never read a
 * record and then write it in two separate steps that another caller can interleave with.
 */
export interface IdempotencyStorage {
  /**
   * Atomically takes the lock for `key` if no record exists (or the existing lock expired),
   * storing an `IN_PROGRESS` record that expires after `lockTimeoutMs`. Otherwise returns
   * the existing record unchanged.
   */
  acquire(key: string, options: AcquireOptions): Promise<AcquireResult>;

  /**
   * Atomically replaces the `IN_PROGRESS` record held with `lockToken` by a `COMPLETED`
   * record that expires after `ttlMs`. Also succeeds when the lock already expired and no
   * other request took the key. Returns `false`, changing nothing, when another request
   * holds the key or a response is already stored.
   */
  complete(key: string, options: CompleteOptions): Promise<boolean>;

  /**
   * Atomically deletes the `IN_PROGRESS` record for `key` if it is held with `lockToken`,
   * so the request can be retried. Returns `false` and changes nothing otherwise; a
   * `COMPLETED` record is never deleted by `release`.
   */
  release(key: string, lockToken: string): Promise<boolean>;

  /** Returns the live record for `key`, or `null` if there is none or it expired. */
  get(key: string): Promise<IdempotencyRecord | null>;
}
