/** Name of the request header defined by the IETF Idempotency-Key draft. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

/** Maximum key length accepted by this module. */
export const MAX_KEY_LENGTH = 255;

export type ParsedIdempotencyKey =
  | { readonly status: 'missing' }
  | { readonly status: 'invalid' }
  | { readonly status: 'valid'; readonly key: string };

const VISIBLE_ASCII = /^[\x21-\x7e]+$/;

/**
 * Returns true when `key` is 1–255 visible ASCII characters (0x21–0x7E). Spaces, control
 * characters and non-ASCII characters are rejected.
 */
export function isValidIdempotencyKey(key: string): boolean {
  return key.length >= 1 && key.length <= MAX_KEY_LENGTH && VISIBLE_ASCII.test(key);
}

/**
 * Parses the raw `Idempotency-Key` header value as received by Node.
 *
 * - `undefined` or an empty value is `missing`.
 * - The draft defines the header as a Structured Field String (`"abc"`), but most clients
 *   send the bare token (`abc`). Both are accepted; surrounding double quotes are removed.
 * - Repeated headers (an array, or values Node joined with `", "`) are `invalid`, because
 *   a request must carry exactly one key.
 */
export function parseIdempotencyKeyHeader(
  raw: string | readonly string[] | undefined,
): ParsedIdempotencyKey {
  if (raw === undefined) return { status: 'missing' };
  if (typeof raw !== 'string') {
    if (raw.length === 0) return { status: 'missing' };
    if (raw.length > 1) return { status: 'invalid' };
    raw = raw[0] as string;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) return { status: 'missing' };

  let key = trimmed;
  if (key.length >= 2 && key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
    // Inside a Structured Field String, `"` and `\` must be escaped. Escapes are not
    // supported for keys, so any remaining quote or backslash makes the key invalid.
    if (key.includes('"') || key.includes('\\')) return { status: 'invalid' };
  }

  return isValidIdempotencyKey(key) ? { status: 'valid', key } : { status: 'invalid' };
}
