import type { RouteLocationRaw } from 'vue-router'

interface MonthChart {
  containPixel: (finder: string, value: number[]) => boolean
  convertFromPixel: (finder: { gridIndex: number }, value: number[]) => unknown
}

/**
 * Where a click on a monthly chart goes: History, opened on the month under the pointer. Charts
 * plot one category per month; the grid converts the pointer to [category index, value], so the
 * index picks the month even between drawn symbols.
 */
export function historyRouteForChartClick(
  chart: MonthChart | null | undefined,
  event: { offsetX: number; offsetY: number },
  points: readonly { year: number; month: number }[],
): RouteLocationRaw | null {
  if (!chart || !chart.containPixel('grid', [event.offsetX, event.offsetY])) return null
  const raw = chart.convertFromPixel({ gridIndex: 0 }, [event.offsetX, event.offsetY])
  const index = Math.round(Array.isArray(raw) ? Number(raw[0]) : Number(raw))
  const point = points[index]
  if (!point) return null
  return { name: 'reading-history', query: { year: String(point.year), month: `${point.year}-${String(point.month).padStart(2, '0')}` } }
}
