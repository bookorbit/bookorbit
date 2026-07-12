import type { BookCommunityRating, MetadataProviderInfo } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { getProviderLabel } from './metadata-fetch'

export function formatCommunityRatingValue(rating: number | null | undefined, count?: number | null): string {
  if (rating == null || !Number.isFinite(rating)) return ''

  const ratingText = Number.isInteger(rating) ? rating.toFixed(0) : rating.toFixed(1)
  if (count == null || !Number.isFinite(count)) return `${ratingText} / 5`

  return `${ratingText} / 5 (${formatNumber(count)} ratings)`
}

export function formatCommunityRatingLine(rating: BookCommunityRating, providers: readonly MetadataProviderInfo[] = []): string {
  const provider = getProviderLabel(rating.provider, providers)
  const value = formatCommunityRatingValue(rating.rating, rating.ratingCount)
  return value ? `${provider}: ${value}` : provider
}

export function formatCommunityRatingsValue(
  ratings: readonly BookCommunityRating[] | null | undefined,
  providers: readonly MetadataProviderInfo[] = [],
): string {
  if (!ratings?.length) return ''
  return ratings
    .map((rating) => formatCommunityRatingLine(rating, providers))
    .filter(Boolean)
    .join(', ')
}
