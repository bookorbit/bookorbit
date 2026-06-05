import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { computeBasePositions, useCoverStack } from './useCoverStack'

describe('computeBasePositions', () => {
  it('returns empty array for zero covers', () => {
    expect(computeBasePositions(0)).toEqual([])
  })

  it('returns single centered cover for count 1', () => {
    const result = computeBasePositions(1)
    expect(result).toHaveLength(1)
    expect(result[0]!.width).toBe('43%')
    expect(result[0]!.aspectRatio).toBe('2 / 3')
    expect(result[0]!.left).toBe('28.5%')
  })

  it('returns correct number of positions', () => {
    for (const count of [2, 3, 4, 5, 6, 7]) {
      const result = computeBasePositions(count)
      expect(result).toHaveLength(count)
    }
  })

  it('assigns higher zIndex to center covers', () => {
    const result = computeBasePositions(5)
    const centerIndex = 2
    expect(result[centerIndex]!.zIndex).toBeGreaterThan(result[0]!.zIndex)
    expect(result[centerIndex]!.zIndex).toBeGreaterThan(result[4]!.zIndex)
  })

  it('uses default group width for count > 7', () => {
    const result = computeBasePositions(8)
    expect(result).toHaveLength(8)
    // Should not throw, uses fallback
  })

  it('produces consistent output for same input', () => {
    const a = computeBasePositions(4)
    const b = computeBasePositions(4)
    expect(a).toEqual(b)
  })
})

describe('useCoverStack', () => {
  it('limits visible covers to MAX_VISIBLE (7)', () => {
    const ids = ref([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const { visibleCovers } = useCoverStack(ids)
    expect(visibleCovers.value).toHaveLength(7)
    expect(visibleCovers.value).toEqual([7, 5, 3, 1, 2, 4, 6])
  })

  it('returns all covers when fewer than MAX_VISIBLE', () => {
    const ids = ref([10, 20, 30])
    const { visibleCovers } = useCoverStack(ids)
    expect(visibleCovers.value).toEqual([30, 10, 20])
  })

  it('returns empty for empty input', () => {
    const ids = ref<number[]>([])
    const { visibleCovers, baseStyles } = useCoverStack(ids)
    expect(visibleCovers.value).toEqual([])
    expect(baseStyles.value).toEqual([])
  })

  it('base styles count matches visible covers count', () => {
    const ids = ref([1, 2, 3, 4, 5])
    const { visibleCovers, baseStyles } = useCoverStack(ids)
    expect(baseStyles.value).toHaveLength(visibleCovers.value.length)
  })

  it('reacts to ref changes', () => {
    const ids = ref([1, 2])
    const { visibleCovers, baseStyles } = useCoverStack(ids)
    expect(visibleCovers.value).toHaveLength(2)
    expect(baseStyles.value).toHaveLength(2)

    ids.value = [1, 2, 3, 4]
    expect(visibleCovers.value).toHaveLength(4)
    expect(baseStyles.value).toHaveLength(4)
  })
})
