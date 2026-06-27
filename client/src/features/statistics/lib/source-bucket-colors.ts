import { oklchToHex, readCssColor } from '@/lib/echarts'
import type { ReadingSessionSourceBucket } from '@bookorbit/types'

// The 3 reading-source buckets reuse the existing pill tokens (light + dark variants
// live in client/src/assets/theme/tokens.css). bookorbit shares the "web" hue.
export const SOURCE_BUCKET_COLOR_TOKENS: Record<ReadingSessionSourceBucket, string> = {
  bookorbit: '--pill-web',
  koreader: '--pill-koreader',
  kobo: '--pill-kobo',
}

const cache = new Map<string, Record<ReadingSessionSourceBucket, string>>()

// The pill tokens are authored in oklch(), and getComputedStyle serializes them back as
// oklch() strings. The browser paints `fill: oklch(...)` fine, but zrender cannot parse
// oklch when it derives the hover/emphasis color, which makes the hovered bar vanish.
// Convert to a hex string zrender can parse, mirroring how getThemePalette() emits hex.
function toParseableColor(input: string): string {
  const value = input.trim()
  if (value.startsWith('#') || value.startsWith('rgb')) return value

  const match = /^oklch\(([^)]+)\)/i.exec(value)
  const inside = match?.[1]
  if (inside) {
    const [lRaw, cRaw, hRaw] = inside.split('/')[0]!.trim().split(/\s+/)
    const l = lRaw?.endsWith('%') ? parseFloat(lRaw) / 100 : parseFloat(lRaw ?? '')
    const c = cRaw?.endsWith('%') ? (parseFloat(cRaw) / 100) * 0.4 : parseFloat(cRaw ?? '')
    const h = parseFloat(hRaw ?? '')
    if (Number.isFinite(l) && Number.isFinite(c) && Number.isFinite(h)) return oklchToHex(l, c, h)
  }
  return value
}

// `themeKey` (e.g. `${theme}:${accent}`) is supplied by the caller so a computed re-resolves
// colors when the active theme changes; the CSS variables themselves already encode the theme.
export function resolveSourceBucketColors(themeKey: string): Record<ReadingSessionSourceBucket, string> {
  const cached = cache.get(themeKey)
  if (cached) return cached

  const colors: Record<ReadingSessionSourceBucket, string> = {
    bookorbit: toParseableColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.bookorbit)),
    koreader: toParseableColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.koreader)),
    kobo: toParseableColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.kobo)),
  }
  cache.set(themeKey, colors)
  return colors
}
