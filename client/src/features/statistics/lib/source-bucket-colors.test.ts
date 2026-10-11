import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readCssColor: vi.fn<(varName: string) => string>((varName: string) => `oklch(${varName})`),
  toLegacyColor: vi.fn<(input: string) => string>(() => '#abcdef'),
}))

vi.mock('@/lib/css-color', () => ({ readCssColor: mocks.readCssColor, toLegacyColor: mocks.toLegacyColor }))

import { resolveSourceBucketColors, SOURCE_BUCKET_COLOR_TOKENS } from './source-bucket-colors'

describe('source-bucket-colors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps each bucket to its pill token (bookorbit reuses the web hue)', () => {
    expect(SOURCE_BUCKET_COLOR_TOKENS).toEqual({
      bookorbit: '--pill-web',
      ios: '--pill-ios',
      watchos: '--pill-watchos',
      android: '--pill-android',
      koreader: '--pill-koreader',
      kobo: '--pill-kobo',
    })
  })

  it('reads each pill token and converts it to a zrender-parseable colour', () => {
    const colors = resolveSourceBucketColors('dark:violet')

    expect(colors).toEqual({ bookorbit: '#abcdef', ios: '#abcdef', watchos: '#abcdef', android: '#abcdef', koreader: '#abcdef', kobo: '#abcdef' })
    for (const token of Object.values(SOURCE_BUCKET_COLOR_TOKENS)) {
      expect(mocks.readCssColor).toHaveBeenCalledWith(token)
      expect(mocks.toLegacyColor).toHaveBeenCalledWith(`oklch(${token})`)
    }
  })

  it('caches resolved colors per theme key', () => {
    const first = resolveSourceBucketColors('light:violet')
    const second = resolveSourceBucketColors('light:violet')
    expect(first).toBe(second)
    expect(mocks.readCssColor).toHaveBeenCalledTimes(6)
  })
})
