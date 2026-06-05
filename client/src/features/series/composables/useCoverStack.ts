import { computed, type Ref } from 'vue'

export const MAX_VISIBLE = 7
const COVER_WIDTH_PCT = 43
const VERTICAL_MARGIN_PCT = 5.5
const GROUP_WIDTH_BY_COUNT: Record<number, number> = {
  1: 43,
  2: 62,
  3: 72,
  4: 80,
  5: 86,
  6: 90,
  7: 92,
}
const DEFAULT_GROUP_WIDTH = 92

export type CoverStackBaseStyle = {
  left: string
  bottom: string
  width: string
  aspectRatio: string
  zIndex: number
  boxShadow: string
}

export function computeBasePositions(count: number): CoverStackBaseStyle[] {
  if (count === 0) return []

  const groupWidth = GROUP_WIDTH_BY_COUNT[count] ?? DEFAULT_GROUP_WIDTH
  const step = count > 1 ? (groupWidth - COVER_WIDTH_PCT) / (count - 1) : 0
  const startLeft = (100 - groupWidth) / 2
  const center = (count - 1) / 2

  return Array.from({ length: count }, (_, index) => ({
    left: `${startLeft + step * index}%`,
    bottom: `${VERTICAL_MARGIN_PCT}%`,
    width: `${COVER_WIDTH_PCT}%`,
    aspectRatio: '2 / 3',
    zIndex: Math.round(count - Math.abs(index - center)) + 1,
    boxShadow:
      index === Math.round(center)
        ? '0 18px 34px -20px rgba(15, 23, 42, 0.72), 0 8px 14px -12px rgba(15, 23, 42, 0.28)'
        : '0 14px 26px -20px rgba(15, 23, 42, 0.58), 0 6px 12px -12px rgba(15, 23, 42, 0.22)',
  }))
}

export function rearrangeForStack<T>(items: T[]): T[] {
  const result: T[] = []
  items.forEach((item, i) => {
    if (i === 0 || i % 2 === 1) {
      result.push(item)
    } else {
      result.unshift(item)
    }
  })
  return result
}

export function useCoverStack(coverIds: Ref<number[]>) {
  const visibleCovers = computed(() => {
    const sliced = coverIds.value.slice(0, MAX_VISIBLE)
    return rearrangeForStack(sliced)
  })

  const baseStyles = computed(() => computeBasePositions(visibleCovers.value.length))

  return { visibleCovers, baseStyles, MAX_VISIBLE }
}
