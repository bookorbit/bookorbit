import { describe, expect, it } from 'vitest'
import type { AchievementItem } from '@bookorbit/types'
import { groupAchievements } from '../composables/useGroupedAchievements'
import type { DisplayItem, SingleItem, TieredGroup } from '../types'

function makeAchievement(overrides: Partial<AchievementItem>): AchievementItem {
  return {
    key: 'test_key',
    groupKey: null,
    tier: null,
    category: 'reading',
    name: 'Test Achievement',
    description: 'Test description',
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
  }
}

function expectSingle(item: DisplayItem | undefined): SingleItem {
  expect(item).toBeDefined()

  if (!item) {
    throw new Error('Expected a single achievement item')
  }

  expect(item.type).toBe('single')

  if (item.type !== 'single') {
    throw new Error('Expected a single achievement item')
  }

  return item
}

function expectTiered(item: DisplayItem | undefined): TieredGroup {
  expect(item).toBeDefined()

  if (!item) {
    throw new Error('Expected a tiered achievement group')
  }

  expect(item.type).toBe('tiered')

  if (item.type !== 'tiered') {
    throw new Error('Expected a tiered achievement group')
  }

  return item
}

describe('groupAchievements', () => {
  it('returns empty array for empty input', () => {
    expect(groupAchievements([])).toEqual([])
  })

  it('wraps single achievements (no groupKey/tier) as SingleItem', () => {
    const achievement = makeAchievement({ key: 'solo', groupKey: null, tier: null })
    const result = groupAchievements([achievement])
    expect(result).toHaveLength(1)

    const single = expectSingle(result[0])
    expect(single.achievement.key).toBe('solo')
  })

  it('groups achievements with same groupKey into TieredGroup', () => {
    const tierOne = makeAchievement({
      key: 'g_1',
      groupKey: 'g',
      tier: 1,
      name: 'Tier 1',
      sortOrder: 1,
    })
    const tierTwo = makeAchievement({
      key: 'g_2',
      groupKey: 'g',
      tier: 2,
      name: 'Tier 2',
      sortOrder: 2,
    })
    const result = groupAchievements([tierOne, tierTwo])
    expect(result).toHaveLength(1)

    const group = expectTiered(result[0])
    expect(group.groupKey).toBe('g')
    expect(group.tiers).toHaveLength(2)
  })

  it('uses tier 1 name when nothing is earned', () => {
    const tierOne = makeAchievement({
      key: 'g_1',
      groupKey: 'g',
      tier: 1,
      name: 'Tier 1 Name',
      earned: false,
    })
    const tierTwo = makeAchievement({
      key: 'g_2',
      groupKey: 'g',
      tier: 2,
      name: 'Tier 2 Name',
      earned: false,
    })
    const result = groupAchievements([tierOne, tierTwo])

    const group = expectTiered(result[0])
    expect(group.displayName).toBe('Tier 1 Name')
  })

  it('uses highest earned tier name as displayName', () => {
    const tierOne = makeAchievement({
      key: 'g_1',
      groupKey: 'g',
      tier: 1,
      name: 'Tier 1 Name',
      earned: true,
    })
    const tierTwo = makeAchievement({
      key: 'g_2',
      groupKey: 'g',
      tier: 2,
      name: 'Tier 2 Name',
      earned: true,
    })
    const tierThree = makeAchievement({
      key: 'g_3',
      groupKey: 'g',
      tier: 3,
      name: 'Tier 3 Name',
      earned: false,
    })
    const result = groupAchievements([tierOne, tierTwo, tierThree])

    const group = expectTiered(result[0])
    expect(group.displayName).toBe('Tier 2 Name')
  })

  it('displayDescription is next unearned description', () => {
    const tierOne = makeAchievement({
      key: 'g_1',
      groupKey: 'g',
      tier: 1,
      earned: true,
      description: 'Desc 1',
    })
    const tierTwo = makeAchievement({
      key: 'g_2',
      groupKey: 'g',
      tier: 2,
      earned: false,
      description: 'Desc 2',
    })
    const result = groupAchievements([tierOne, tierTwo])

    const group = expectTiered(result[0])
    expect(group.displayDescription).toBe('Desc 2')
  })

  it('displayDescription is All tiers complete! when all earned', () => {
    const tierOne = makeAchievement({ key: 'g_1', groupKey: 'g', tier: 1, earned: true })
    const tierTwo = makeAchievement({ key: 'g_2', groupKey: 'g', tier: 2, earned: true })
    const result = groupAchievements([tierOne, tierTwo])

    const group = expectTiered(result[0])
    expect(group.displayDescription).toBe('All tiers complete!')
  })

  it('uses tier 1 rarity when nothing is earned', () => {
    const tierOne = makeAchievement({
      key: 'g_1',
      groupKey: 'g',
      tier: 1,
      rarity: 'common',
      earned: false,
    })
    const tierTwo = makeAchievement({
      key: 'g_2',
      groupKey: 'g',
      tier: 2,
      rarity: 'rare',
      earned: false,
    })
    const result = groupAchievements([tierOne, tierTwo])

    const group = expectTiered(result[0])
    expect(group.rarity).toBe('common')
  })

  it('uses highest earned tier rarity', () => {
    const tierOne = makeAchievement({
      key: 'g_1',
      groupKey: 'g',
      tier: 1,
      rarity: 'common',
      earned: true,
    })
    const tierTwo = makeAchievement({
      key: 'g_2',
      groupKey: 'g',
      tier: 2,
      rarity: 'rare',
      earned: true,
    })
    const tierThree = makeAchievement({
      key: 'g_3',
      groupKey: 'g',
      tier: 3,
      rarity: 'epic',
      earned: false,
    })
    const result = groupAchievements([tierOne, tierTwo, tierThree])

    const group = expectTiered(result[0])
    expect(group.rarity).toBe('rare')
  })

  it('earnedCount counts earned tiers correctly', () => {
    const tierOne = makeAchievement({ key: 'g_1', groupKey: 'g', tier: 1, earned: true })
    const tierTwo = makeAchievement({ key: 'g_2', groupKey: 'g', tier: 2, earned: true })
    const tierThree = makeAchievement({ key: 'g_3', groupKey: 'g', tier: 3, earned: false })
    const result = groupAchievements([tierOne, tierTwo, tierThree])

    const group = expectTiered(result[0])
    expect(group.earnedCount).toBe(2)
  })

  it('currentProgress is nextUnearned currentProgress', () => {
    const tierOne = makeAchievement({
      key: 'g_1',
      groupKey: 'g',
      tier: 1,
      earned: true,
      currentProgress: null,
    })
    const tierTwo = makeAchievement({
      key: 'g_2',
      groupKey: 'g',
      tier: 2,
      earned: false,
      currentProgress: 42,
    })
    const result = groupAchievements([tierOne, tierTwo])

    const group = expectTiered(result[0])
    expect(group.currentProgress).toBe(42)
  })

  it('sorts output by sortOrder', () => {
    const achievementB = makeAchievement({ key: 'b', groupKey: null, tier: null, sortOrder: 10 })
    const achievementA = makeAchievement({ key: 'a', groupKey: null, tier: null, sortOrder: 5 })
    const result = groupAchievements([achievementB, achievementA])

    const first = expectSingle(result[0])
    const second = expectSingle(result[1])
    expect(first.achievement.key).toBe('a')
    expect(second.achievement.key).toBe('b')
  })

  it('handles all tiers earned (no nextUnearned)', () => {
    const tierOne = makeAchievement({ key: 'g_1', groupKey: 'g', tier: 1, earned: true })
    const result = groupAchievements([tierOne])

    const group = expectTiered(result[0])
    expect(group.nextUnearned).toBeNull()
    expect(group.earnedCount).toBe(1)
    expect(group.totalTiers).toBe(1)
  })
})
