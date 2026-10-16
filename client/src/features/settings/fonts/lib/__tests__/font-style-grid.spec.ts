// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { FontNamedInstance, UserFont } from '@bookorbit/types'
import { styleGrid, styleSummary } from '../font-style-grid'

function font(overrides: Partial<UserFont> = {}): UserFont {
  return {
    id: 1,
    familyName: 'Family',
    originalFileName: 'Family.ttf',
    format: 'ttf',
    weight: 400,
    style: 'normal',
    weightMin: null,
    weightMax: null,
    instances: null,
    fileSize: 1000,
    createdAt: '2026-09-21T00:00:00.000Z',
    ...overrides,
  }
}

const named = (style: 'normal' | 'italic', names: string[], start: number): FontNamedInstance[] =>
  names.map((name, index) => ({ name, weight: start + index * 100, style }))

/** Literata as the dev server holds it: a variable upright and a variable italic, 200-900 each. */
const literata = [
  font({
    id: 8,
    weightMin: 200,
    weightMax: 900,
    instances: named('normal', ['ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black'], 200),
  }),
  font({
    id: 9,
    style: 'italic',
    weightMin: 200,
    weightMax: 900,
    instances: named(
      'italic',
      ['ExtraLight Italic', 'Light Italic', 'Italic', 'Medium Italic', 'SemiBold Italic', 'Bold Italic', 'ExtraBold Italic', 'Black Italic'],
      200,
    ),
  }),
]

const states = (rows: ReturnType<typeof styleGrid>, style: 'normal' | 'italic') =>
  rows.find((row) => row.style === style)!.cells.map((cell) => cell.state)

describe('styleGrid', () => {
  it('marks a lone static face in its own column and nothing else', () => {
    const rows = styleGrid([font({ weight: 500 })])

    expect(states(rows, 'normal')).toEqual(['none', 'none', 'none', 'none', 'static', 'none', 'none', 'none', 'none'])
    expect(states(rows, 'italic').every((state) => state === 'none')).toBe(true)
    expect(rows[0]!.ranges).toEqual([])
  })

  it('draws a variable axis as a span with a mark for each style it offers', () => {
    const rows = styleGrid(literata)

    for (const style of ['normal', 'italic'] as const) {
      expect(states(rows, style)).toEqual(['none', 'range', 'range', 'range', 'range', 'range', 'range', 'range', 'range'])
      expect(rows.find((row) => row.style === style)!.ranges).toEqual([{ from: 1, to: 8 }])
    }
  })

  it('keeps a static italic beside a variable upright apart', () => {
    const rows = styleGrid([
      font({ weightMin: 100, weightMax: 900, weight: 100, instances: named('normal', ['Thin', 'Regular'], 100) }),
      font({ id: 2, style: 'italic' }),
    ])

    expect(rows[0]!.ranges).toEqual([{ from: 0, to: 8 }])
    expect(states(rows, 'italic')[3]).toBe('static')
    expect(rows[1]!.ranges).toEqual([])
  })

  it('puts an off-grid weight in the nearest column', () => {
    const rows = styleGrid([font({ weight: 350 }), font({ id: 2, weight: 640 })])

    expect(states(rows, 'normal')[3]).toBe('static')
    expect(states(rows, 'normal')[5]).toBe('static')
  })
})

describe('styleSummary', () => {
  it('names the single style a one-file family offers', () => {
    expect(styleSummary([font({ weight: 500 })])).toEqual({ kind: 'single', variant: { name: null, weight: 500, style: 'normal' } })
  })

  it('counts the styles of a variable family and notes the italics', () => {
    expect(styleSummary(literata)).toEqual({ kind: 'many', count: 16, italics: true })
  })

  it('says when a family has no italics at all', () => {
    expect(styleSummary([font({ weight: 400 }), font({ id: 2, weight: 700 })])).toEqual({ kind: 'many', count: 2, italics: false })
  })

  it('is empty for an empty family', () => {
    expect(styleSummary([])).toEqual({ kind: 'empty' })
  })
})
