import type { OutlineItem } from '@embedpdf/vue/outline'
import type { PageRef } from '@embedpdf/vue/runtime'
import type { ResponsiveRule, StageSettingsPatch, ZoomModeValue } from '@embedpdf/vue/stage'
import type { PdfReaderSettings } from '@bookorbit/types'
import { shouldUseResponsiveSpread } from './pdf-pagination'

export interface FlatPdfBookmark {
  item: OutlineItem
  title: string
  depth: number
  pageIndex: number | null
}

type StageSpread = NonNullable<StageSettingsPatch['spread']>
type StageZoom = NonNullable<StageSettingsPatch['zoom']>
type StageRotation = NonNullable<StageSettingsPatch['viewRotation']>

export function toStageFlow(mode: PdfReaderSettings['scrollMode']): Pick<StageSettingsPatch, 'flow' | 'layout'> {
  if (mode === 'page') return { flow: 'paged', layout: 'vertical' }
  return { flow: 'continuous', layout: mode === 'horizontal' ? 'horizontal' : 'vertical' }
}

export function toStageSpread(mode: PdfReaderSettings['spread'], wideSurface = false): StageSpread {
  if (mode === 'odd' || mode === 'even' || mode === 'none') return mode
  return wideSurface ? 'odd' : 'none'
}

/**
 * The Stage's own compact gutter, plus, for the automatic spread, two pages side by side whenever
 * the reading surface is wide enough. A matching rule wins over the base settings, so the base
 * spread stays 'none' for 'auto' and the rule turns it on and off as the surface resizes.
 */
export function pdfStageRules(spread: PdfReaderSettings['spread']): ResponsiveRule[] {
  const rules: ResponsiveRule[] = [{ name: 'compact', when: { maxWidth: 600 }, settings: { padding: 4 } }]
  if (spread === 'auto') {
    rules.push({ name: 'auto-spread', when: (box) => shouldUseResponsiveSpread(box.width, box.height), settings: { spread: 'odd' } })
  }
  return rules
}

export function fromStageSpread(spread: StageSpread): Exclude<PdfReaderSettings['spread'], 'auto'> {
  return spread === 'odd' || spread === 'even' ? spread : 'none'
}

export function toStageZoom(settings: Pick<PdfReaderSettings, 'zoomMode' | 'customScale'>): StageZoom {
  if (settings.zoomMode === 'custom') return { level: settings.customScale }
  return { mode: settings.zoomMode }
}

export function fromStageZoomMode(mode: ZoomModeValue | 'custom'): PdfReaderSettings['zoomMode'] {
  if (mode === 'fit-width' || mode === 'automatic' || mode === 'custom') return mode
  return 'fit-page'
}

export function fromStageZoom(zoom: StageZoom): (Pick<PdfReaderSettings, 'zoomMode'> & Partial<Pick<PdfReaderSettings, 'customScale'>>) | null {
  if ('level' in zoom) return { zoomMode: 'custom', customScale: zoom.level }
  if ('mode' in zoom) return { zoomMode: fromStageZoomMode(zoom.mode) }
  return null
}

export function toStageRotation(rotation: PdfReaderSettings['rotation']): StageRotation {
  return rotation
}

export function getOutlinePageIndex(item: OutlineItem, pageIndexOf: (page: PageRef) => number | null): number | null {
  if (item.target?.kind !== 'goto') return null
  return pageIndexOf(item.target.destination.page)
}

/** Outline items arrive depth first with their parent, so a parent's depth is always known before its children. */
export function flattenOutline(items: readonly OutlineItem[], pageIndexOf: (page: PageRef) => number | null): FlatPdfBookmark[] {
  const depths = new Map<number, number>()
  return items.map((item) => {
    const depth = item.parent ? (depths.get(item.parent.objectNumber) ?? -1) + 1 : 0
    depths.set(item.ref.objectNumber, depth)
    return { item, title: item.title, depth, pageIndex: getOutlinePageIndex(item, pageIndexOf) }
  })
}

export function findActivePdfBookmarkIndex(bookmarks: FlatPdfBookmark[], currentPage: number): number | null {
  if (!Number.isInteger(currentPage) || currentPage < 1) return null

  const currentPageIndex = currentPage - 1
  let activeIndex: number | null = null
  let activePageIndex = -1

  for (const [index, bookmark] of bookmarks.entries()) {
    if (bookmark.pageIndex === null || bookmark.pageIndex > currentPageIndex || bookmark.pageIndex < activePageIndex) continue
    activeIndex = index
    activePageIndex = bookmark.pageIndex
  }

  return activeIndex
}

export function safeExternalPdfUrl(uri: string): URL | null {
  try {
    const url = new URL(uri, window.location.href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}
