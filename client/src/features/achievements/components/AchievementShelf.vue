<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, Compass, Flame, Library, TabletSmartphone, Trophy } from '@lucide/vue'
import type { AchievementCategoryGroup } from '@bookorbit/types'
import { formatPercent } from '@/i18n/formatters'
import type { DisplayItem } from '../types'
import { displayId } from '../lib/achievement-display'
import AchievementMedalTile from './AchievementMedalTile.vue'

const props = defineProps<{
  category: AchievementCategoryGroup
  items: DisplayItem[]
  /** A shelf beside the record book holds only a few medals; on wide screens three columns keep them on one row. */
  compact?: boolean
}>()

const emit = defineEmits<{
  open: [id: string]
}>()

const { t } = useI18n()

// A category the server adds before this build knows it still gets a shelf, with a trophy.
const CATEGORY_ICONS: Record<string, Component> = {
  reading: BookOpen,
  library: Library,
  exploration: Compass,
  dedication: Flame,
  devices: TabletSmartphone,
}

const icon = computed(() => CATEGORY_ICONS[props.category.key] ?? Trophy)
const share = computed(() => (props.category.totalCount ? props.category.earnedCount / props.category.totalCount : 0))

function handleOpen(id: string) {
  emit('open', id)
}
</script>

<template>
  <section
    :id="`achievements-${category.key}`"
    class="min-w-0 rounded-2xl border border-primary/40 bg-card/30 shadow-sm [contain-intrinsic-size:auto_420px] [content-visibility:auto]"
    :aria-labelledby="`achievements-${category.key}-title`"
  >
    <div class="flex items-center justify-between gap-3 px-5 pt-3.5 pb-0.5 max-md:px-3.5 max-md:pt-3">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-muted/50 text-foreground" aria-hidden="true">
          <component :is="icon" :size="15" />
        </span>
        <h2 :id="`achievements-${category.key}-title`" class="truncate text-[15px] leading-5 font-bold tracking-[-0.015em] text-foreground">
          {{ category.label }}
        </h2>
        <span class="shrink-0 rounded-full border border-border bg-muted px-2 py-px text-[11px] leading-4 font-bold text-foreground tabular-nums">
          {{ t('achievements.shelf.tiers', { earned: category.earnedCount, total: category.totalCount }) }}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-2.5">
        <span class="text-xs text-muted-foreground tabular-nums">{{ formatPercent(share) }}</span>
        <div
          class="h-[5px] w-[140px] overflow-hidden rounded-full bg-foreground/10 max-md:w-16"
          role="progressbar"
          :aria-valuenow="Math.round(share * 100)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="t('achievements.shelf.progressLabel', { category: category.label })"
        >
          <div class="h-full rounded-full bg-primary" :style="{ width: `${share * 100}%` }" />
        </div>
      </div>
    </div>
    <div
      class="grid px-3.5 pt-1 pb-3 max-md:grid-cols-3 max-md:px-1.5 max-md:pb-2"
      :class="
        compact ? 'grid-cols-[repeat(auto-fill,minmax(184px,1fr))] min-[1600px]:grid-cols-3' : 'grid-cols-[repeat(auto-fill,minmax(184px,1fr))]'
      "
    >
      <AchievementMedalTile v-for="item in items" :key="displayId(item)" :item="item" @open="handleOpen" />
    </div>
  </section>
</template>
