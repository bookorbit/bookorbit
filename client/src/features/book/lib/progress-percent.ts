import { formatPercent } from '@/i18n/formatters'

type Translate = (key: string) => string

/** A reading position as a percent that never rounds a live position down to 0% or up to 100%. */
export function progressPercentLabel(percentage: number, t: Translate): string {
  const clamped = Math.max(0, Math.min(100, percentage))
  if (clamped > 0 && clamped < 1) return t('book.detail.details.percentUnderOne')
  if (clamped > 99 && clamped < 100) return t('book.detail.details.percentOverNinetyNine')
  return formatPercent(Math.round(clamped) / 100)
}
