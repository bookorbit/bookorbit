export const RATING_STARS = [1, 2, 3, 4, 5] as const

export type RatingStarValue = (typeof RATING_STARS)[number]

export const RATING_VALUE_COLOR_CLASSES: Record<RatingStarValue, string> = {
  1: 'fill-red-500 text-red-500',
  2: 'fill-orange-400 text-orange-400',
  3: 'fill-yellow-400 text-yellow-400',
  4: 'fill-lime-400 text-lime-400',
  5: 'fill-green-600 text-green-600',
}

function normalizeRatingValue(rating: number | null | undefined): RatingStarValue | null {
  if (rating == null) return null
  const rounded = Math.round(rating)
  if (rounded < 1 || rounded > 5) return null
  return rounded as RatingStarValue
}

export function getRatingFilledClass(rating: number | null | undefined): string {
  const value = normalizeRatingValue(rating)
  return value ? RATING_VALUE_COLOR_CLASSES[value] : 'fill-amber-400 text-amber-400'
}

export function getRatingStarClass(star: number, rating: number | null | undefined, emptyClass = 'text-muted-foreground'): string {
  if ((rating ?? 0) < star) return emptyClass
  return getRatingFilledClass(rating)
}
