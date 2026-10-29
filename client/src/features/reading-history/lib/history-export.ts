import type { ReadingHistoryItem } from '@bookorbit/types'
import { READING_HISTORY_UNDATED_MONTH } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { formatMonthKey, readSpanDays } from './history-format'
import { sourceBadges } from './read-facts'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type ExportFormat = 'md' | 'csv' | 'json'

export const EXPORT_MIME: Record<ExportFormat, string> = {
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
}

/** One line per read, grouped under month headings, in the order the list shows them. */
export function toMarkdown(items: ReadingHistoryItem[], heading: string, t: Translate): string {
  const lines = [`# ${heading}`]
  let month: string | null = null
  for (const item of items) {
    const key = item.endedOn?.slice(0, 7) ?? READING_HISTORY_UNDATED_MONTH
    if (key !== month) {
      month = key
      lines.push('', `## ${formatMonthKey(key, t)}`, '')
    }
    const parts = [item.endedOn ?? t('readingHistory.row.noDate'), `**${escapeMarkdown(item.title ?? t('readingHistory.row.untitled'))}**`]
    if (item.authors.length) parts.push(escapeMarkdown(formatList(item.authors)))
    if (item.outcome === 'abandoned') parts.push(t('readingHistory.row.abandoned'))
    if (item.outcome === 'skimmed') parts.push(t('readingHistory.row.skimmed'))
    if (item.outcome === 'completed' && (item.readNumber ?? 1) > 1) parts.push(t('readingHistory.row.readNumber', { n: item.readNumber }))
    if (item.format) parts.push(item.format.toUpperCase())
    const span = readSpanDays(item)
    if (span !== null) parts.push(span === 1 ? t('readingHistory.row.sameDay') : t('readingHistory.rail.days', { count: span }))
    if (item.rating) parts.push('★'.repeat(item.rating))
    if (item.removedAt) parts.push(t('readingHistory.row.removed'))
    lines.push(`- ${parts.join(' · ')}`)
  }
  return `${lines.join('\n')}\n`
}

const CSV_COLUMNS = [
  'finished_on',
  'started_on',
  'title',
  'authors',
  'read_number',
  'outcome',
  'format',
  'pages',
  'minutes_read',
  'sessions',
  'rating',
  'where',
  'highlights',
  'journal_entries',
  'book_id',
  'removed_from_library',
] as const

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Machine-readable columns, so the header stays the same in every language. */
export function toCsv(items: ReadingHistoryItem[]): string {
  const rows = items.map((item) =>
    [
      item.endedOn,
      item.startedOn,
      item.title,
      item.authors.join('; '),
      item.readNumber,
      item.outcome,
      item.format,
      item.pageCount,
      item.seconds ? Math.round(item.seconds / 60) : 0,
      item.sessions,
      item.rating,
      sourceBadges(item.sources)
        .map((source) => source.label)
        .join('; '),
      item.highlightCount,
      item.journalCount,
      item.bookId,
      item.removedAt ? 'yes' : '',
    ]
      .map(csvCell)
      .join(','),
  )
  return `${[CSV_COLUMNS.join(','), ...rows].join('\n')}\n`
}

export function toJson(items: ReadingHistoryItem[]): string {
  return `${JSON.stringify(items, null, 2)}\n`
}

function escapeMarkdown(value: string): string {
  return value.replace(/([\\*_`[\]])/g, '\\$1')
}

/** A file name a desktop or phone will accept: the period, lower-cased, with no separators. */
export function exportFileName(periodLabel: string, format: ExportFormat): string {
  const slug = periodLabel
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return `reading-history${slug ? `-${slug}` : ''}.${format}`
}

/** Saves a blob through a temporary link: the one route that also works from an installed iOS web app. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function canvasToBlob(canvas: HTMLCanvasElement | null, type: string): Promise<Blob> {
  if (!canvas) return Promise.reject(new Error('Canvas is unavailable'))

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas export returned no data'))), type)
  })
}
