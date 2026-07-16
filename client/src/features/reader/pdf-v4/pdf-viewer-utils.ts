import { Rotation, type PdfBookmarkObject } from '@embedpdf/models'
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
