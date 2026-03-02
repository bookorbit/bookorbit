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
}

export function getFormatColor(format: string): string {
  return FORMAT_COLORS[format.toLowerCase()] ?? '#6b7280'
}
