import { describe, expect, it } from 'vitest'
import { Rotation } from '@embedpdf/models'
import { ScrollStrategy } from '@embedpdf/plugin-scroll'
import { SpreadMode } from '@embedpdf/plugin-spread'
import { ZoomMode } from '@embedpdf/plugin-zoom'
import type { PdfReaderSettings } from '@bookorbit/types'
import { flattenPdfBookmarks, fromRotation, safeExternalPdfUrl, toRotation, toScrollStrategy, toSpreadMode, toZoomLevel } from '../pdf-viewer-utils'

const settings: PdfReaderSettings = {
  scrollMode: 'vertical',
  spread: 'none',
  zoomMode: 'fit-page',
  customScale: 1,
  rotation: 0,
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
})

describe('safeExternalPdfUrl', () => {
  it('allows only HTTP and HTTPS links', () => {
    expect(safeExternalPdfUrl('https://example.com/reference')?.hostname).toBe('example.com')
    expect(safeExternalPdfUrl('http://example.com')?.protocol).toBe('http:')
    expect(safeExternalPdfUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalPdfUrl('mailto:test@example.com')).toBeNull()
  })
})
