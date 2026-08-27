import { PdfAnnotationSubtype, PdfBlendMode, type PdfAnnotationObject, type Rect } from '@embedpdf/models'
import type { AnnotationItem, AnnotationPdfPosition, AnnotationRect } from '@bookorbit/types'

export const PDF_ANNOTATION_ID_PREFIX = 'bo-'

const HIGHLIGHT_OPACITY = 0.4

export function toPluginId(annotationId: number): string {
  return `${PDF_ANNOTATION_ID_PREFIX}${annotationId}`
}

export function fromPluginId(pluginId: string): number | null {
  if (!pluginId.startsWith(PDF_ANNOTATION_ID_PREFIX)) return null
  const parsed = Number.parseInt(pluginId.slice(PDF_ANNOTATION_ID_PREFIX.length), 10)
  return Number.isFinite(parsed) ? parsed : null
}

export function toRect(rect: AnnotationRect): Rect {
  return { origin: { x: rect.x, y: rect.y }, size: { width: rect.width, height: rect.height } }
}

export function fromRect(rect: Rect): AnnotationRect {
  return { x: rect.origin.x, y: rect.origin.y, width: rect.size.width, height: rect.size.height }
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

function subtypeForStyle(style: string): PdfAnnotationSubtype {
  switch (style) {
    case 'underline':
      return PdfAnnotationSubtype.UNDERLINE
    case 'strikethrough':
      return PdfAnnotationSubtype.STRIKEOUT
    case 'squiggly':
      return PdfAnnotationSubtype.SQUIGGLY
    default:
      return PdfAnnotationSubtype.HIGHLIGHT
  }
}

/**
 * Builds the EmbedPDF text-markup object that renders a persisted highlight.
 * The annotation plugin is the render surface; our database stays the source of
 * truth, so the object id is derived from the database row id.
 */
export function buildPdfAnnotationObject(annotation: AnnotationItem): { pageIndex: number; object: PdfAnnotationObject } | null {
  if (!annotation.pdf) return null
  const { page, rect, rects } = annotation.pdf
  const type = subtypeForStyle(annotation.style)
  const isHighlight = type === PdfAnnotationSubtype.HIGHLIGHT
  const object = {
    type,
    id: toPluginId(annotation.id),
    pageIndex: page,
    rect: toRect(rect),
    segmentRects: rects.map(toRect),
    strokeColor: annotation.color,
    color: annotation.color,
    opacity: isHighlight ? HIGHLIGHT_OPACITY : 1,
    ...(isHighlight ? { blendMode: PdfBlendMode.Multiply } : {}),
    contents: annotation.note ?? undefined,
  } as unknown as PdfAnnotationObject
  return { pageIndex: page, object }
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
    if (rectsIntersect(annotation.pdf.rect, selection)) return annotation
  }
  return null
}

export function toPdfPosition(page: number, rects: AnnotationRect[]): AnnotationPdfPosition {
  return { page, rect: boundingRect(rects), rects }
}
