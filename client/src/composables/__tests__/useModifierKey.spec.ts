import { afterEach, describe, expect, it, vi } from 'vitest'
import { useModifierKey } from '../useModifierKey'

function withUserAgent(userAgent: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent)
  return useModifierKey()
}

describe('useModifierKey', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the command glyph on Apple platforms', () => {
    const { isMac, modifierKey } = withUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36')
    expect(isMac.value).toBe(true)
    expect(modifierKey.value).toBe('⌘')
  })

  it.each([
    ['Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'],
    ['Linux', 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0'],
  ])('uses Ctrl on %s, which has no command key', (_platform, userAgent) => {
    const { isMac, modifierKey } = withUserAgent(userAgent)
    expect(isMac.value).toBe(false)
    expect(modifierKey.value).toBe('Ctrl')
  })
})
