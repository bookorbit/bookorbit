import type { LocationQueryRaw, RouteLocationRaw } from 'vue-router'

/** One chart entry that opens a page: what a screen reader announces for it and where it goes. */
export interface ChartDrillDownTarget {
  /** The entry's index in the first series' data, as ECharts numbers it. */
  dataIndex: number
  text: string
  to: RouteLocationRaw
}

/**
 * How a pointer finds its entry. `item`: the shape under it (treemap tiles). `category`: the row of
 * a horizontal bar chart under it, so a short bar is as easy to hit as a long one, plus the row's
 * axis label.
 */
export type ChartDrillDownHit = 'item' | 'category'

interface PixelChart {
  containPixel: (finder: string, value: number[]) => boolean
  convertFromPixel: (finder: { gridIndex: number }, value: number[]) => unknown
}

export function categoryIndexAtPixel(chart: PixelChart, x: number, y: number): number | null {
  if (!chart.containPixel('grid', [x, y])) return null
  const raw = chart.convertFromPixel({ gridIndex: 0 }, [x, y])
  if (!Array.isArray(raw)) return null
  const index = Math.round(Number(raw[1]))
  return Number.isInteger(index) && index >= 0 ? index : null
}

/** Where an arrow, Home or End key moves focus in a list of `count` entries; null for other keys. */
export function nextTargetPosition(current: number, key: string, count: number): number | null {
  if (count === 0) return null
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return Math.min(current + 1, count - 1)
    case 'ArrowUp':
    case 'ArrowLeft':
      return Math.max(current - 1, 0)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/** The scrolled window that brings `index` into view, keeping its size; null when it is already in view. */
export function windowShowing(window: { start: number; end: number }, index: number): { start: number; end: number } | null {
  if (index >= window.start && index <= window.end) return null
  const size = window.end - window.start
  if (index < window.start) return { start: index, end: index + size }
  return { start: index - size, end: index }
}

/**
 * The library a click should carry to the page it opens. Statistics treats an empty selection as
 * every library; a page only takes one library, so a selection of several opens unfiltered.
 */
export function drillDownLibraryQuery(libraryIds: readonly number[]): LocationQueryRaw {
  return libraryIds.length === 1 ? { libraryId: String(libraryIds[0]) } : {}
}
