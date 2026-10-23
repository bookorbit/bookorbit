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

  it('returns the Libro.fm brand color', () => {
    expect(getProviderColor('librofm')).toBe('#62B9B6')
  })

  it('returns the MangaBaka brand color', () => {
    expect(getProviderColor('mangabaka')).toBe('#0d9488')
  })

  it('returns default color for unknown provider', () => {
    const result = getProviderColor('unknown-provider')
    expect(result).toBeTruthy()
    expect(result).not.toBe(RANOBEDB_COLOR)
  })

  it('returns a color for all known providers', () => {
    const providers = [
      'google',
      'amazon',
      'goodreads',
      'hardcover',
      'openLibrary',
      'itunes',
      'audible',
      'audnexus',
      'librofm',
      'comicvine',
      'ranobedb',
      'kobo',
      'aladin',
      'mangabaka',
      'auto',
    ]
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
    const providers = [
      'google',
      'amazon',
      'goodreads',
      'hardcover',
      'openLibrary',
      'itunes',
      'audible',
      'audnexus',
      'librofm',
      'comicvine',
      'ranobedb',
      'kobo',
      'aladin',
      'mangabaka',
    ]
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
  it('exposes the brand colour as a custom property for the provider-chip class', () => {
    expect(providerChipStyle('ranobedb')).toEqual({ '--provider-color': RANOBEDB_COLOR })
  })

  // Fill, ink and ring are mixed from this value in CSS so light mode can darken the
  // brand hue enough to clear contrast. Emitting the colour directly would defeat that.
  it('does not set colour properties directly', () => {
    const style = providerChipStyle('ranobedb')
    expect(style.color).toBeUndefined()
    expect(style.backgroundColor).toBeUndefined()
  })

  it('falls back to the default colour for an unknown provider', () => {
    expect(providerChipStyle('unknown')['--provider-color']).toBe(getProviderColor('unknown'))
  })
})
