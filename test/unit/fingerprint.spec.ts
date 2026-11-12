import { describe, expect, it } from 'vitest';
import { canonicalJson, computeFingerprint } from '../../src/fingerprint';

describe('canonicalJson', () => {
  it('sorts object keys', () => {
    expect(canonicalJson({ b: 1, a: 2, c: 3 })).toBe('{"a":2,"b":1,"c":3}');
  });

  it('sorts nested object keys, including objects inside arrays', () => {
    const a = { z: { y: 1, x: [{ q: 1, p: 2 }] }, a: true };
    const b = { a: true, z: { x: [{ p: 2, q: 1 }], y: 1 } };
    expect(canonicalJson(a)).toBe('{"a":true,"z":{"x":[{"p":2,"q":1}],"y":1}}');
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('keeps array order', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('sorts keys by code unit, not locale', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, _: 4, '10': 5, '9': 6 })).toBe(
      '{"10":5,"9":6,"B":2,"_":4,"a":3,"b":1}',
    );
  });

  it('matches JSON.stringify for primitives', () => {
    for (const v of ['x', 'quote"and\\slash', 0, -1.5, 1e21, true, false, null]) {
      expect(canonicalJson(v)).toBe(JSON.stringify(v));
    }
  });

  it('follows JSON.stringify rules for undefined, functions, symbols and non-finite numbers', () => {
    expect(canonicalJson(undefined)).toBeUndefined();
    expect(canonicalJson({ a: undefined, b: () => 1, c: Symbol('s'), d: 1 })).toBe('{"d":1}');
    expect(canonicalJson([undefined, () => 1, NaN, Infinity])).toBe('[null,null,null,null]');
  });

  it('honours toJSON, so dates become ISO strings', () => {
    const date = new Date('2026-01-02T03:04:05.000Z');
    expect(canonicalJson({ at: date })).toBe('{"at":"2026-01-02T03:04:05.000Z"}');
  });

  it('writes bigint as a decimal string', () => {
    expect(canonicalJson({ n: 12345678901234567890n })).toBe('{"n":"12345678901234567890"}');
  });

  it('writes binary data as base64', () => {
    expect(canonicalJson(new Uint8Array([1, 2, 3]))).toBe('{"$binary":"AQID"}');
    expect(canonicalJson(Buffer.from('hi'))).toBe('{"$binary":"aGk="}');
  });

  it('allows the same object to appear twice when it is not circular', () => {
    const shared = { x: 1 };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"x":1},"b":{"x":1}}');
  });

  it('throws on circular structures', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalJson(a)).toThrow(TypeError);
  });

  it('produces output that JSON.parse round-trips', () => {
    const value = { b: [1, { d: 'x', c: null }], a: { nested: true } };
    expect(JSON.parse(canonicalJson(value) as string)).toEqual(value);
  });
});

describe('computeFingerprint', () => {
  const base = { method: 'POST', path: '/orders', body: { amount: 10, currency: 'EUR' } };

  it('is a 64-character hex SHA-256', () => {
    expect(computeFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same input', () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint({ ...base }));
  });

  it('ignores body key order', () => {
    expect(computeFingerprint(base)).toBe(
      computeFingerprint({ ...base, body: { currency: 'EUR', amount: 10 } }),
    );
  });

  it('treats the method case-insensitively', () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint({ ...base, method: 'post' }));
  });

  it('changes when the method, path or body changes', () => {
    const fp = computeFingerprint(base);
    expect(computeFingerprint({ ...base, method: 'PUT' })).not.toBe(fp);
    expect(computeFingerprint({ ...base, path: '/orders/1' })).not.toBe(fp);
    expect(computeFingerprint({ ...base, body: { amount: 11, currency: 'EUR' } })).not.toBe(fp);
  });

  it('distinguishes a missing body from null, an empty object and an empty string', () => {
    const fps = [undefined, null, {}, ''].map((body) => computeFingerprint({ ...base, body }));
    expect(new Set(fps).size).toBe(4);
  });

  it('cannot be confused by newlines moved between path and body', () => {
    const a = computeFingerprint({ method: 'POST', path: '/a', body: 'b' });
    const b = computeFingerprint({ method: 'POST', path: '/a\n"b"', body: undefined });
    expect(a).not.toBe(b);
  });
});
