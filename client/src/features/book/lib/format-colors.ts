const DEFAULT_FORMAT_COLOR = '#6b7280'

const FORMAT_COLORS: Record<string, string> = {
  epub: '#16a34a',
  mobi: '#6366f1',
  azw3: '#14b8a6',
  azw: '#0ea5e9',
  fb2: '#ec4899',
  txt: '#78716c',
  pdf: '#dc2626',
  cbz: '#3b82f6',
  cbr: '#f97316',
  cb7: '#8b5cf6',
  m4b: '#f59e0b',
  m4a: '#eab308',
  mp3: '#22c55e',
  opus: '#06b6d4',
  ogg: '#84cc16',
  flac: '#10b981',
}

export function getFormatColor(format: string | null | undefined): string {
  if (!format) return DEFAULT_FORMAT_COLOR
  return FORMAT_COLORS[format.toLowerCase()] ?? DEFAULT_FORMAT_COLOR
}
