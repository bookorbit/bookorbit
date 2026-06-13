import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readCssColor: vi.fn<(varName: string) => string>(
    (varName: string) =>
      (
        ({
          '--pill-web': 'oklch(0.72 0.14 245)',
          '--pill-koreader': 'oklch(0.72 0.17 295)',
          '--pill-kobo': 'oklch(0.74 0.1 195)',
        }) as Record<string, string>
      )[varName] ?? 'oklch(0.5 0.1 0)',
  ),
  oklchToHex: vi.fn<() => string>(() => '#abcdef'),
}))

vi.mock('@/lib/echarts', () => ({ readCssColor: mocks.readCssColor, oklchToHex: mocks.oklchToHex }))

import { resolveSourceBucketColors, SOURCE_BUCKET_COLOR_TOKENS } from './source-bucket-colors'

describe('source-bucket-colors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps each bucket to its pill token (bookorbit reuses the web hue)', () => {
    expect(SOURCE_BUCKET_COLOR_TOKENS).toEqual({
      bookorbit: '--pill-web',
      koreader: '--pill-koreader',
      kobo: '--pill-kobo',
    })
  })

  it('converts oklch tokens to a zrender-parseable hex so bars do not vanish on hover', () => {
    const colors = resolveSourceBucketColors('dark:violet')

    expect(colors).toEqual({ bookorbit: '#abcdef', koreader: '#abcdef', kobo: '#abcdef' })
    expect(mocks.readCssColor).toHaveBeenCalledWith('--pill-web')
    expect(mocks.readCssColor).toHaveBeenCalledWith('--pill-koreader')
    expect(mocks.readCssColor).toHaveBeenCalledWith('--pill-kobo')
    expect(mocks.oklchToHex).toHaveBeenCalledTimes(3)
  })

  it('passes through values that are already rgb/hex', () => {
    mocks.readCssColor.mockReturnValueOnce('rgb(1, 2, 3)')
    const colors = resolveSourceBucketColors('passthrough-rgb')
    expect(colors.bookorbit).toBe('rgb(1, 2, 3)')

    mocks.readCssColor.mockReturnValueOnce('#123456')
    const hexColors = resolveSourceBucketColors('passthrough-hex')
    expect(hexColors.bookorbit).toBe('#123456')
  })

  it('converts percentage lightness and chroma to fractional oklch components', () => {
    mocks.readCssColor.mockReturnValueOnce('oklch(72% 50% 245)')

    resolveSourceBucketColors('percentage-key')

    expect(mocks.oklchToHex).toHaveBeenCalledWith(0.72, 0.2, 245)
  })

  it('ignores the optional alpha component after the slash', () => {
    mocks.readCssColor.mockReturnValueOnce('oklch(0.72 0.14 245 / 0.5)')

    resolveSourceBucketColors('alpha-key')

    expect(mocks.oklchToHex).toHaveBeenCalledWith(0.72, 0.14, 245)
  })

  it('returns the raw value when the oklch components are not finite', () => {
    mocks.readCssColor.mockReturnValueOnce('oklch(not a color)')

    const colors = resolveSourceBucketColors('malformed-key')

    expect(colors.bookorbit).toBe('oklch(not a color)')
  })

  it('caches resolved colors per theme key', () => {
    const first = resolveSourceBucketColors('light:violet')
    const second = resolveSourceBucketColors('light:violet')
    expect(first).toBe(second)
  })
})
