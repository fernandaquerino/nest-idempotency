import { describe, expect, it } from 'vitest';
import { isValidIdempotencyKey, MAX_KEY_LENGTH, parseIdempotencyKeyHeader } from '../../src/key';

describe('isValidIdempotencyKey', () => {
  it.each([
    'a',
    '8e03978e-40d5-43e8-bc93-6894a57f9324',
    '!~#$%&()*+,-./:;<=>?@[]^_`{|}',
    'x'.repeat(MAX_KEY_LENGTH),
  ])('accepts %j', (key) => {
    expect(isValidIdempotencyKey(key)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['too long', 'x'.repeat(MAX_KEY_LENGTH + 1)],
    ['space', 'a b'],
    ['tab', 'a\tb'],
    ['newline', 'a\nb'],
    ['DEL', 'a\x7fb'],
    ['NUL', 'a\x00b'],
    ['non-ASCII', 'café'],
    ['emoji', 'key-🔑'],
  ])('rejects %s', (_label, key) => {
    expect(isValidIdempotencyKey(key)).toBe(false);
  });
});

describe('parseIdempotencyKeyHeader', () => {
  it('treats undefined, empty and blank values as missing', () => {
    expect(parseIdempotencyKeyHeader(undefined)).toEqual({ status: 'missing' });
    expect(parseIdempotencyKeyHeader('')).toEqual({ status: 'missing' });
    expect(parseIdempotencyKeyHeader('   ')).toEqual({ status: 'missing' });
    expect(parseIdempotencyKeyHeader([])).toEqual({ status: 'missing' });
  });

  it('returns a bare token as is', () => {
    expect(parseIdempotencyKeyHeader('abc-123')).toEqual({ status: 'valid', key: 'abc-123' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseIdempotencyKeyHeader('  abc  ')).toEqual({ status: 'valid', key: 'abc' });
  });

  it('unwraps a Structured Field String', () => {
    expect(parseIdempotencyKeyHeader('"8e03978e-40d5"')).toEqual({
      status: 'valid',
      key: '8e03978e-40d5',
    });
  });

  it('rejects an empty or escaped Structured Field String', () => {
    expect(parseIdempotencyKeyHeader('""')).toEqual({ status: 'invalid' });
    expect(parseIdempotencyKeyHeader('"a\\"b"')).toEqual({ status: 'invalid' });
    expect(parseIdempotencyKeyHeader('"a\\b"')).toEqual({ status: 'invalid' });
  });

  it('keeps a lone quote as part of the key', () => {
    expect(parseIdempotencyKeyHeader('"abc')).toEqual({ status: 'valid', key: '"abc' });
  });

  it('rejects repeated headers', () => {
    expect(parseIdempotencyKeyHeader(['a', 'b'])).toEqual({ status: 'invalid' });
    expect(parseIdempotencyKeyHeader('a, b')).toEqual({ status: 'invalid' });
  });

  it('accepts a single-element array', () => {
    expect(parseIdempotencyKeyHeader(['abc'])).toEqual({ status: 'valid', key: 'abc' });
  });

  it('rejects keys longer than the maximum, after unwrapping', () => {
    expect(parseIdempotencyKeyHeader(`"${'x'.repeat(MAX_KEY_LENGTH)}"`)).toEqual({
      status: 'valid',
      key: 'x'.repeat(MAX_KEY_LENGTH),
    });
    expect(parseIdempotencyKeyHeader('x'.repeat(MAX_KEY_LENGTH + 1))).toEqual({
      status: 'invalid',
    });
  });

  it('rejects non-ASCII characters', () => {
    expect(parseIdempotencyKeyHeader('clé')).toEqual({ status: 'invalid' });
  });
});
