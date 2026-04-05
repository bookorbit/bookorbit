import { describe, expect, it } from 'vitest';

import { asRecord, asString, asNumber, asInteger } from './coerce';

describe('asRecord', () => {
  it('returns empty object for null', () => {
    expect(asRecord(null)).toEqual({});
  });

  it('returns empty object for undefined', () => {
    expect(asRecord(undefined)).toEqual({});
  });

  it('returns empty object for primitives', () => {
    expect(asRecord(42)).toEqual({});
    expect(asRecord('hello')).toEqual({});
    expect(asRecord(true)).toEqual({});
  });

  it('returns empty object for arrays', () => {
    expect(asRecord([1, 2, 3])).toEqual({});
  });

  it('returns the object itself for plain objects', () => {
    const obj = { host: 'localhost', port: 3306 };
    expect(asRecord(obj)).toBe(obj);
  });

  it('returns empty object for empty input', () => {
    expect(asRecord({})).toEqual({});
  });
});

describe('asString', () => {
  it('returns trimmed string for valid string', () => {
    expect(asString('  hello  ')).toBe('hello');
  });

  it('returns null for empty string', () => {
    expect(asString('')).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    expect(asString('   ')).toBeNull();
  });

  it('converts numbers and booleans to strings', () => {
    expect(asString(42)).toBe('42');
    expect(asString(true)).toBe('true');
  });

  it('returns null for null, undefined, and objects', () => {
    expect(asString(null)).toBeNull();
    expect(asString(undefined)).toBeNull();
    expect(asString({})).toBeNull();
  });

  it('preserves internal whitespace', () => {
    expect(asString('hello world')).toBe('hello world');
  });
});

describe('asNumber', () => {
  it('returns number for valid number', () => {
    expect(asNumber(42)).toBe(42);
    expect(asNumber(3.14)).toBe(3.14);
    expect(asNumber(0)).toBe(0);
    expect(asNumber(-1)).toBe(-1);
  });

  it('parses numeric strings', () => {
    expect(asNumber('42')).toBe(42);
    expect(asNumber('3.14')).toBe(3.14);
    expect(asNumber('0')).toBe(0);
  });

  it('returns null for NaN', () => {
    expect(asNumber(NaN)).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(asNumber(Infinity)).toBeNull();
    expect(asNumber(-Infinity)).toBeNull();
  });

  it('coerces empty string to 0', () => {
    expect(asNumber('')).toBe(0);
  });

  it('returns null for non-numeric strings', () => {
    expect(asNumber('abc')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(asNumber(null)).toBeNull();
    expect(asNumber(undefined)).toBeNull();
  });

  it('coerces empty array to 0', () => {
    expect(asNumber([])).toBe(0);
  });

  it('returns null for non-empty objects', () => {
    expect(asNumber({})).toBeNull();
  });
});

describe('asInteger', () => {
  it('returns integer for whole numbers', () => {
    expect(asInteger(42)).toBe(42);
    expect(asInteger(0)).toBe(0);
    expect(asInteger(-5)).toBe(-5);
  });

  it('rounds floating point numbers', () => {
    expect(asInteger(3.14)).toBe(3);
    expect(asInteger(1.5)).toBe(2);
    expect(asInteger(2.9)).toBe(3);
  });

  it('parses integer strings', () => {
    expect(asInteger('42')).toBe(42);
    expect(asInteger('0')).toBe(0);
  });

  it('rounds float strings', () => {
    expect(asInteger('3.14')).toBe(3);
  });

  it('returns null for non-numeric values', () => {
    expect(asInteger('abc')).toBeNull();
    expect(asInteger(null)).toBeNull();
    expect(asInteger(undefined)).toBeNull();
    expect(asInteger(NaN)).toBeNull();
    expect(asInteger(Infinity)).toBeNull();
  });
});
