import { describe, expect, it } from 'vitest'
import { PdfActionType, PdfZoomMode, Rotation, type PdfDestinationObject } from '@embedpdf/models'
import { ScrollStrategy } from '@embedpdf/plugin-scroll'
import { SpreadMode } from '@embedpdf/plugin-spread'
import { ZoomMode } from '@embedpdf/plugin-zoom'
import type { PdfReaderSettings } from '@bookorbit/types'
import {
  findActivePdfBookmarkIndex,
  flattenPdfBookmarks,
  fromRotation,
  getPdfBookmarkPageIndex,
  safeExternalPdfUrl,
  toRotation,
  toScrollStrategy,
  toSpreadMode,
  toZoomLevel,
} from '../pdf-viewer-utils'

const settings: PdfReaderSettings = {
  scrollMode: 'vertical',
  spread: 'none',
  zoomMode: 'fit-page',
  customScale: 1,
  rotation: 0,
}

function destination(pageIndex: number): PdfDestinationObject {
  return { pageIndex, zoom: { mode: PdfZoomMode.FitPage }, view: [] }
}

describe('PDF viewer settings mapping', () => {
  it('maps page mode to the vertical strategy used by paginated navigation', () => {
    expect(toScrollStrategy('page')).toBe(ScrollStrategy.Vertical)
    expect(toScrollStrategy('horizontal')).toBe(ScrollStrategy.Horizontal)
  })

  it('maps spread modes', () => {
    expect(toSpreadMode('none')).toBe(SpreadMode.None)
    expect(toSpreadMode('odd')).toBe(SpreadMode.Odd)
    expect(toSpreadMode('even')).toBe(SpreadMode.Even)
    expect(toSpreadMode('auto')).toBe(SpreadMode.None)
  })

  it('maps fit and custom zoom levels', () => {
    expect(toZoomLevel(settings)).toBe(ZoomMode.FitPage)
    expect(toZoomLevel({ ...settings, zoomMode: 'fit-width' })).toBe(ZoomMode.FitWidth)
    expect(toZoomLevel({ ...settings, zoomMode: 'automatic' })).toBe(ZoomMode.Automatic)
    expect(toZoomLevel({ ...settings, zoomMode: 'custom', customScale: 1.75 })).toBe(1.75)
  })

  it('round trips persisted rotation values', () => {
    expect(toRotation(0)).toBe(Rotation.Degree0)
    expect(toRotation(90)).toBe(Rotation.Degree90)
    expect(toRotation(180)).toBe(Rotation.Degree180)
    expect(toRotation(270)).toBe(Rotation.Degree270)
    expect(fromRotation(Rotation.Degree270)).toBe(270)
  })
})

describe('flattenPdfBookmarks', () => {
  it('preserves hierarchy depth in document order', () => {
    const result = flattenPdfBookmarks([
      {
        title: 'Part one',
        children: [{ title: 'Chapter one' }, { title: 'Chapter two', children: [{ title: 'Section' }] }],
      },
    ])

    expect(result.map(({ bookmark, depth }) => [bookmark.title, depth])).toEqual([
      ['Part one', 0],
      ['Chapter one', 1],
      ['Chapter two', 1],
      ['Section', 2],
    ])
  })

  it('resolves direct and local goto destinations to page indexes', () => {
    expect(getPdfBookmarkPageIndex({ title: 'Direct', target: { type: 'destination', destination: destination(4) } })).toBe(4)
    expect(
      getPdfBookmarkPageIndex({
        title: 'Action',
        target: { type: 'action', action: { type: PdfActionType.Goto, destination: destination(7) } },
      }),
    ).toBe(7)
    expect(
      getPdfBookmarkPageIndex({ title: 'Website', target: { type: 'action', action: { type: PdfActionType.URI, uri: 'https://example.com' } } }),
    ).toBeNull()
  })

  it('selects the nearest outline destination at or before the current page', () => {
    const entries = flattenPdfBookmarks([
      { title: 'Chapter five', target: { type: 'destination', destination: destination(50) } },
      {
        title: 'Chapter six',
        target: { type: 'destination', destination: destination(73) },
        children: [
          { title: 'Aggregates', target: { type: 'destination', destination: destination(78) } },
          { title: 'Factories', target: { type: 'destination', destination: destination(82) } },
        ],
      },
    ])

    expect(entries[findActivePdfBookmarkIndex(entries, 74) ?? -1]?.bookmark.title).toBe('Chapter six')
    expect(entries[findActivePdfBookmarkIndex(entries, 80) ?? -1]?.bookmark.title).toBe('Aggregates')
    expect(findActivePdfBookmarkIndex(entries, 1)).toBeNull()
  })
})

describe('safeExternalPdfUrl', () => {
  it('allows only HTTP and HTTPS links', () => {
    expect(safeExternalPdfUrl('https://example.com/reference')?.hostname).toBe('example.com')
    expect(safeExternalPdfUrl('http://example.com')?.protocol).toBe('http:')
    expect(safeExternalPdfUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalPdfUrl('mailto:test@example.com')).toBeNull()
  })
})
