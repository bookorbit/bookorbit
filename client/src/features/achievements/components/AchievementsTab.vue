<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { useAchievements } from '../composables/useAchievements'
import { groupAchievements } from '../composables/useGroupedAchievements'
import type { FilterState } from '../types'
import AchievementCategorySection from './AchievementCategorySection.vue'
import AchievementFilterBar from './AchievementFilterBar.vue'

const { t } = useI18n()
const { categories, totalEarned, totalAvailable, loading, error, reload } = useAchievements()

const activeFilter = ref<FilterState>('all')

const allDisplayItems = computed(() => categories.value.flatMap((category) => groupAchievements(category.achievements)))

const earnedCount = computed<number>(
  () => allDisplayItems.value.filter((item) => (item.type === 'tiered' ? item.earnedCount > 0 : item.achievement.earned)).length,
)

const inProgressCount = computed<number>(
  () =>
    allDisplayItems.value.filter((item) => {
      if (item.type === 'tiered') {
        return item.earnedCount > 0 && item.earnedCount < item.totalTiers
      }

      return !item.achievement.earned && item.achievement.currentProgress !== null && item.achievement.currentProgress > 0
    }).length,
)

const lockedCount = computed<number>(
  () => allDisplayItems.value.filter((item) => (item.type === 'tiered' ? item.earnedCount === 0 : !item.achievement.earned)).length,
)

function handleFilterChange(filter: FilterState): void {
  activeFilter.value = filter
}
</script>

<template>
  <div class="flex flex-col gap-10">
    <div v-if="loading" class="flex items-center justify-center py-16">
      <Loader2 class="text-muted-foreground size-6 animate-spin" />
    </div>

    <div v-else-if="error" class="flex flex-col items-center gap-3 py-16">
      <p class="text-muted-foreground text-sm">{{ t('achievements.loadFailed') }}</p>
      <button class="text-primary hover:text-primary/80 text-sm font-medium" @click="reload">{{ t('achievements.tryAgain') }}</button>
    </div>

    <template v-else>
      <AchievementFilterBar
        :active-filter="activeFilter"
        :total-earned="totalEarned"
        :total-available="totalAvailable"
        :earned-count="earnedCount"
        :in-progress-count="inProgressCount"
        :locked-count="lockedCount"
        @change="handleFilterChange"
      />

      <AchievementCategorySection v-for="group in categories" :key="group.key" :group="group" :filter="activeFilter" />
    </template>
  </div>
</template>
