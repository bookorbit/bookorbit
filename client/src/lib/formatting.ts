import { formatNumber } from '@/i18n/formatters'

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'] as const

/**
 * The unit name comes from Intl rather than a hardcoded table, so a translated interface reads
 * "1,5 kB" instead of a localized number with an English "KB" glued to it.
 */
export function formatBytes(value: string | number | null | undefined): string {
  const bytes = typeof value === 'string' ? Number(value) : value
  if (bytes == null || !Number.isFinite(bytes)) return '-'
  if (bytes <= 0) return formatNumber(0, { style: 'unit', unit: 'byte', unitDisplay: 'short' })

  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1)
  return formatNumber(bytes / 1024 ** unitIndex, {
    style: 'unit',
    unit: BYTE_UNITS[unitIndex],
    unitDisplay: 'short',
    maximumFractionDigits: unitIndex === 0 ? 0 : unitIndex >= 3 ? 2 : 1,
  })
}
