import type { AchievementItem, AchievementRarity } from '@bookorbit/types'
import type { DisplayItem, FilterState } from '../types'
import { medalRarity } from './medal-geometry'

export type AchievementBucket = Exclude<FilterState, 'all'>

/**
 * Three buckets that never overlap, so the filter counts add up to the total: a tier set with some
 * tiers earned is still in progress until the last one lands.
 */
export function bucketOf(item: DisplayItem): AchievementBucket {
  if (item.type === 'tiered') {
    if (item.earnedCount === item.totalTiers) return 'earned'
    if (item.earnedCount > 0 || (item.currentProgress ?? 0) > 0) return 'in-progress'
    return 'locked'
  }
  const { achievement } = item
  if (achievement.earned) return 'earned'
  if (!isLockedSecret(achievement) && (achievement.currentProgress ?? 0) > 0) return 'in-progress'
  return 'locked'
}

export function matchesFilter(item: DisplayItem, filter: FilterState): boolean {
  return filter === 'all' || bucketOf(item) === filter
}

export function filterCounts(items: DisplayItem[]): Record<FilterState, number> {
  const counts: Record<FilterState, number> = { all: items.length, earned: 0, 'in-progress': 0, locked: 0 }
  for (const item of items) counts[bucketOf(item)]++
  return counts
}

export function isLockedSecret(item: AchievementItem): boolean {
  return item.hidden && !item.earned
}

export type MedalState = 'earned' | 'locked' | 'secret'

export interface MedalFace {
  /** The tier or achievement whose name and icon the medal shows. */
  item: AchievementItem
  rarity: AchievementRarity
  state: MedalState
  /** 0..1 toward the next unlock, or null when nothing is counting. */
  progress: number | null
}

/** What a medal shows: the highest earned tier of a set (or its first tier), or the achievement itself. */
export function medalFace(item: DisplayItem): MedalFace {
  if (item.type === 'tiered') {
    const shown = item.highestEarnedTier ?? item.tiers[0]!
    return {
      item: shown,
      rarity: medalRarity(shown.rarity),
      state: item.highestEarnedTier ? 'earned' : 'locked',
      progress: item.highestEarnedTier ? null : progressOf(item.nextUnearned),
    }
  }
  const { achievement } = item
  return {
    item: achievement,
    rarity: medalRarity(achievement.rarity),
    state: achievement.earned ? 'earned' : isLockedSecret(achievement) ? 'secret' : 'locked',
    progress: achievement.earned ? null : progressOf(achievement),
  }
}

export function progressOf(item: AchievementItem | null | undefined): number | null {
  if (!item || item.earned || !item.threshold || item.threshold <= 0 || item.currentProgress == null) return null
  return Math.min(1, Math.max(0, item.currentProgress / item.threshold))
}

export function displayId(item: DisplayItem): string {
  return item.type === 'tiered' ? item.groupKey : item.achievement.key
}
