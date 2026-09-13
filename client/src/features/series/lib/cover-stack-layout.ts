/** Covers in the fan. Past this the outer ones are slivers and the count badge says the rest. */
export const STACK_MAX_VISIBLE = 5

const COVER_WIDTH_PCT = 43
const BASE_BOTTOM_PCT = 4
/** How much higher the middle of the fan sits than its outermost cover. */
const PYRAMID_LIFT_PCT = 7
const SCALE_FALLOFF = 0.05

/** Total width of the fan, per cover count, as a percentage of the stack box. */
const GROUP_WIDTH_BY_COUNT: Record<number, number> = { 1: 43, 2: 63, 3: 74, 4: 83, 5: 90 }

export type CoverStackSlotStyle = {
  left: string
  bottom: string
  width: string
  zIndex: number
  boxShadow: string
  '--offset': string
  '--scale': string
}

/**
 * A fanned pyramid: covers step evenly across the box, the middle one sits highest, largest and
 * in front, and the outer ones fall away behind it.
 *
 * Every value here is a percentage of the box, so the fan needs no measurement to lay out - the
 * box's own aspect ratio gives it a height and the covers follow. The only thing that changes at
 * runtime is one custom property on hover, which the covers read through `--offset`, so spreading
 * the fan animates entirely in CSS without Vue re-rendering a single cover.
 */
function buildLayout(count: number): CoverStackSlotStyle[] {
  if (count <= 0) return []

  const groupWidth = GROUP_WIDTH_BY_COUNT[count] ?? 90
  const step = count > 1 ? (groupWidth - COVER_WIDTH_PCT) / (count - 1) : 0
  const startLeft = (100 - groupWidth) / 2
  const center = (count - 1) / 2
  const maxDistance = Math.max(center, 1)

  return Array.from({ length: count }, (_, index) => {
    const offset = index - center
    const distance = Math.abs(offset)
    const depth = distance / maxDistance

    return {
      left: `${startLeft + step * index}%`,
      bottom: `${BASE_BOTTOM_PCT + (1 - depth) * PYRAMID_LIFT_PCT}%`,
      width: `${COVER_WIDTH_PCT}%`,
      zIndex: Math.round(count - distance) + 1,
      boxShadow:
        distance < 0.5
          ? '0 18px 34px -20px rgb(15 23 42 / 0.72), 0 8px 14px -12px rgb(15 23 42 / 0.28)'
          : '0 14px 26px -20px rgb(15 23 42 / 0.58), 0 6px 12px -12px rgb(15 23 42 / 0.22)',
      '--offset': String(offset),
      '--scale': String(1 - distance * SCALE_FALLOFF),
    }
  })
}

/** One layout per cover count, so scrolling a page of cards recomputes nothing. */
const LAYOUT_CACHE = new Map<number, CoverStackSlotStyle[]>()

export function coverStackLayout(count: number): CoverStackSlotStyle[] {
  const clamped = Math.min(Math.max(count, 0), STACK_MAX_VISIBLE)
  let layout = LAYOUT_CACHE.get(clamped)
  if (!layout) {
    layout = buildLayout(clamped)
    LAYOUT_CACHE.set(clamped, layout)
  }
  return layout
}

/**
 * Reorders so the first volume lands in the middle of the fan, where the eye goes, and later
 * volumes alternate outwards behind it.
 */
export function orderForStack<T>(items: T[]): T[] {
  const result: T[] = []
  items.forEach((item, index) => {
    if (index === 0 || index % 2 === 1) result.push(item)
    else result.unshift(item)
  })
  return result
}
