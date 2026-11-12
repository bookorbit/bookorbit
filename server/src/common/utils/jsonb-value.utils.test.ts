import { isJsonbStorable, isPlainJsonObject } from './jsonb-value.utils';

describe('isPlainJsonObject', () => {
  it('takes objects JSON makes and refuses everything else', () => {
    expect(isPlainJsonObject({ a: 1 })).toBe(true);
    expect(isPlainJsonObject(Object.create(null))).toBe(true);
    for (const value of [null, [], 'a', 1, new Date()]) expect(isPlainJsonObject(value)).toBe(false);
  });
});

describe('isJsonbStorable', () => {
  it('refuses NUL characters and unpaired surrogates in keys and values, at any depth', () => {
    expect(isJsonbStorable({ a: ['b', { c: 'd 😀' }] })).toBe(true);
    expect(isJsonbStorable({ a: ['b\u0000'] })).toBe(false);
    expect(isJsonbStorable({ ['\uD800']: 1 })).toBe(false);
    expect(isJsonbStorable({ a: { b: '\uDC00' } })).toBe(false);
  });
});
