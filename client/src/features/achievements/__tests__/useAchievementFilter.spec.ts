import { describe, expect, it } from 'vitest'
import type { AchievementItem } from '@bookorbit/types'
import { useAchievementFilter } from '../composables/useAchievementFilter'
import type { DisplayItem, SingleItem, TieredGroup } from '../types'

function makeSingle(overrides: Partial<AchievementItem> = {}): SingleItem {
  return {
    type: 'single',
    achievement: {
      key: 'k',
      groupKey: null,
      tier: null,
      category: 'reading',
      name: 'Test',
      description: 'Desc',
      iconName: 'book-open',
      rarity: 'common',
      threshold: null,
      hidden: false,
      sortOrder: 1,
      earned: false,
      awardedAt: null,
      context: null,
      currentProgress: null,
      ...overrides,
    },
  }
}

function makeTiered(overrides: Partial<TieredGroup> = {}): TieredGroup {
  return {
    type: 'tiered',
    groupKey: 'g',
    category: 'reading',
    displayName: 'Group',
    displayDescription: 'Desc',
    iconName: 'book-open',
    rarity: 'common',
    tiers: [],
    earnedCount: 0,
    totalTiers: 4,
    highestEarnedTier: null,
    nextUnearned: null,
    currentProgress: null,
    sortOrder: 1,
    ...overrides,
  }
}

describe('useAchievementFilter', () => {
  it('all filter returns all items', () => {
    const items: DisplayItem[] = [makeSingle({ earned: true }), makeSingle({ earned: false })]
    const { filteredItems } = useAchievementFilter(() => items)
    expect(filteredItems.value).toHaveLength(2)
  })

  it('earned filter returns only earned singles', () => {
    const items: DisplayItem[] = [makeSingle({ earned: true, key: 'a' }), makeSingle({ earned: false, key: 'b' })]
    const { filteredItems, setFilter } = useAchievementFilter(() => items)
    setFilter('earned')
    expect(filteredItems.value).toHaveLength(1)
    expect((filteredItems.value[0] as SingleItem).achievement.key).toBe('a')
  })

  it('earned filter returns tiered with earnedCount > 0', () => {
    const items: DisplayItem[] = [makeTiered({ earnedCount: 2 }), makeTiered({ groupKey: 'g2', earnedCount: 0 })]
    const { filteredItems, setFilter } = useAchievementFilter(() => items)
    setFilter('earned')
    expect(filteredItems.value).toHaveLength(1)
    expect((filteredItems.value[0] as TieredGroup).earnedCount).toBe(2)
  })

  it('locked filter returns single not-earned + tiered with earnedCount === 0', () => {
    const items: DisplayItem[] = [
      makeSingle({ earned: false, key: 'a' }),
      makeSingle({ earned: true, key: 'b' }),
      makeTiered({ groupKey: 'g1', earnedCount: 0 }),
      makeTiered({ groupKey: 'g2', earnedCount: 1 }),
    ]
    const { filteredItems, setFilter } = useAchievementFilter(() => items)
    setFilter('locked')
    expect(filteredItems.value).toHaveLength(2)
  })

  it('in-progress filter: tiered with 0 < earnedCount < totalTiers', () => {
    const items: DisplayItem[] = [
      makeTiered({ groupKey: 'g1', earnedCount: 2, totalTiers: 4 }),
      makeTiered({ groupKey: 'g2', earnedCount: 0, totalTiers: 4 }),
      makeTiered({ groupKey: 'g3', earnedCount: 4, totalTiers: 4 }),
    ]
    const { filteredItems, setFilter } = useAchievementFilter(() => items)
    setFilter('in-progress')
    expect(filteredItems.value).toHaveLength(1)
    expect((filteredItems.value[0] as TieredGroup).groupKey).toBe('g1')
  })

  it('in-progress filter: single with progress > 0 and not earned', () => {
    const items: DisplayItem[] = [
      makeSingle({ key: 'a', earned: false, currentProgress: 5 }),
      makeSingle({ key: 'b', earned: false, currentProgress: 0 }),
      makeSingle({ key: 'c', earned: false, currentProgress: null }),
      makeSingle({ key: 'd', earned: true, currentProgress: 5 }),
    ]
    const { filteredItems, setFilter } = useAchievementFilter(() => items)
    setFilter('in-progress')
    expect(filteredItems.value).toHaveLength(1)
    expect((filteredItems.value[0] as SingleItem).achievement.key).toBe('a')
  })

  it('setFilter updates activeFilter', () => {
    const { activeFilter, setFilter } = useAchievementFilter(() => [])
    expect(activeFilter.value).toBe('all')
    setFilter('earned')
    expect(activeFilter.value).toBe('earned')
  })
})
