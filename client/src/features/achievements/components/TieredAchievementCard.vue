<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate } from '@/i18n/formatters'
import { Check, CheckCircle2, Circle } from '@lucide/vue'
import type { AchievementRarity } from '@bookorbit/types'
import type { TieredGroup } from '../types'
import { resolveLucideIcon } from '../utils/resolveLucideIcon'

const props = defineProps<{
  group: TieredGroup
}>()

const { t } = useI18n()

const isExpanded = ref(false)

const rarityLabel = computed<Record<AchievementRarity, string>>(() => ({
  common: t('achievements.rarity.common'),
  rare: t('achievements.rarity.rare'),
  epic: t('achievements.rarity.epic'),
  legendary: t('achievements.rarity.legendary'),
}))

const rarityPillClass: Record<AchievementRarity, string> = {
  common: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  rare: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  epic: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  legendary: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300',
}

const lockedRarityClasses: Record<AchievementRarity, string> = {
  common: 'border-border',
  rare: 'border-border',
  epic: 'border-border',
  legendary: 'border-border',
}

const earnedRarityClasses: Record<AchievementRarity, string> = {
  common: 'border-blue-500/60 bg-card',
  rare: 'border-amber-700/60 bg-card',
  epic: 'border-slate-400/60 bg-card',
  legendary: 'border-yellow-500/60 bg-card shadow-[0_0_16px_rgba(234,179,8,0.3)]',
}

const iconColorClasses: Record<AchievementRarity, string> = {
  common: 'text-blue-600 dark:text-blue-400',
  rare: 'text-amber-600',
  epic: 'text-slate-700 dark:text-slate-300',
  legendary: 'text-yellow-600 dark:text-yellow-400',
}

const RARITY_PIP_FILLED: Record<AchievementRarity, string> = {
  common: 'bg-blue-500',
  rare: 'bg-amber-700',
  epic: 'bg-slate-400',
  legendary: 'bg-yellow-500',
}

const RARITY_PIP_EMPTY: Record<AchievementRarity, string> = {
  common: 'border border-blue-400/40',
  rare: 'border border-amber-700/40',
  epic: 'border border-slate-400/40',
  legendary: 'border border-yellow-400/40',
}

const cardClasses = computed<string>(() => {
  if (props.group.earnedCount > 0) {
    return `border-2 cursor-pointer shadow-sm ${earnedRarityClasses[props.group.rarity]}`
  }

  return `border border-dashed cursor-pointer grayscale text-muted-foreground/75 dark:text-muted-foreground/65 bg-card/60 dark:bg-card/45 ${lockedRarityClasses[props.group.rarity]}`
})

const isLocked = computed<boolean>(() => props.group.earnedCount === 0)

function rarityClass(rarity: AchievementRarity): string {
  if (isLocked.value) {
    return 'border border-border bg-muted/60 text-current'
  }

  return rarityPillClass[rarity]
}

const isAllComplete = computed<boolean>(() => props.group.earnedCount === props.group.totalTiers)

const IconComponent = computed(() => resolveLucideIcon(props.group.iconName))

const iconColorClass = computed<string>(() => {
  if (isLocked.value) {
    return 'text-current'
  }

  if (!props.group.highestEarnedTier) {
    return 'text-muted-foreground'
  }

  return iconColorClasses[props.group.highestEarnedTier.rarity]
})

const progressPercent = computed<number | null>(() => {
  const next = props.group.nextUnearned
  if (!next || !next.threshold || props.group.currentProgress == null) {
    return null
  }

  return Math.min(100, Math.round((props.group.currentProgress / next.threshold) * 100))
})

function pipClass(tierRarity: AchievementRarity, earned: boolean): string {
  return earned ? RARITY_PIP_FILLED[tierRarity] : RARITY_PIP_EMPTY[tierRarity]
}

function formatTierDate(dateStr: string): string {
  return formatDate(new Date(dateStr), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function handleClick(): void {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div :class="['relative rounded-xl border p-3 transition-all', cardClasses]" @click="handleClick">
    <div v-if="isAllComplete" class="absolute top-2 right-2 rounded-full bg-green-500/20 p-0.5">
      <Check class="size-3 text-green-400" />
    </div>

    <div class="flex items-start gap-3">
      <div class="mt-0.5 shrink-0">
        <component :is="IconComponent" :class="['size-9', iconColorClass]" />
      </div>
      <div :class="['min-w-0 flex-1', isAllComplete ? 'pr-6' : '']">
        <div class="flex items-start justify-between gap-2">
          <span :class="['text-sm font-semibold leading-tight', isLocked ? 'text-current' : 'text-foreground']">{{ group.displayName }}</span>
          <span :class="['shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', rarityClass(group.rarity)]">
            {{ rarityLabel[group.rarity] }}
          </span>
        </div>
        <p :class="['mt-1 min-h-8 line-clamp-2 text-xs leading-4', isLocked ? 'text-current' : 'text-muted-foreground']">
          {{ group.displayDescription }}
        </p>
      </div>
    </div>

    <div :class="['mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs', isLocked ? 'text-current' : 'text-muted-foreground']">
      <div class="flex shrink-0 items-center gap-1">
        <div v-for="tier in group.tiers" :key="tier.key" :class="['size-2 rounded-full', pipClass(tier.rarity, tier.earned)]" />
      </div>
      <span class="shrink-0">{{ t('achievements.tierProgress', { earned: group.earnedCount, total: group.totalTiers }) }}</span>
      <template v-if="progressPercent != null">
        <span :class="['shrink-0', isLocked ? 'text-current/70' : 'text-muted-foreground/50']">·</span>
        <span class="min-w-0">{{
          t('achievements.progressToNext', {
            current: group.currentProgress,
            threshold: group.nextUnearned?.threshold,
            name: group.nextUnearned?.name,
          })
        }}</span>
      </template>
    </div>

    <div v-if="isExpanded" class="border-border mt-3 border-t pt-3">
      <ul class="flex flex-col gap-1.5">
        <li v-for="tier in group.tiers" :key="tier.key" class="flex items-center gap-2 text-xs">
          <CheckCircle2 v-if="tier.earned" class="size-3.5 shrink-0 text-green-500" />
          <Circle v-else :class="['size-3.5 shrink-0', isLocked ? 'text-current' : 'text-muted-foreground']" />
          <span :class="tier.earned ? 'font-medium' : isLocked ? 'text-current' : 'text-muted-foreground'">
            {{ tier.name }}
            <span v-if="tier.threshold" :class="['font-normal', isLocked ? 'text-current/85' : 'text-muted-foreground']">({{ tier.threshold }})</span>
          </span>
          <span v-if="tier.earned && tier.awardedAt" :class="['ml-auto text-xs', isLocked ? 'text-current/85' : 'text-muted-foreground']">
            {{ formatTierDate(tier.awardedAt) }}
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
