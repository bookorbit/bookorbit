import type { AchievementRarity } from '@bookorbit/types'

// Full class strings so Tailwind sees every one at build time.
export const RARITY_TEXT_CLASS: Record<AchievementRarity, string> = {
  common: 'text-rarity-common',
  rare: 'text-rarity-rare',
  epic: 'text-rarity-epic',
  legendary: 'text-rarity-legendary',
}

export const RARITY_FILL_CLASS: Record<AchievementRarity, string> = {
  common: 'bg-rarity-common-fill',
  rare: 'bg-rarity-rare-fill',
  epic: 'bg-rarity-epic-fill',
  legendary: 'bg-rarity-legendary-fill',
}
