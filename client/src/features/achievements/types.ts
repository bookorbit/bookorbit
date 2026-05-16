import type { AchievementCategory, AchievementItem, AchievementRarity } from '@bookorbit/types'

export type FilterState = 'all' | 'earned' | 'locked' | 'in-progress'

export interface TieredGroup {
  type: 'tiered'
  groupKey: string
  category: AchievementCategory
  displayName: string
  displayDescription: string
  iconName: string
  rarity: AchievementRarity
  tiers: AchievementItem[]
  earnedCount: number
  totalTiers: number
  highestEarnedTier: AchievementItem | null
  nextUnearned: AchievementItem | null
  currentProgress: number | null
  sortOrder: number
}

export interface SingleItem {
  type: 'single'
  achievement: AchievementItem
}

export type DisplayItem = TieredGroup | SingleItem
