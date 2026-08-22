// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { FontNamedInstance, UserFont } from '@bookorbit/types'
import { builtInVariants, closestVariant, familyVariants, isSameVariant, variantKey } from '../font-variants'

function makeFont(overrides: Partial<UserFont> = {}): UserFont {
  return {
    id: 1,
    familyName: 'Literata',
    originalFileName: 'Literata.ttf',
    format: 'ttf',
    weight: 400,
    style: 'normal',
    weightMin: null,
    weightMax: null,
    instances: null,
    fileSize: 1000,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function variable(instances: FontNamedInstance[], overrides: Partial<UserFont> = {}): UserFont {
  return makeFont({ weightMin: 100, weightMax: 900, instances, ...overrides })
}

describe('familyVariants', () => {
  it('offers one variant per uploaded static file', () => {
    const variants = familyVariants([makeFont({ id: 1, weight: 400 }), makeFont({ id: 2, weight: 700 })])

    expect(variants).toEqual([
      { name: null, weight: 400, style: 'normal' },
      { name: null, weight: 700, style: 'normal' },
    ])
  })

  it('offers a variable file every style its designer named', () => {
    const variants = familyVariants([
      variable([
        { name: 'Light', weight: 300, style: 'normal' },
        { name: 'Bold', weight: 700, style: 'normal' },
      ]),
    ])

    expect(variants).toEqual([
      { name: 'Light', weight: 300, style: 'normal' },
      { name: null, weight: 400, style: 'normal' },
      { name: 'Bold', weight: 700, style: 'normal' },
    ])
  })

  it('falls back to the declared weight for a variable file that named nothing', () => {
    const variants = familyVariants([variable([], { weight: 500 })])

    expect(variants).toEqual([{ name: null, weight: 500, style: 'normal' }])
  })

  it('merges a variable upright with a static italic, as families are often shipped', () => {
    const variants = familyVariants([
      variable([
        { name: 'Regular', weight: 400, style: 'normal' },
        { name: 'Bold', weight: 700, style: 'normal' },
      ]),
      makeFont({ id: 2, weight: 400, style: 'italic' }),
    ])

    expect(variants).toEqual([
      { name: 'Regular', weight: 400, style: 'normal' },
      { name: 'Bold', weight: 700, style: 'normal' },
      { name: null, weight: 400, style: 'italic' },
    ])
  })

  it('keeps the named copy when two files offer the same style', () => {
    const variants = familyVariants([makeFont({ id: 2, weight: 700 }), variable([{ name: 'Bold', weight: 700, style: 'normal' }], { weight: 700 })])

    expect(variants).toEqual([{ name: 'Bold', weight: 700, style: 'normal' }])
  })

  it('keeps the default face when the font does not name that instance', () => {
    const variants = familyVariants([variable([{ name: 'Bold', weight: 700, style: 'normal' }], { weight: 350 })])

    expect(variants).toEqual([
      { name: null, weight: 350, style: 'normal' },
      { name: 'Bold', weight: 700, style: 'normal' },
    ])
  })

  it('sorts upright before italic and light before heavy', () => {
    const variants = familyVariants([
      makeFont({ id: 1, weight: 700, style: 'italic' }),
      makeFont({ id: 2, weight: 700 }),
      makeFont({ id: 3, weight: 300, style: 'italic' }),
      makeFont({ id: 4, weight: 300 }),
    ])

    expect(variants.map(variantKey)).toEqual(['300:normal', '700:normal', '300:italic', '700:italic'])
  })

  it('ignores a weight range that spans nothing', () => {
    const variants = familyVariants([makeFont({ weightMin: 400, weightMax: 400, instances: [{ name: 'Regular', weight: 400, style: 'normal' }] })])

    expect(variants).toEqual([{ name: null, weight: 400, style: 'normal' }])
  })
})

describe('builtInVariants', () => {
  it('offers the four styles a system stack can always produce', () => {
    expect(builtInVariants().map(variantKey)).toEqual(['400:normal', '700:normal', '400:italic', '700:italic'])
  })
})

describe('closestVariant', () => {
  const variants = [
    { weight: 300, style: 'normal' as const },
    { weight: 700, style: 'normal' as const },
    { weight: 400, style: 'italic' as const },
  ]

  it('keeps the style and moves to the nearest weight', () => {
    expect(closestVariant(variants, { weight: 500, style: 'normal' })).toEqual({ weight: 300, style: 'normal' })
  })

  it('prefers a matching style over a closer weight', () => {
    expect(closestVariant(variants, { weight: 700, style: 'italic' })).toEqual({ weight: 400, style: 'italic' })
  })

  it('crosses styles only when the wanted one is absent', () => {
    expect(closestVariant([{ weight: 700, style: 'normal' }], { weight: 400, style: 'italic' })).toEqual({ weight: 700, style: 'normal' })
  })

  it('returns null when there is nothing to fall back to', () => {
    expect(closestVariant([], { weight: 400, style: 'normal' })).toBeNull()
  })
})

describe('isSameVariant', () => {
  it('matches on weight and style together', () => {
    expect(isSameVariant({ weight: 400, style: 'normal' }, { weight: 400, style: 'normal' })).toBe(true)
    expect(isSameVariant({ weight: 400, style: 'normal' }, { weight: 400, style: 'italic' })).toBe(false)
    expect(isSameVariant({ weight: 400, style: 'normal' }, { weight: 700, style: 'normal' })).toBe(false)
  })
})
