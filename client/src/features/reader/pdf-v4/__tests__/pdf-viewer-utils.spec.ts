import { describe, expect, it } from 'vitest'
import type { OutlineItem } from '@embedpdf/vue/outline'
import type { PageRef } from '@embedpdf/vue/runtime'
import type { StageBox } from '@embedpdf/vue/stage'
import type { PdfReaderSettings } from '@bookorbit/types'
import {
  findActivePdfBookmarkIndex,
  flattenOutline,
  fromStageSpread,
  fromStageZoom,
  fromStageZoomMode,
  pdfStageRules,
  safeExternalPdfUrl,
  toStageFlow,
  toStageSpread,
  toStageZoom,
} from '../pdf-viewer-utils'

const settings: PdfReaderSettings = {
  scrollMode: 'vertical',
  spread: 'none',
  zoomMode: 'fit-page',
  customScale: 1,
  rotation: 0,
}

function pageRef(objectNumber: number): PageRef {
  return { kind: 'objectNumber', objectNumber }
}

function outlineItem(objectNumber: number, title: string, options: { parent?: number; page?: number; uri?: string } = {}): OutlineItem {
  let target: OutlineItem['target'] = null
  if (options.page !== undefined) target = { kind: 'goto', destination: { kind: 'fit', page: pageRef(1000 + options.page) } }
  else if (options.uri !== undefined) target = { kind: 'uri', uri: options.uri }
  return {
    ref: { kind: 'objectNumber', objectNumber },
    parent: options.parent === undefined ? null : { kind: 'objectNumber', objectNumber: options.parent },
    title,
    target,
    action: null,
    open: false,
    color: null,
    bold: false,
    italic: false,
  }
}

function pageIndexOf(page: PageRef): number | null {
  return page.objectNumber >= 1000 ? page.objectNumber - 1000 : null
}

function box(width: number, height: number): StageBox {
  return { width, height, orientation: width > height ? 'landscape' : 'portrait' }
}

describe('PDF viewer settings mapping', () => {
  it('maps page mode to the paged flow and the scroll modes to continuous layouts', () => {
    expect(toStageFlow('page')).toEqual({ flow: 'paged', layout: 'vertical' })
    expect(toStageFlow('vertical')).toEqual({ flow: 'continuous', layout: 'vertical' })
    expect(toStageFlow('horizontal')).toEqual({ flow: 'continuous', layout: 'horizontal' })
  })

  it('maps spread modes, leaving the automatic spread to the responsive rule', () => {
    expect(toStageSpread('none')).toBe('none')
    expect(toStageSpread('odd')).toBe('odd')
    expect(toStageSpread('even')).toBe('even')
    expect(toStageSpread('auto')).toBe('none')
    expect(toStageSpread('auto', true)).toBe('odd')
    expect(fromStageSpread('even')).toBe('even')
  })

  it('maps fit modes and saved custom levels to Stage zoom specs', () => {
    expect(toStageZoom(settings)).toEqual({ mode: 'fit-page' })
    expect(toStageZoom({ ...settings, zoomMode: 'fit-width' })).toEqual({ mode: 'fit-width' })
    expect(toStageZoom({ ...settings, zoomMode: 'automatic' })).toEqual({ mode: 'automatic' })
    expect(toStageZoom({ ...settings, zoomMode: 'custom', customScale: 1.75 })).toEqual({ level: 1.75 })
  })

  it('maps Stage zoom modes back to reader settings', () => {
    expect(fromStageZoomMode('fit-width')).toBe('fit-width')
    expect(fromStageZoomMode('automatic')).toBe('automatic')
    expect(fromStageZoomMode('custom')).toBe('custom')
    expect(fromStageZoomMode('fit-all')).toBe('fit-page')
  })

  it('maps a Stage zoom setting to the reader zoom it saves', () => {
    expect(fromStageZoom({ level: 1.25 })).toEqual({ zoomMode: 'custom', customScale: 1.25 })
    expect(fromStageZoom({ mode: 'fit-width' })).toEqual({ zoomMode: 'fit-width' })
    expect(fromStageZoom({ pageWidth: 400 })).toBeNull()
  })

  it('turns the automatic spread on only for wide reading surfaces', () => {
    expect(pdfStageRules('none').map((rule) => rule.name)).toEqual(['compact'])

    const autoSpread = pdfStageRules('auto').find((rule) => rule.name === 'auto-spread')
    expect(autoSpread?.settings).toEqual({ spread: 'odd' })
    const matches = autoSpread?.when
    expect(typeof matches).toBe('function')
    if (typeof matches !== 'function') return
    expect(matches(box(1200, 800))).toBe(true)
    expect(matches(box(800, 1200))).toBe(false)
  })
})

describe('flattenOutline', () => {
  it('derives each entry depth from its parent, in document order', () => {
    const result = flattenOutline(
      [
        outlineItem(1, 'Part one'),
        outlineItem(2, 'Chapter one', { parent: 1 }),
        outlineItem(3, 'Chapter two', { parent: 1 }),
        outlineItem(4, 'Section', { parent: 3 }),
        outlineItem(5, 'Part two'),
      ],
      pageIndexOf,
    )

    expect(result.map(({ title, depth }) => [title, depth])).toEqual([
      ['Part one', 0],
      ['Chapter one', 1],
      ['Chapter two', 1],
      ['Section', 2],
      ['Part two', 0],
    ])
  })

  it('resolves goto targets to page indexes and leaves other targets without a page', () => {
    const result = flattenOutline(
      [outlineItem(1, 'Direct', { page: 4 }), outlineItem(2, 'Website', { uri: 'https://example.com' }), outlineItem(3, 'Empty')],
      pageIndexOf,
    )

    expect(result.map((entry) => entry.pageIndex)).toEqual([4, null, null])
  })

  it('selects the nearest outline destination at or before the current page', () => {
    const entries = flattenOutline(
      [
        outlineItem(1, 'Chapter five', { page: 50 }),
        outlineItem(2, 'Chapter six', { page: 73 }),
        outlineItem(3, 'Aggregates', { parent: 2, page: 78 }),
        outlineItem(4, 'Factories', { parent: 2, page: 82 }),
      ],
      pageIndexOf,
    )

    expect(entries[findActivePdfBookmarkIndex(entries, 74) ?? -1]?.title).toBe('Chapter six')
    expect(entries[findActivePdfBookmarkIndex(entries, 80) ?? -1]?.title).toBe('Aggregates')
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
