import type { AchievementItem } from '@bookorbit/types'
import type { DisplayItem, SingleItem, TieredGroup } from '../types'

export function groupAchievements(achievements: AchievementItem[]): DisplayItem[] {
  const groups = new Map<string, AchievementItem[]>()
  const singles: AchievementItem[] = []

  for (const item of achievements) {
    if (item.groupKey != null && item.tier != null) {
      const existing = groups.get(item.groupKey) ?? []
      existing.push(item)
      groups.set(item.groupKey, existing)
    } else {
      singles.push(item)
    }
  }

  const result: DisplayItem[] = []

  for (const [groupKey, tiers] of groups) {
    tiers.sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0))

    const firstTier = tiers[0]
    if (!firstTier) {
      continue
    }

    const earnedTiers = tiers.filter((tier) => tier.earned)
    const highestEarnedTier = earnedTiers[earnedTiers.length - 1] ?? null
    const nextUnearned = tiers.find((tier) => !tier.earned) ?? null

    const displayName = highestEarnedTier?.name ?? firstTier.name
    const displayDescription = nextUnearned?.description ?? 'All tiers complete!'
    const rarity = highestEarnedTier?.rarity ?? firstTier.rarity
    const iconName = highestEarnedTier?.iconName ?? firstTier.iconName

    const group: TieredGroup = {
      type: 'tiered',
      groupKey,
      category: firstTier.category,
      displayName,
      displayDescription,
      iconName,
      rarity,
      tiers,
      earnedCount: earnedTiers.length,
      totalTiers: tiers.length,
      highestEarnedTier,
      nextUnearned,
      currentProgress: nextUnearned?.currentProgress ?? null,
      sortOrder: firstTier.sortOrder,
    }

    result.push(group)
  }

  for (const achievement of singles) {
    const single: SingleItem = { type: 'single', achievement }
    result.push(single)
  }

  result.sort((a, b) => {
    const aOrder = a.type === 'tiered' ? a.sortOrder : a.achievement.sortOrder
    const bOrder = b.type === 'tiered' ? b.sortOrder : b.achievement.sortOrder
    return aOrder - bOrder
  })

  return result
}
