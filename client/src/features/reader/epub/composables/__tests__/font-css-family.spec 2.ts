import { describe, expect, it } from 'vitest'
import {
  FONT_CSS_FAMILY_PREFIXES,
  MAX_FONTS_PER_USER,
  MAX_SERVER_FONTS,
  fontCssFamilyGroupName,
  fontScopeFromCssFamily,
  isCustomFontCssFamily,
  maxFontsForScope,
} from '@bookorbit/types'

describe('fontCssFamilyGroupName', () => {
  it('defaults to the user scope, which saved reader settings already contain', () => {
    // Changing this prefix would silently reset every user's chosen font.
    expect(fontCssFamilyGroupName('Literata')).toBe('__userfont_literata')
  })

  it('namespaces server fonts under their own prefix', () => {
    expect(fontCssFamilyGroupName('Literata', 'server')).toBe('__serverfont_literata')
  })

  it('gives a user font and a server font of the same name different CSS families', () => {
    expect(fontCssFamilyGroupName('Literata', 'user')).not.toBe(fontCssFamilyGroupName('Literata', 'server'))
  })

  it('slugifies punctuation and case identically in both scopes', () => {
    expect(fontCssFamilyGroupName('Georgia Pro!')).toBe('__userfont_georgia_pro')
    expect(fontCssFamilyGroupName('Georgia Pro!', 'server')).toBe('__serverfont_georgia_pro')
  })

  it('falls back to a generic slug when a name has no usable characters', () => {
    expect(fontCssFamilyGroupName('!!!')).toBe('__userfont_font')
    expect(fontCssFamilyGroupName('!!!', 'server')).toBe('__serverfont_font')
  })

  it('is stable across calls', () => {
    expect(fontCssFamilyGroupName('Atkinson Hyperlegible', 'server')).toBe(fontCssFamilyGroupName('Atkinson Hyperlegible', 'server'))
  })
})

describe('fontScopeFromCssFamily', () => {
  it('reads the scope back out of a generated name', () => {
    expect(fontScopeFromCssFamily(fontCssFamilyGroupName('Literata'))).toBe('user')
    expect(fontScopeFromCssFamily(fontCssFamilyGroupName('Literata', 'server'))).toBe('server')
  })

  it('returns null for built-in font stacks', () => {
    expect(fontScopeFromCssFamily('serif')).toBeNull()
    expect(fontScopeFromCssFamily('Georgia, serif')).toBeNull()
  })

  it('returns null for empty selections', () => {
    expect(fontScopeFromCssFamily(null)).toBeNull()
    expect(fontScopeFromCssFamily(undefined)).toBeNull()
    expect(fontScopeFromCssFamily('')).toBeNull()
  })

  it('does not confuse the two prefixes', () => {
    expect(fontScopeFromCssFamily('__serverfont_x')).not.toBe('user')
    expect(fontScopeFromCssFamily('__userfont_x')).not.toBe('server')
  })

  it('keeps the prefixes mutually non-overlapping', () => {
    const { user, server } = FONT_CSS_FAMILY_PREFIXES
    expect(user.startsWith(server)).toBe(false)
    expect(server.startsWith(user)).toBe(false)
  })
})

describe('isCustomFontCssFamily', () => {
  it('is true for uploaded fonts in either scope', () => {
    expect(isCustomFontCssFamily('__userfont_literata')).toBe(true)
    expect(isCustomFontCssFamily('__serverfont_literata')).toBe(true)
  })

  it('is false for built-in stacks and empty selections', () => {
    expect(isCustomFontCssFamily('serif')).toBe(false)
    expect(isCustomFontCssFamily('Palatino Linotype, Palatino, Book Antiqua, serif')).toBe(false)
    expect(isCustomFontCssFamily(null)).toBe(false)
  })
})

describe('maxFontsForScope', () => {
  it('gives each scope its own cap', () => {
    expect(maxFontsForScope('user')).toBe(MAX_FONTS_PER_USER)
    expect(maxFontsForScope('server')).toBe(MAX_SERVER_FONTS)
  })

  it('allows an administrator more headroom than a single user', () => {
    expect(MAX_SERVER_FONTS).toBeGreaterThan(MAX_FONTS_PER_USER)
  })
})
