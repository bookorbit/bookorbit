import { describe, expect, it } from 'vitest'
import { PdfAnnotationSubtype, PdfBlendMode, type PdfHighlightAnnoObject, type PdfUnderlineAnnoObject } from '@embedpdf/models'
import type { AnnotationItem, AnnotationRect } from '@bookorbit/types'
import {
  boundingRect,
  buildPdfAnnotationObject,
  findOverlappingAnnotation,
  fromPluginId,
  toPdfPosition,
  toPluginId,
} from '../lib/pdf-annotation-render'

function makeAnnotation(overrides: Partial<AnnotationItem> = {}): AnnotationItem {
  return {
    id: 7,
    bookId: 1,
    cfi: null,
    jumpFileId: 3,
    pageno: 2,
    text: 'selected text',
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: null,
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    pdf: { page: 1, rect: { x: 10, y: 20, width: 30, height: 8 }, rects: [{ x: 10, y: 20, width: 30, height: 8 }] },
    ...overrides,
  }
}

describe('pdf-annotation-render', () => {
  it('round-trips plugin ids', () => {
    expect(toPluginId(42)).toBe('bo-42')
    expect(fromPluginId('bo-42')).toBe(42)
    expect(fromPluginId('other-1')).toBeNull()
  })

  it('computes the bounding rect enclosing every segment', () => {
    const rects: AnnotationRect[] = [
      { x: 10, y: 20, width: 30, height: 8 },
      { x: 5, y: 30, width: 20, height: 8 },
    ]
    expect(boundingRect(rects)).toEqual({ x: 5, y: 20, width: 35, height: 18 })
  })

  it('builds a highlight object with multiply blend and reduced opacity', () => {
    const built = buildPdfAnnotationObject(makeAnnotation())
    expect(built).not.toBeNull()
    expect(built!.pageIndex).toBe(1)
    const object = built!.object as PdfHighlightAnnoObject
    expect(object.type).toBe(PdfAnnotationSubtype.HIGHLIGHT)
    expect(object.id).toBe('bo-7')
    expect(object.strokeColor).toBe('#FACC15')
    expect(object.opacity).toBe(0.4)
    expect(object.blendMode).toBe(PdfBlendMode.Multiply)
    expect(object.segmentRects).toEqual([{ origin: { x: 10, y: 20 }, size: { width: 30, height: 8 } }])
  })

  it('maps other styles to their markup subtype at full opacity without a blend mode', () => {
    const underline = buildPdfAnnotationObject(makeAnnotation({ style: 'underline' }))!.object as PdfUnderlineAnnoObject
    expect(underline.type).toBe(PdfAnnotationSubtype.UNDERLINE)
    expect(underline.opacity).toBe(1)
    expect(underline.blendMode).toBeUndefined()

    expect(buildPdfAnnotationObject(makeAnnotation({ style: 'strikethrough' }))!.object.type).toBe(PdfAnnotationSubtype.STRIKEOUT)
    expect(buildPdfAnnotationObject(makeAnnotation({ style: 'squiggly' }))!.object.type).toBe(PdfAnnotationSubtype.SQUIGGLY)
  })

  it('ignores the empty space between segment rects of a multi-line highlight', () => {
    const multiLine = makeAnnotation({
      id: 3,
      pdf: {
        page: 0,
        rect: { x: 10, y: 10, width: 20, height: 28 },
        rects: [
          { x: 10, y: 10, width: 20, height: 8 },
          { x: 10, y: 30, width: 20, height: 8 },
        ],
      },
    })

    expect(findOverlappingAnnotation([multiLine], 0, { x: 12, y: 20, width: 5, height: 5 })).toBeNull()
    expect(findOverlappingAnnotation([multiLine], 0, { x: 12, y: 11, width: 5, height: 5 })?.id).toBe(3)
  })

  it('returns null when the annotation has no pdf geometry', () => {
    expect(buildPdfAnnotationObject(makeAnnotation({ pdf: null }))).toBeNull()
  })

  it('finds an overlapping highlight only on the same page', () => {
    const annotations = [
      makeAnnotation({ id: 1, pdf: { page: 0, rect: { x: 10, y: 10, width: 20, height: 10 }, rects: [] } }),
      makeAnnotation({ id: 2, pdf: { page: 1, rect: { x: 10, y: 10, width: 20, height: 10 }, rects: [] } }),
    ]
    expect(findOverlappingAnnotation(annotations, 1, { x: 15, y: 12, width: 5, height: 5 })?.id).toBe(2)
    expect(findOverlappingAnnotation(annotations, 1, { x: 100, y: 100, width: 5, height: 5 })).toBeNull()
  })

  it('derives a pdf position with a computed bounding rect', () => {
    const rects: AnnotationRect[] = [
      { x: 10, y: 20, width: 30, height: 8 },
      { x: 12, y: 32, width: 26, height: 8 },
    ]
    expect(toPdfPosition(3, rects)).toEqual({ page: 3, rect: { x: 10, y: 20, width: 30, height: 20 }, rects })
  })
})
