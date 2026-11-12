import { describe, expect, it } from 'vitest';
import * as api from '../../src';

describe('package entry', () => {
  it('loads', () => {
    expect(api).toBeTypeOf('object');
  });
});
