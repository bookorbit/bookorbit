import { Rotation, type PdfBookmarkObject, type PdfPageObject } from '@embedpdf/models'
import { ScrollStrategy } from '@embedpdf/plugin-scroll'
import { SpreadMode } from '@embedpdf/plugin-spread'
import { ZoomMode, type ZoomLevel } from '@embedpdf/plugin-zoom'
import type { PdfReaderSettings } from '@bookorbit/types'

export interface FlatPdfBookmark {
  bookmark: PdfBookmarkObject
  depth: number
}

export function toScrollStrategy(mode: PdfReaderSettings['scrollMode']): ScrollStrategy {
  return mode === 'horizontal' ? ScrollStrategy.Horizontal : ScrollStrategy.Vertical
}

export function toSpreadMode(mode: PdfReaderSettings['spread']): SpreadMode {
  if (mode === 'odd') return SpreadMode.Odd
  if (mode === 'even') return SpreadMode.Even
  return SpreadMode.None
}

export function toZoomLevel(settings: PdfReaderSettings): ZoomLevel {
  if (settings.zoomMode === 'fit-width') return ZoomMode.FitWidth
  if (settings.zoomMode === 'automatic') return ZoomMode.Automatic
  if (settings.zoomMode === 'custom') return settings.customScale
  return ZoomMode.FitPage
}

/**
 * Device-pixel budget for rasterizing a single page.
 *
 * PDFium rasterizes a page into one bitmap before the tiling plugin slices it.
 * Past a certain area that allocation fails without surfacing anything: no
 * console error, no `error` event, no rejected promise - the viewport simply
 * stays blank while the page count and toolbar still render.
 *
 * Measured on a 3600x1914pt scanned page at devicePixelRatio 2:
 * 17.6 MP rasterizes, 27.6 MP produces nothing. 16 MP leaves margin below the
 * observed failure point while still allowing 100% zoom on ordinary A4 pages
 * (595x842pt at dpr 2 is only 2.0 MP).
 */
export const MAX_PAGE_DEVICE_PIXELS = 16_000_000

/** Area in PDF points of the largest page in the document. */
export function largestPageArea(pages: readonly Pick<PdfPageObject, 'size'>[]): number {
  return pages.reduce((max, page) => Math.max(max, page.size.width * page.size.height), 0)
}

/**
 * Reduce a zoom scale so the largest page stays inside the rasterizer budget.
 * Returns the requested scale unchanged when it already fits, or when the page
 * area is unknown (document not loaded yet).
 */
export function clampScaleForPageArea(scale: number, pageArea: number, devicePixelRatio: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return scale
  if (!Number.isFinite(pageArea) || pageArea <= 0) return scale
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const devicePixels = pageArea * scale * scale * dpr * dpr
  if (devicePixels <= MAX_PAGE_DEVICE_PIXELS) return scale
  return scale * Math.sqrt(MAX_PAGE_DEVICE_PIXELS / devicePixels)
}

export function toRotation(rotation: PdfReaderSettings['rotation']): Rotation {
  if (rotation === 90) return Rotation.Degree90
  if (rotation === 180) return Rotation.Degree180
  if (rotation === 270) return Rotation.Degree270
  return Rotation.Degree0
}

export function fromRotation(rotation: Rotation): PdfReaderSettings['rotation'] {
  if (rotation === Rotation.Degree90) return 90
  if (rotation === Rotation.Degree180) return 180
  if (rotation === Rotation.Degree270) return 270
  return 0
}

export function flattenPdfBookmarks(bookmarks: PdfBookmarkObject[], depth = 0): FlatPdfBookmark[] {
  return bookmarks.flatMap((bookmark) => [{ bookmark, depth }, ...flattenPdfBookmarks(bookmark.children ?? [], depth + 1)])
}

export function safeExternalPdfUrl(uri: string): URL | null {
  try {
    const url = new URL(uri, window.location.href)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}
