import type { AchievementCategoryGroup, AchievementItem } from '@bookorbit/types'

export function makeAchievement(overrides: Partial<AchievementItem> = {}): AchievementItem {
  return {
    key: 'achievement',
    groupKey: null,
    tier: null,
    category: 'reading',
    name: 'Achievement',
    description: 'Description',
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

/** A four-tier "books finished" set with the first `earned` tiers awarded and `progress` toward the next. */
export function booksFinishedSet(earned: number, progress: number | null): AchievementItem[] {
  const names = ['Ink Initiate', 'Spine Scout', 'Story Stalwart', 'Grand Archivist']
  const thresholds = [1, 10, 35, 100]
  const rarities = ['common', 'rare', 'epic', 'legendary'] as const
  return names.map((name, index) =>
    makeAchievement({
      key: `books_finished_${index + 1}`,
      groupKey: 'books_finished',
      tier: index + 1,
      name,
      description: `Finish ${thresholds[index]} books`,
      rarity: rarities[index],
      threshold: thresholds[index]!,
      sortOrder: index + 1,
      earned: index < earned,
      awardedAt: index < earned ? `2026-08-1${index + 5}T10:00:00.000Z` : null,
      currentProgress: index === earned ? progress : null,
      context: index < earned ? { count: thresholds[index], bookId: 300 + index, bookTitle: `Book ${index + 1}` } : null,
    }),
  )
}

export function makeCategory(overrides: Partial<AchievementCategoryGroup> = {}): AchievementCategoryGroup {
  return {
    key: 'reading',
    label: 'Reading',
    earnedCount: 0,
    totalCount: 0,
    achievements: [],
    ...overrides,
  }
}
