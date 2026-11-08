import { formatPercent } from '@/i18n/formatters'

/** A copy's reading progress arrives from 0 to 100, like every progress value the server sends. */
export function formatCopyProgress(percent: number): string {
  return formatPercent(percent / 100)
}
