import { readCssColor, toLegacyColor } from '@/lib/css-color'
import type { ReadingSessionSourceBucket } from '@bookorbit/types'

// Reading-source buckets use fixed light/dark pill tokens so the same source has the
// same identity in every chart and reading-log surface.
export const SOURCE_BUCKET_COLOR_TOKENS: Record<ReadingSessionSourceBucket, string> = {
  bookorbit: '--pill-web',
  ios: '--pill-ios',
  watchos: '--pill-watchos',
  android: '--pill-android',
  koreader: '--pill-koreader',
  kobo: '--pill-kobo',
}

const cache = new Map<string, Record<ReadingSessionSourceBucket, string>>()

// `themeKey` (the theme store's `appearanceKey`) is supplied by the caller so a computed re-resolves
// colors when the active theme changes; the CSS variables themselves already encode the theme.
export function resolveSourceBucketColors(themeKey: string): Record<ReadingSessionSourceBucket, string> {
  const cached = cache.get(themeKey)
  if (cached) return cached

  const colors: Record<ReadingSessionSourceBucket, string> = {
    bookorbit: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.bookorbit)),
    ios: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.ios)),
    watchos: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.watchos)),
    android: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.android)),
    koreader: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.koreader)),
    kobo: toLegacyColor(readCssColor(SOURCE_BUCKET_COLOR_TOKENS.kobo)),
  }
  cache.set(themeKey, colors)
  return colors
}
