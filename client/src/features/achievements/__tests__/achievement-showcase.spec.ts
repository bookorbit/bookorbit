// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { groupAchievements } from '../composables/useGroupedAchievements'
import { closestUnlocks, latestUnlocks, rarityTally, unlockedOnDay } from '../lib/achievement-showcase'
import { booksFinishedSet, makeAchievement } from './fixtures'

describe('latestUnlocks', () => {
  it('orders earned achievements newest first and keeps catalogue order within one award', () => {
    const items = [
      makeAchievement({ key: 'old', sortOrder: 1, earned: true, awardedAt: '2026-08-01T10:00:00.000Z' }),
      makeAchievement({ key: 'same-b', sortOrder: 5, earned: true, awardedAt: '2026-10-16T08:54:16.000Z' }),
      makeAchievement({ key: 'same-a', sortOrder: 3, earned: true, awardedAt: '2026-10-16T08:54:16.000Z' }),
      makeAchievement({ key: 'locked', sortOrder: 2 }),
    ]
    expect(latestUnlocks(items, 3).map((item) => item.key)).toEqual(['same-a', 'same-b', 'old'])
  })
})

describe('unlockedOnDay', () => {
  it('counts unlocks on the given local day only', () => {
    const now = new Date(2026, 9, 16, 18, 0)
    const items = [
      makeAchievement({ earned: true, awardedAt: new Date(2026, 9, 16, 9, 0).toISOString() }),
      makeAchievement({ earned: true, awardedAt: new Date(2026, 9, 15, 23, 0).toISOString() }),
    ]
    expect(unlockedOnDay(items, now)).toBe(1)
  })
})

describe('closestUnlocks', () => {
  it('ranks by share of the threshold and looks only at the next tier of a set', () => {
    const items = groupAchievements([
      ...booksFinishedSet(3, 47),
      makeAchievement({ key: 'decade', sortOrder: 20, threshold: 5, currentProgress: 4 }),
      makeAchievement({ key: 'hours', sortOrder: 21, threshold: 500, currentProgress: 474 }),
    ])
    const closest = closestUnlocks(items, 4)
    expect(closest.map((entry) => entry.item.key)).toEqual(['hours', 'decade', 'books_finished_4'])
    expect(closest[2]).toMatchObject({ current: 47, threshold: 100 })
  })

  it('skips secrets, earned items and progress already at the threshold', () => {
    const items = groupAchievements([
      makeAchievement({ key: 'secret', hidden: true, threshold: 10, currentProgress: 9 }),
      makeAchievement({ key: 'waiting', sortOrder: 2, threshold: 10, currentProgress: 10 }),
      makeAchievement({ key: 'done', sortOrder: 3, earned: true, threshold: 10, currentProgress: 9 }),
    ])
    expect(closestUnlocks(items, 4)).toEqual([])
  })
})

describe('rarityTally', () => {
  it('counts every tier, earned and total, per rarity', () => {
    const tally = rarityTally([...booksFinishedSet(2, 12), makeAchievement({ rarity: 'legendary', earned: true })])
    expect(tally).toEqual({
      common: { earned: 1, total: 1 },
      rare: { earned: 1, total: 1 },
      epic: { earned: 0, total: 1 },
      legendary: { earned: 1, total: 2 },
    })
  })
})
