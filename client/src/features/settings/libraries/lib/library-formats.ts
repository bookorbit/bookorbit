/**
 * Format colouring for the composition bar. Grouping by family rather than by extension keeps the
 * palette bounded at six tokens however many extensions a library holds, and means the same family
 * is always the same colour across rows. The legend still names the exact format.
 */
export type FormatFamily = 'ebook' | 'kindle' | 'document' | 'comic' | 'audio' | 'other'

const FAMILY_BY_FORMAT: Record<string, FormatFamily> = {
  epub: 'ebook',
  kepub: 'ebook',
  fb2: 'ebook',
  mobi: 'kindle',
  azw3: 'kindle',
  azw: 'kindle',
  pdf: 'document',
  cbz: 'comic',
  cbr: 'comic',
  cb7: 'comic',
  m4b: 'audio',
  mp3: 'audio',
  m4a: 'audio',
  opus: 'audio',
  ogg: 'audio',
  flac: 'audio',
}

export function formatFamily(format: string): FormatFamily {
  return FAMILY_BY_FORMAT[format.toLowerCase()] ?? 'other'
}

export function formatFamilyColor(format: string): string {
  return `var(--format-${formatFamily(format)})`
}

export interface FormatSegment {
  format: string
  count: number
  color: string
  percent: number
}

/** Largest format first, ties broken alphabetically so the order never jitters between refreshes. */
export function toFormatSegments(formatCounts: Record<string, number>): FormatSegment[] {
  const entries = Object.entries(formatCounts).filter(([, count]) => count > 0)
  const total = entries.reduce((sum, [, count]) => sum + count, 0)
  if (total === 0) return []
  return entries
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([format, count]) => ({
      format,
      count,
      color: formatFamilyColor(format),
      percent: (count / total) * 100,
    }))
}
