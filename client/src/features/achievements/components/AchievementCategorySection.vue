<script setup lang="ts">
import { computed, type Component } from 'vue'
import { BookOpen, Compass, Flame, Library, TabletSmartphone } from 'lucide-vue-next'
import type { AchievementCategory, AchievementCategoryGroup } from '@bookorbit/types'
import { groupAchievements } from '../composables/useGroupedAchievements'
import type { DisplayItem, FilterState } from '../types'
import AchievementCard from './AchievementCard.vue'
import TieredAchievementCard from './TieredAchievementCard.vue'
import AchievementProgressRing from './AchievementProgressRing.vue'

const props = defineProps<{
  group: AchievementCategoryGroup
  filter: FilterState
}>()

const CATEGORY_ICONS: Record<AchievementCategory, Component> = {
  reading: BookOpen,
  library: Library,
  exploration: Compass,
  dedication: Flame,
  devices: TabletSmartphone,
}

const CATEGORY_ACCENT: Record<AchievementCategory, string> = {
  reading: 'bg-sky-500',
  library: 'bg-emerald-500',
  exploration: 'bg-orange-500',
  dedication: 'bg-red-500',
  devices: 'bg-violet-500',
}

const CATEGORY_ICON_COLOR: Record<AchievementCategory, string> = {
  reading: 'text-sky-400',
  library: 'text-emerald-400',
  exploration: 'text-orange-400',
  dedication: 'text-red-400',
  devices: 'text-violet-400',
}

const CategoryIcon = computed<Component>(() => CATEGORY_ICONS[props.group.key])

const categoryAccentClass = computed<string>(() => CATEGORY_ACCENT[props.group.key])
const categoryIconClass = computed<string>(() => CATEGORY_ICON_COLOR[props.group.key])
const categoryProgressPercent = computed<number>(() => {
  if (props.group.totalCount === 0) {
    return 0
  }

  return Math.round((props.group.earnedCount / props.group.totalCount) * 100)
})

const allItems = computed<DisplayItem[]>(() => groupAchievements(props.group.achievements))

const filteredItems = computed<DisplayItem[]>(() => {
  if (props.filter === 'all') {
    return allItems.value
  }

  return allItems.value.filter((item) => {
    if (item.type === 'tiered') {
      switch (props.filter) {
        case 'earned':
          return item.earnedCount > 0
        case 'locked':
          return item.earnedCount === 0
        case 'in-progress':
          return item.earnedCount > 0 && item.earnedCount < item.totalTiers
        default:
          return true
      }
    }

    switch (props.filter) {
      case 'earned':
        return item.achievement.earned
      case 'locked':
        return !item.achievement.earned
      case 'in-progress':
        return !item.achievement.earned && item.achievement.currentProgress !== null && item.achievement.currentProgress > 0
      default:
        return true
    }
  })
})
</script>

<template>
  <section class="mb-2 flex flex-col gap-4">
    <div class="flex items-center gap-3">
      <div :class="['w-1 self-stretch rounded-full', categoryAccentClass]" />
      <component :is="CategoryIcon" :class="['size-5 shrink-0', categoryIconClass]" />
      <h3 class="text-foreground text-sm font-semibold">{{ group.label }}</h3>
      <div class="ml-auto flex items-center gap-2">
        <AchievementProgressRing :percent="categoryProgressPercent" :color="categoryIconClass" :size="28" />
        <span class="text-muted-foreground text-xs tabular-nums">{{ group.earnedCount }} / {{ group.totalCount }}</span>
      </div>
    </div>

    <p v-if="filteredItems.length === 0" class="text-muted-foreground py-4 text-center text-sm">No achievements match this filter</p>

    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-6">
      <template v-for="item in filteredItems" :key="item.type === 'tiered' ? item.groupKey : item.achievement.key">
        <TieredAchievementCard v-if="item.type === 'tiered'" :group="item" />
        <AchievementCard v-else :achievement="item.achievement" />
      </template>
    </div>
  </section>
</template>
