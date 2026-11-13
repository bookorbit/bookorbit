export interface PdfPageRange {
  start: number
  end: number
}

/** The 1-based first and last page of the pages on screen, from the 0-based indexes the Stage reports. */
export function toPageRange(pageIndexes: readonly number[], fallbackPage: number, totalPages: number): PdfPageRange {
  if (pageIndexes.length === 0) {
    const page = Math.min(Math.max(fallbackPage, 1), Math.max(totalPages, 1))
    return { start: page, end: page }
  }
  return { start: Math.min(...pageIndexes) + 1, end: Math.max(...pageIndexes) + 1 }
}

export function shouldUseResponsiveSpread(width: number, height: number): boolean {
  return width >= 900 && width / Math.max(height, 1) >= 1.1
}
