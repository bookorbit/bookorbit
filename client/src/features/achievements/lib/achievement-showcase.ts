import type { AchievementItem, AchievementRarity } from '@bookorbit/types'
import type { DisplayItem } from '../types'
import { isLockedSecret } from './achievement-display'
import { MEDAL_RARITIES, medalRarity } from './medal-geometry'

/** Earned achievements, newest first. Ties (one evaluation awarding several) keep catalogue order. */
export function latestUnlocks(items: AchievementItem[], limit: number): AchievementItem[] {
  return items
    .filter((item) => item.earned && item.awardedAt)
    .sort((a, b) => (b.awardedAt ?? '').localeCompare(a.awardedAt ?? '') || a.sortOrder - b.sortOrder)
    .slice(0, limit)
}

/** How many achievements unlocked on `now`'s local calendar day. */
export function unlockedOnDay(items: AchievementItem[], now: Date = new Date()): number {
  const day = now.toDateString()
  return items.filter((item) => item.earned && item.awardedAt && new Date(item.awardedAt).toDateString() === day).length
}

export interface ClosestUnlock {
  display: DisplayItem
  /** The tier (or achievement) that unlocks next. */
  item: AchievementItem
  current: number
  threshold: number
  fraction: number
}

/**
 * What is nearest to unlocking, by share of the threshold reached. Only the next tier of a set counts,
 * and progress already at the threshold is waiting on the server to award it, not close to it. `skip`
 * drops achievements that cannot be earned right now, however far along they look.
 */
export function closestUnlocks(items: DisplayItem[], limit: number, skip?: (item: AchievementItem) => boolean): ClosestUnlock[] {
  const out: ClosestUnlock[] = []
  for (const display of items) {
    const item = display.type === 'tiered' ? display.nextUnearned : display.achievement
    if (!item || item.earned || isLockedSecret(item) || skip?.(item)) continue
    const threshold = item.threshold ?? 0
    const current = item.currentProgress ?? 0
    if (threshold <= 0 || current <= 0 || current >= threshold) continue
    out.push({ display, item, current, threshold, fraction: current / threshold })
  }
  return out.sort((a, b) => b.fraction - a.fraction || a.item.sortOrder - b.item.sortOrder).slice(0, limit)
}

export type RarityTally = Record<AchievementRarity, { earned: number; total: number }>

/** Earned and total tiers per rarity; every tier counts, so a four-tier set adds four. */
export function rarityTally(items: AchievementItem[]): RarityTally {
  const tally = Object.fromEntries(MEDAL_RARITIES.map((rarity) => [rarity, { earned: 0, total: 0 }])) as RarityTally
  for (const item of items) {
    const slot = tally[medalRarity(item.rarity)]
    slot.total++
    if (item.earned) slot.earned++
  }
  return tally
}
