// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { COMPACT_MAX_SHELF_ROWS, MAX_SHELF_ROWS, chunkIntoBands, effectiveShelfRows, normalizeShelfRows, shelfBookLimit } from './shelf-rows'

describe('normalizeShelfRows', () => {
  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
  ])('keeps %s in range', (value, expected) => {
    expect(normalizeShelfRows(value)).toBe(expected)
  })

  it.each([
    ['4', 3],
    [99, MAX_SHELF_ROWS],
    [0, 1],
    [-2, 1],
  ])('clamps %s to the supported range', (value, expected) => {
    expect(normalizeShelfRows(value)).toBe(expected)
  })

  it('parses numeric strings the way stored limits are parsed', () => {
    expect(normalizeShelfRows('2')).toBe(2)
  })

  it('rounds fractional values rather than producing a partial row', () => {
    expect(normalizeShelfRows(2.6)).toBe(3)
    expect(normalizeShelfRows(1.2)).toBe(1)
  })

  it.each([[undefined], [null], ['many'], [Number.NaN], [{}], [[]]])('falls back to one row for %s', (value) => {
    expect(normalizeShelfRows(value)).toBe(1)
  })
})

describe('effectiveShelfRows', () => {
  it('honors the configured rows on a roomy viewport', () => {
    expect(effectiveShelfRows(3, false)).toBe(3)
    expect(effectiveShelfRows(2, false)).toBe(2)
  })

  it('caps at two rows below the sm breakpoint', () => {
    expect(effectiveShelfRows(3, true)).toBe(COMPACT_MAX_SHELF_ROWS)
  })

  it('leaves rows at or under the compact cap untouched', () => {
    expect(effectiveShelfRows(2, true)).toBe(2)
    expect(effectiveShelfRows(1, true)).toBe(1)
  })

  it('normalizes out-of-range input before capping', () => {
    expect(effectiveShelfRows(99, true)).toBe(COMPACT_MAX_SHELF_ROWS)
    expect(effectiveShelfRows(0, false)).toBe(1)
  })
})

describe('shelfBookLimit', () => {
  it('scales the per-row limit by the row count', () => {
    expect(shelfBookLimit(20, 1)).toBe(20)
    expect(shelfBookLimit(20, 2)).toBe(40)
  })

  it('clamps to the maximum the server accepts', () => {
    expect(shelfBookLimit(20, 3)).toBe(50)
  })

  it('respects a smaller stored per-row limit', () => {
    expect(shelfBookLimit(9, 3)).toBe(27)
  })

  it('degrades a nonsense per-row limit to one book per row', () => {
    expect(shelfBookLimit(0, 1)).toBe(1)
    expect(shelfBookLimit(-5, 2)).toBe(2)
    expect(shelfBookLimit(Number.NaN, 3)).toBe(3)
  })
})

describe('chunkIntoBands', () => {
  const books = Array.from({ length: 6 }, (_, index) => index + 1)

  it('returns a single band for a one-row shelf', () => {
    expect(chunkIntoBands(books, 1)).toEqual([[1, 2, 3, 4, 5, 6]])
  })

  it('fills left to right so the first band holds the leading books', () => {
    expect(chunkIntoBands(books, 2)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ])
  })

  it('keeps reading order across three bands', () => {
    expect(chunkIntoBands(books, 3)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ])
  })

  it('puts the remainder in the trailing band', () => {
    expect(chunkIntoBands([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2, 3],
      [4, 5],
    ])
  })

  it('drops bands that would render empty', () => {
    expect(chunkIntoBands([1, 2], 3)).toEqual([[1], [2]])
    expect(chunkIntoBands([], 3)).toEqual([])
  })

  it('preserves every item exactly once', () => {
    const many = Array.from({ length: 47 }, (_, index) => index)

    expect(chunkIntoBands(many, 3).flat()).toEqual(many)
  })
})
