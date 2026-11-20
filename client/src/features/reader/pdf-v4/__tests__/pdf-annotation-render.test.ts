import { describe, expect, it } from 'vitest'
import type { AnnotationItem, AnnotationRect } from '@bookorbit/types'
import { boundingRect, buildHighlightMarks, findOverlappingAnnotation, toAnnotationRect, toPdfPosition } from '../lib/pdf-annotation-render'

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
    highlightedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    pdf: { page: 1, rect: { x: 10, y: 20, width: 30, height: 8 }, rects: [{ x: 10, y: 20, width: 30, height: 8 }] },
    ...overrides,
  }
}

describe('pdf-annotation-render', () => {
  it('copies only the persisted rect fields', () => {
    const rect = { x: 1, y: 2, width: 3, height: 4, extra: true } as AnnotationRect & { extra: boolean }
    expect(toAnnotationRect(rect)).toEqual({ x: 1, y: 2, width: 3, height: 4 })
  })

  it('computes the bounding rect enclosing every segment', () => {
    const rects: AnnotationRect[] = [
      { x: 10, y: 20, width: 30, height: 8 },
      { x: 5, y: 30, width: 20, height: 8 },
    ]
    expect(boundingRect(rects)).toEqual({ x: 5, y: 20, width: 35, height: 18 })
  })

  it('draws a highlight as one fill per segment in the stored page space', () => {
    expect(buildHighlightMarks(makeAnnotation())).toEqual([{ kind: 'fill', key: '7-0', color: '#FACC15', x: 10, y: 20, width: 30, height: 8 }])
  })

  it('draws underline and strikethrough as lines at the bottom and middle of each segment', () => {
    const [underline] = buildHighlightMarks(makeAnnotation({ style: 'underline' }))
    expect(underline).toMatchObject({ kind: 'line', x1: 10, x2: 40 })
    if (underline?.kind !== 'line') throw new Error('expected a line')
    expect(underline.y1).toBeCloseTo(28 - underline.thickness / 2)

    const [strike] = buildHighlightMarks(makeAnnotation({ style: 'strikethrough' }))
    expect(strike).toMatchObject({ kind: 'line', y1: 24, y2: 24 })
  })

  it('draws squiggly as a wave path spanning the segment', () => {
    const [wave] = buildHighlightMarks(makeAnnotation({ style: 'squiggly' }))
    if (wave?.kind !== 'wave') throw new Error('expected a wave')
    expect(wave.path.startsWith('M 10 ')).toBe(true)
    expect(wave.path).toContain('L 40 ')
  })

  it('falls back to the bounding rect when no segments were stored', () => {
    const marks = buildHighlightMarks(makeAnnotation({ pdf: { page: 1, rect: { x: 1, y: 2, width: 3, height: 4 }, rects: [] } }))
    expect(marks).toEqual([{ kind: 'fill', key: '7-0', color: '#FACC15', x: 1, y: 2, width: 3, height: 4 }])
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

  it('draws nothing when the annotation has no pdf geometry', () => {
    expect(buildHighlightMarks(makeAnnotation({ pdf: null }))).toEqual([])
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
