import { formatNumber } from '@/i18n/formatters'

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '-'
  if (bytes === 0) return '0 B'

  const unitIndex = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)), BYTE_UNITS.length - 1)
  const value = bytes / 1024 ** unitIndex
  const maximumFractionDigits = unitIndex === 0 ? 0 : unitIndex >= 3 ? 2 : 1
  return `${formatNumber(value, { maximumFractionDigits })} ${BYTE_UNITS[unitIndex]}`
}
