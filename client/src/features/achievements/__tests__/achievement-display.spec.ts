// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { groupAchievements } from '../composables/useGroupedAchievements'
import { bucketOf, displayId, filterCounts, matchesFilter, medalFace } from '../lib/achievement-display'
import { booksFinishedSet, makeAchievement } from './fixtures'

describe('bucketOf', () => {
  it('keeps a part-earned tier set in progress until its last tier lands', () => {
    const [partial] = groupAchievements(booksFinishedSet(3, 47))
    const [complete] = groupAchievements(booksFinishedSet(4, null))
    expect(bucketOf(partial!)).toBe('in-progress')
    expect(bucketOf(complete!)).toBe('earned')
  })

  it('counts a set with progress but no tier as in progress, and one without either as locked', () => {
    expect(bucketOf(groupAchievements(booksFinishedSet(0, 0.5))[0]!)).toBe('in-progress')
    expect(bucketOf(groupAchievements(booksFinishedSet(0, null))[0]!)).toBe('locked')
  })

  it('never puts a hidden achievement in progress, so its progress cannot leak', () => {
    const [secret] = groupAchievements([makeAchievement({ key: 'secret', hidden: true, threshold: 5, currentProgress: 3 })])
    expect(bucketOf(secret!)).toBe('locked')
  })
})

describe('filterCounts', () => {
  it('adds up to the total, with no achievement counted twice', () => {
    const items = groupAchievements([
      ...booksFinishedSet(2, 12),
      makeAchievement({ key: 'a', sortOrder: 10, earned: true, awardedAt: '2026-08-01T00:00:00.000Z' }),
      makeAchievement({ key: 'b', sortOrder: 11, threshold: 10, currentProgress: 4 }),
      makeAchievement({ key: 'c', sortOrder: 12 }),
    ])
    const counts = filterCounts(items)
    expect(counts).toEqual({ all: 4, earned: 1, 'in-progress': 2, locked: 1 })
    expect(counts.earned + counts['in-progress'] + counts.locked).toBe(counts.all)
    expect(items.filter((item) => matchesFilter(item, 'locked')).map(displayId)).toEqual(['c'])
  })
})

describe('medalFace', () => {
  it('shows the highest earned tier of a set', () => {
    const face = medalFace(groupAchievements(booksFinishedSet(3, 47))[0]!)
    expect(face).toMatchObject({ rarity: 'epic', state: 'earned', progress: null })
    expect(face.item.name).toBe('Story Stalwart')
  })

  it('shows the first tier, unstruck, with its progress, before any tier is earned', () => {
    const face = medalFace(groupAchievements(booksFinishedSet(0, 0.5))[0]!)
    expect(face.state).toBe('locked')
    expect(face.item.name).toBe('Ink Initiate')
    expect(face.progress).toBe(0.5)
  })

  it('marks a hidden locked achievement as a secret and an unknown rarity as common', () => {
    const face = medalFace(groupAchievements([makeAchievement({ hidden: true, rarity: 'mythic' as never })])[0]!)
    expect(face).toMatchObject({ state: 'secret', rarity: 'common' })
  })
})
