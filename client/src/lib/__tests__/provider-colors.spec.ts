import { describe, expect, it } from 'vitest'

import { getProviderColor, providerBadgeStyle, providerChipStyle, PROVIDER_SHORT_LABELS } from '../provider-colors'

const RANOBEDB_COLOR = '#a78cff'

describe('getProviderColor', () => {
  it('returns correct color for ranobedb', () => {
    expect(getProviderColor('ranobedb')).toBe(RANOBEDB_COLOR)
  })

  it('returns correct color for comicvine', () => {
    expect(getProviderColor('comicvine')).toBe('#ffdb0f')
  })

  it('returns default color for unknown provider', () => {
    const result = getProviderColor('unknown-provider')
    expect(result).toBeTruthy()
    expect(result).not.toBe(RANOBEDB_COLOR)
  })

  it('returns a color for all known providers', () => {
    const providers = ['google', 'amazon', 'goodreads', 'hardcover', 'openLibrary', 'itunes', 'audible', 'audnexus', 'comicvine', 'ranobedb', 'auto']
    for (const provider of providers) {
      expect(getProviderColor(provider)).toBeTruthy()
    }
  })
})

describe('PROVIDER_SHORT_LABELS', () => {
  it('has a label for ranobedb', () => {
    expect(PROVIDER_SHORT_LABELS['ranobedb']).toBe('RanobeDB')
  })

  it('has labels for all providers', () => {
    const providers = ['google', 'amazon', 'goodreads', 'hardcover', 'openLibrary', 'itunes', 'audible', 'audnexus', 'comicvine', 'ranobedb']
    for (const provider of providers) {
      expect(PROVIDER_SHORT_LABELS[provider]).toBeTruthy()
    }
  })
})

describe('providerBadgeStyle', () => {
  it('returns a style object for ranobedb', () => {
    const style = providerBadgeStyle('ranobedb')
    expect(style).toHaveProperty('backgroundColor')
    expect(style).toHaveProperty('color')
    expect(style).toHaveProperty('outlineColor')
    expect(style.color).toBe(RANOBEDB_COLOR)
  })

  it('returns a style object for unknown providers without throwing', () => {
    expect(() => providerBadgeStyle('unknown')).not.toThrow()
  })
})

describe('providerChipStyle', () => {
  it('returns a style object for ranobedb when not disabled', () => {
    const style = providerChipStyle('ranobedb', false)
    expect(style).toHaveProperty('backgroundColor')
    expect(style.color).toBe(RANOBEDB_COLOR)
    expect(style.opacity).toBeUndefined()
  })

  it('sets opacity when disabled', () => {
    const style = providerChipStyle('ranobedb', true)
    expect(style.opacity).toBe('0.75')
  })
})
