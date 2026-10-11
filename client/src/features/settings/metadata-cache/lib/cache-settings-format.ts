import { formatNumber } from '@/i18n/formatters'
import { UNIT_SECONDS, type DurationDraft, type FieldError } from './cache-settings'

type Translate = (key: string, named?: Record<string, unknown>) => string

/** "30 days" or "1 hour" in the active locale. Zero borrows the unit of the value it is shown beside. */
export function formatCacheDuration(seconds: number, zeroUnit: 'day' | 'hour' = 'day'): string {
  if (seconds === 0) return formatNumber(0, { style: 'unit', unit: zeroUnit, unitDisplay: 'long' })
  if (seconds % UNIT_SECONDS.days === 0) return formatNumber(seconds / UNIT_SECONDS.days, { style: 'unit', unit: 'day', unitDisplay: 'long' })
  return formatNumber(seconds / UNIT_SECONDS.hours, { style: 'unit', unit: 'hour', unitDisplay: 'long', maximumFractionDigits: 2 })
}

export function formatDurationDraft(duration: DurationDraft): string {
  if (duration.amount === null) return ''
  return formatNumber(duration.amount, {
    style: 'unit',
    unit: duration.unit === 'days' ? 'day' : 'hour',
    unitDisplay: 'long',
    maximumFractionDigits: 2,
  })
}

export function formatMegabytes(value: number): string {
  return formatNumber(value, { style: 'unit', unit: 'megabyte', unitDisplay: 'short' })
}

export function durationErrorMessage(t: Translate, error: FieldError | undefined): string | null {
  if (!error) return null
  if (error.kind === 'required') return t('settings.metadata.searchCache.validation.required')
  if (error.kind === 'integer') return t('settings.metadata.searchCache.validation.wholeNumber')
  const zeroUnit = error.max % UNIT_SECONDS.days === 0 ? 'day' : 'hour'
  return t('settings.metadata.searchCache.validation.range', {
    min: formatCacheDuration(error.min, zeroUnit),
    max: formatCacheDuration(error.max, zeroUnit),
  })
}

export function storageErrorMessage(t: Translate, error: FieldError | undefined): string | null {
  if (!error) return null
  if (error.kind === 'required') return t('settings.metadata.searchCache.validation.required')
  if (error.kind === 'integer') return t('settings.metadata.searchCache.validation.wholeNumber')
  return t('settings.metadata.searchCache.validation.range', { min: formatMegabytes(error.min), max: formatMegabytes(error.max) })
}
