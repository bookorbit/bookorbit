import type { PdfPageObjectWithRotatedSize } from '@embedpdf/models'
import type { PageVisibilityMetrics } from '@embedpdf/plugin-scroll'

export interface PdfPageRange {
  start: number
  end: number
}

export function findPageRange(spreads: PdfPageObjectWithRotatedSize[][], pageNumber: number, totalPages: number): PdfPageRange {
  const spread = spreads.find((pages) => pages.some((page) => page.index + 1 === pageNumber))
  if (!spread?.length) {
    const page = Math.min(Math.max(pageNumber, 1), Math.max(totalPages, 1))
    return { start: page, end: page }
  }

  return {
    start: Math.min(...spread.map((page) => page.index + 1)),
    end: Math.max(...spread.map((page) => page.index + 1)),
  }
}

export function findAdjacentPage(spreads: PdfPageObjectWithRotatedSize[][], pageNumber: number, direction: -1 | 1, totalPages: number): number {
  const currentIndex = spreads.findIndex((pages) => pages.some((page) => page.index + 1 === pageNumber))
  if (currentIndex < 0) return Math.min(Math.max(pageNumber + direction, 1), Math.max(totalPages, 1))
  const target = spreads[currentIndex + direction]
  if (!target?.length) return Math.min(...spreads[currentIndex]!.map((page) => page.index + 1))
  return Math.min(...target.map((page) => page.index + 1))
}

export function canTurnFromVisiblePage(
  direction: -1 | 1,
  pageRange: PdfPageRange,
  visibility: PageVisibilityMetrics[],
  spreads: PdfPageObjectWithRotatedSize[][],
  axis: 'horizontal' | 'vertical' = 'vertical',
): boolean {
  const pageNumbers = new Set(Array.from({ length: pageRange.end - pageRange.start + 1 }, (_, index) => pageRange.start + index))
  const relevantMetrics = visibility.filter((metric) => pageNumbers.has(metric.pageNumber))
  if (relevantMetrics.length === 0) return true

  const pages = spreads.flat().filter((page) => pageNumbers.has(page.index + 1))
  if (pages.length === 0) return true

  return relevantMetrics.every((metric) => {
    const page = pages.find((candidate) => candidate.index + 1 === metric.pageNumber)
    if (!page) return true
    if (axis === 'horizontal') {
      if (direction < 0) return metric.original.pageX <= 1
      return metric.original.pageX + metric.original.visibleWidth >= page.rotatedSize.width - 1
    }
    if (direction < 0) return metric.original.pageY <= 1
    return metric.original.pageY + metric.original.visibleHeight >= page.rotatedSize.height - 1
  })
}

export function shouldUseResponsiveSpread(width: number, height: number): boolean {
  return width >= 900 && width / Math.max(height, 1) >= 1.1
}
