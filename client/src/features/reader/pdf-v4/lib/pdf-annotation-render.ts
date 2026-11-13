import type { AnnotationItem, AnnotationPdfPosition, AnnotationRect } from '@bookorbit/types'

export const HIGHLIGHT_OPACITY = 0.4

/**
 * One drawn piece of a highlight, in PDF points from the page's top-left corner: the space the
 * persisted rects, the selection and the page layer share.
 */
export type PdfHighlightMark =
  | { kind: 'fill'; key: string; color: string; x: number; y: number; width: number; height: number }
  | { kind: 'line'; key: string; color: string; x1: number; y1: number; x2: number; y2: number; thickness: number }
  | { kind: 'wave'; key: string; color: string; path: string; thickness: number }

/** Copies a page-space rect into the flat persisted shape, dropping anything else it carries. */
export function toAnnotationRect(rect: AnnotationRect): AnnotationRect {
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
}

/** Bounding box that encloses every segment rect, in PDF page coordinates. */
export function boundingRect(rects: AnnotationRect[]): AnnotationRect {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const rect of rects) {
    minX = Math.min(minX, rect.x)
    minY = Math.min(minY, rect.y)
    maxX = Math.max(maxX, rect.x + rect.width)
    maxY = Math.max(maxY, rect.y + rect.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function lineThickness(height: number) {
  return Math.max(height * 0.08, 0.75)
}

function wavePath(rect: AnnotationRect, thickness: number) {
  const amplitude = Math.max(rect.height * 0.08, 0.75)
  const step = Math.max(rect.height * 0.2, 2)
  const baseline = rect.y + rect.height - amplitude - thickness / 2
  const end = rect.x + rect.width
  let path = `M ${rect.x} ${baseline}`
  for (let x = rect.x, up = true; x < end; x += step, up = !up) {
    path += ` L ${Math.min(x + step, end)} ${up ? baseline + amplitude : baseline}`
  }
  return path
}

/** The pieces that draw a persisted highlight, one per line segment, in the reader's chosen style. */
export function buildHighlightMarks(annotation: AnnotationItem): PdfHighlightMark[] {
  if (!annotation.pdf) return []
  const segments = annotation.pdf.rects.length > 0 ? annotation.pdf.rects : [annotation.pdf.rect]
  return segments.map((rect, index): PdfHighlightMark => {
    const key = `${annotation.id}-${index}`
    const thickness = lineThickness(rect.height)
    switch (annotation.style) {
      case 'underline': {
        const y = rect.y + rect.height - thickness / 2
        return { kind: 'line', key, color: annotation.color, x1: rect.x, y1: y, x2: rect.x + rect.width, y2: y, thickness }
      }
      case 'strikethrough': {
        const y = rect.y + rect.height / 2
        return { kind: 'line', key, color: annotation.color, x1: rect.x, y1: y, x2: rect.x + rect.width, y2: y, thickness }
      }
      case 'squiggly':
        return { kind: 'wave', key, color: annotation.color, path: wavePath(rect, thickness), thickness }
      default:
        return { kind: 'fill', key, color: annotation.color, ...toAnnotationRect(rect) }
    }
  })
}

/** True when two axis-aligned rectangles overlap in PDF page coordinates. */
export function rectsIntersect(a: AnnotationRect, b: AnnotationRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * Finds an existing highlight on the same page whose bounds intersect the new
 * selection, so re-highlighting near it edits that highlight instead of stacking
 * a duplicate. Mirrors the EPUB reader's overlapping-annotation behaviour.
 */
export function findOverlappingAnnotation(annotations: AnnotationItem[], page: number, selection: AnnotationRect): AnnotationItem | null {
  for (const annotation of annotations) {
    if (!annotation.pdf || annotation.pdf.page !== page) continue
    const segments = annotation.pdf.rects.length > 0 ? annotation.pdf.rects : [annotation.pdf.rect]
    if (segments.some((segment) => rectsIntersect(segment, selection))) return annotation
  }
  return null
}

/** Assembles a persistable PDF position from a page index and its segment rects. */
export function toPdfPosition(page: number, rects: AnnotationRect[]): AnnotationPdfPosition {
  return { page, rect: boundingRect(rects), rects }
}
