import { describe, expect, it } from 'vitest';

import { sha256Hex, stableJsonStringify } from './hash';

describe('migration hash helpers', () => {
  it('stableJsonStringify sorts object keys recursively', () => {
    const left = stableJsonStringify({ b: 1, a: { d: 2, c: 3 } });
    const right = stableJsonStringify({ a: { c: 3, d: 2 }, b: 1 });
    expect(left).toBe(right);
  });

  it('sha256Hex returns the same hash for semantically identical objects', () => {
    const left = sha256Hex({ z: [2, 1], a: { y: true, x: false } });
    const right = sha256Hex({ a: { x: false, y: true }, z: [2, 1] });
    expect(left).toBe(right);
  });
});
