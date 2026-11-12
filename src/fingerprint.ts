import { createHash } from 'node:crypto';

/** The parts of a request that the default fingerprint covers. */
export interface FingerprintInput {
  /** HTTP method, compared case-insensitively. */
  method: string;
  /** Request path without the query string, for example `/orders/42`. */
  path: string;
  /** Parsed request body. `undefined` and `null` are distinct values. */
  body: unknown;
}

/**
 * Serialises `value` as JSON with object keys sorted recursively, so that two bodies that
 * differ only in key order produce the same string.
 *
 * Follows `JSON.stringify` semantics otherwise: `toJSON()` is honoured (so dates become ISO
 * strings), `undefined`, functions and symbols are dropped from objects and become `null`
 * in arrays, and non-finite numbers become `null`. `bigint` values are written as decimal
 * strings and binary data (`Buffer`, typed arrays) as `{"$binary":"<base64>"}`.
 * Circular references throw a `TypeError`.
 *
 * Returns `undefined` when `value` itself is not serialisable (for example `undefined`).
 */
export function canonicalJson(value: unknown): string | undefined {
  return serialise(value, new Set());
}

function serialise(value: unknown, ancestors: Set<object>): string | undefined {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value);
    case 'number':
      return Number.isFinite(value) ? JSON.stringify(value) : 'null';
    case 'bigint':
      return JSON.stringify(value.toString());
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined;
  }

  const obj = value as object;

  if (ArrayBuffer.isView(obj)) {
    const bytes = Buffer.from(obj.buffer, obj.byteOffset, obj.byteLength);
    return `{"$binary":${JSON.stringify(bytes.toString('base64'))}}`;
  }

  if (typeof (obj as { toJSON?: unknown }).toJSON === 'function') {
    return serialise((obj as { toJSON: () => unknown }).toJSON(), ancestors);
  }

  if (ancestors.has(obj)) {
    throw new TypeError('canonicalJson: cannot serialise a circular structure');
  }
  ancestors.add(obj);

  try {
    if (Array.isArray(obj)) {
      const items = obj.map((item) => serialise(item, ancestors) ?? 'null');
      return `[${items.join(',')}]`;
    }

    const record = obj as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(record).sort()) {
      const serialised = serialise(record[key], ancestors);
      if (serialised !== undefined) parts.push(`${JSON.stringify(key)}:${serialised}`);
    }
    return `{${parts.join(',')}}`;
  } finally {
    ancestors.delete(obj);
  }
}

/**
 * The default request fingerprint: the hex SHA-256 of the upper-cased method, the path and
 * the canonical JSON of the body, separated by newlines.
 */
export function computeFingerprint(input: FingerprintInput): string {
  const body = canonicalJson(input.body) ?? '';
  return createHash('sha256')
    .update(`${input.method.toUpperCase()}\n${input.path}\n${body}`)
    .digest('hex');
}
