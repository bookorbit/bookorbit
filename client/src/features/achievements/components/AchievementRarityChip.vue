<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AchievementRarity } from '@bookorbit/types'

defineProps<{
  rarity: AchievementRarity
}>()

const { t } = useI18n()

// Full class strings so Tailwind sees every one at build time.
const CHIP_CLASS: Record<AchievementRarity, string> = {
  common: 'border-rarity-common-fill/45 bg-rarity-common-fill/12 text-rarity-common',
  rare: 'border-rarity-rare-fill/45 bg-rarity-rare-fill/12 text-rarity-rare',
  epic: 'border-rarity-epic-fill/45 bg-rarity-epic-fill/12 text-rarity-epic',
  legendary: 'border-rarity-legendary-fill/50 bg-rarity-legendary-fill/14 text-rarity-legendary',
}
</script>

<template>
  <span
    class="inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-semibold whitespace-nowrap"
    :class="CHIP_CLASS[rarity]"
  >
    {{ t(`achievements.rarity.${rarity}`) }}
  </span>
</template>
