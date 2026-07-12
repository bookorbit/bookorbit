<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate } from '@/i18n/formatters'
import { Check, Lock } from '@lucide/vue'
import type { AchievementItem, AchievementRarity } from '@bookorbit/types'
import { resolveLucideIcon } from '../utils/resolveLucideIcon'

const props = defineProps<{
  achievement: AchievementItem
}>()

const { t } = useI18n()

const isExpanded = ref(false)

const isHiddenAndLocked = computed<boolean>(() => props.achievement.hidden && !props.achievement.earned)

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

const cardClasses = computed<string>(() => {
  if (isHiddenAndLocked.value) {
    return 'border border-border cursor-default bg-card opacity-50'
  }

  if (props.achievement.earned) {
    return `border-2 cursor-pointer shadow-sm ${earnedRarityClasses[props.achievement.rarity]}`
  }

  return `border border-dashed cursor-pointer grayscale text-muted-foreground/75 dark:text-muted-foreground/65 bg-card/60 dark:bg-card/45 ${lockedRarityClasses[props.achievement.rarity]}`
})

const isLocked = computed<boolean>(() => !props.achievement.earned && !isHiddenAndLocked.value)

function rarityClass(rarity: AchievementRarity): string {
  if (isLocked.value) {
    return 'border border-border bg-muted/60 text-current'
  }

  return rarityPillClass[rarity]
}

const IconComponent = computed(() => {
  if (isHiddenAndLocked.value) {
    return Lock
  }

  return resolveLucideIcon(props.achievement.iconName)
})

const iconColorClass = computed<string>(() => {
  if (isLocked.value) {
    return 'text-current'
  }

  if (props.achievement.earned) {
    return iconColorClasses[props.achievement.rarity]
  }

  return 'text-muted-foreground'
})

const progressPercent = computed<number | null>(() => {
  if (props.achievement.earned || !props.achievement.threshold || props.achievement.currentProgress == null) {
    return null
  }

  return Math.min(100, Math.round((props.achievement.currentProgress / props.achievement.threshold) * 100))
})

const earnedDate = computed<string | null>(() => formatAchievementDate(props.achievement.awardedAt))

const contextBookTitle = computed<string | null>(() => {
  if (!props.achievement.context) {
    return null
  }

  const title = props.achievement.context.bookTitle
  return typeof title === 'string' ? title : null
})

function formatAchievementDate(dateStr: string | null): string | null {
  if (!dateStr) {
    return null
  }

  return t('achievements.earnedOn', {
    date: formatDate(new Date(dateStr), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
  })
}

function handleClick(): void {
  if (!isHiddenAndLocked.value) {
    isExpanded.value = !isExpanded.value
  }
}
</script>

<template>
  <div :class="['relative rounded-xl border p-3 transition-all', cardClasses, { 'animate-pulse': isHiddenAndLocked }]" @click="handleClick">
    <div v-if="achievement.earned" class="absolute top-2 right-2 rounded-full bg-green-500/20 p-0.5">
      <Check class="size-3 text-green-400" />
    </div>

    <div class="flex items-start gap-3">
      <div class="mt-0.5 shrink-0">
        <component :is="IconComponent" :class="['size-9', iconColorClass]" />
      </div>
      <div :class="['min-w-0 flex-1', achievement.earned ? 'pr-6' : '']">
        <div class="flex items-start justify-between gap-2">
          <span :class="['text-sm font-semibold leading-tight', isLocked ? 'text-current' : 'text-foreground']">
            {{ isHiddenAndLocked ? t('achievements.secretAchievement') : achievement.name }}
          </span>
          <span v-if="!isHiddenAndLocked" :class="['shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', rarityClass(achievement.rarity)]">
            {{ rarityLabel[achievement.rarity] }}
          </span>
          <span v-else class="text-muted-foreground shrink-0 text-xs">???</span>
        </div>
        <p v-if="!isHiddenAndLocked" :class="['mt-1 min-h-8 line-clamp-2 text-xs leading-4', isLocked ? 'text-current' : 'text-muted-foreground']">
          {{ achievement.description }}
        </p>
      </div>
    </div>

    <template v-if="!isHiddenAndLocked">
      <div v-if="progressPercent != null" class="mt-5 flex items-center gap-2">
        <div class="bg-foreground/10 h-1.5 flex-1 overflow-hidden rounded-full">
          <div class="h-full rounded-full bg-current transition-all" :style="{ width: `${progressPercent}%` }" />
        </div>
        <span :class="['text-xs tabular-nums', isLocked ? 'text-current' : 'text-muted-foreground']">
          {{ achievement.currentProgress }} / {{ achievement.threshold }}
        </span>
      </div>

      <p v-if="earnedDate" class="text-muted-foreground mt-5 text-xs">{{ earnedDate }}</p>

      <div v-if="isExpanded && achievement.earned" class="border-border mt-3 border-t pt-3">
        <p v-if="contextBookTitle" class="text-muted-foreground text-xs">{{ t('achievements.whileReading', { title: contextBookTitle }) }}</p>
        <p class="text-muted-foreground mt-1 text-xs">{{ achievement.description }}</p>
      </div>
    </template>
  </div>
</template>
