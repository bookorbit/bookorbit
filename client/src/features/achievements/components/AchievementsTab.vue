<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { useAchievements } from '../composables/useAchievements'
import { useAchievementHints } from '../composables/useAchievementHints'
import { groupAchievements } from '../composables/useGroupedAchievements'
import type { FilterState } from '../types'
import { displayId, filterCounts, matchesFilter } from '../lib/achievement-display'
import { recordBook } from '../lib/achievement-moments'
import { hintKeyOf } from '../lib/achievement-hints'
import AchievementDetailSheet from './AchievementDetailSheet.vue'
import AchievementFilterBar from './AchievementFilterBar.vue'
import AchievementRecordBook from './AchievementRecordBook.vue'
import AchievementShelf from './AchievementShelf.vue'
import AchievementShowcase from './AchievementShowcase.vue'

const { t } = useI18n()
const { categories, totalEarned, totalAvailable, loading, error, reload } = useAchievements()
const { hints, reload: reloadHints } = useAchievementHints()

const activeFilter = ref<FilterState>('all')
const openId = ref<string | null>(null)

const allItems = computed(() => categories.value.flatMap((category) => category.achievements))
const shelves = computed(() => categories.value.map((category) => ({ category, items: groupAchievements(category.achievements) })))
const allDisplay = computed(() => shelves.value.flatMap((shelf) => shelf.items))
const counts = computed(() => filterCounts(allDisplay.value))
const visibleShelves = computed(() =>
  shelves.value
    .map((shelf) => ({ ...shelf, items: shelf.items.filter((item) => matchesFilter(item, activeFilter.value)) }))
    .filter((shelf) => shelf.items.length > 0),
)
const records = computed(() => (activeFilter.value === 'all' ? recordBook(allItems.value) : []))

// A last shelf of only a few medals sits beside the record book instead of leaving a mostly empty row.
const pairedShelf = computed(() => {
  const last = visibleShelves.value.at(-1)
  return records.value.length > 0 && last && last.items.length <= 4 ? last : null
})
const leadShelves = computed(() => (pairedShelf.value ? visibleShelves.value.slice(0, -1) : visibleShelves.value))

const openItem = computed(() => allDisplay.value.find((item) => displayId(item) === openId.value) ?? null)
const openHint = computed(() => {
  const key = openItem.value ? hintKeyOf(openItem.value) : null
  return key ? (hints.value.get(key) ?? null) : null
})
const openCategoryLabel = computed(() => {
  const item = openItem.value
  if (!item) return ''
  const key = item.type === 'tiered' ? item.category : item.achievement.category
  return categories.value.find((category) => category.key === key)?.label ?? ''
})

function handleRetry(): void {
  void reload()
  void reloadHints()
}

function handleFilterChange(filter: FilterState): void {
  activeFilter.value = filter
}

function handleShowInProgress(): void {
  activeFilter.value = 'in-progress'
}

function handleOpen(id: string): void {
  openId.value = id
}

function handleClose(): void {
  openId.value = null
}
</script>

<template>
  <div class="flex flex-col gap-3.5 pb-7">
    <AchievementFilterBar
      class="mb-1.5"
      :active-filter="activeFilter"
      :total-earned="totalEarned"
      :total-available="totalAvailable"
      :counts="counts"
      @change="handleFilterChange"
    />

    <div v-if="loading" class="flex items-center justify-center py-16" role="status" :aria-label="t('achievements.loading')">
      <Loader2 class="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
    </div>

    <div v-else-if="error" class="flex flex-col items-center gap-3 py-16" role="alert">
      <p class="text-sm text-muted-foreground">{{ t('achievements.loadFailed') }}</p>
      <button type="button" class="text-sm font-medium text-primary hover:text-primary" @click="handleRetry">{{ t('achievements.tryAgain') }}</button>
    </div>

    <template v-else>
      <AchievementShowcase
        v-if="activeFilter === 'all'"
        :categories="categories"
        :items="allItems"
        :display-items="allDisplay"
        :total-earned="totalEarned"
        :total-available="totalAvailable"
        :in-progress-count="counts['in-progress']"
        :hints="hints"
        @open="handleOpen"
        @show-in-progress="handleShowInProgress"
      />

      <AchievementShelf v-for="shelf in leadShelves" :key="shelf.category.key" :category="shelf.category" :items="shelf.items" @open="handleOpen" />

      <div v-if="pairedShelf" class="grid gap-3.5 min-[1600px]:grid-cols-[minmax(0,3fr)_minmax(0,5fr)]">
        <AchievementShelf :category="pairedShelf.category" :items="pairedShelf.items" compact @open="handleOpen" />
        <AchievementRecordBook :records="records" @open="handleOpen" />
      </div>
      <AchievementRecordBook v-else-if="records.length" :records="records" @open="handleOpen" />

      <p v-if="visibleShelves.length === 0" class="py-10 text-center text-sm text-muted-foreground">{{ t('achievements.noMatchFilter') }}</p>
    </template>

    <AchievementDetailSheet :item="openItem" :category-label="openCategoryLabel" :hint="openHint" @close="handleClose" />
  </div>
</template>
