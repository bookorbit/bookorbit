<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, X } from '@lucide/vue'
import type { BookDockSummary } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import type { BookDockView } from '../composables/useBookDockFiles'

const props = defineProps<{
  activeView: BookDockView
  summary: BookDockSummary
}>()

const emit = defineEmits<{
  view: [BookDockView]
  search: [string]
}>()

const { t } = useI18n()

const searchQuery = ref('')
let searchTimer: ReturnType<typeof setTimeout> | null = null

/** Every chip maps to something the files endpoint can answer, so counts cover the whole dock. */
const chips = computed<{ view: BookDockView; testId: string; label: string; count: number }[]>(() => [
  { view: 'all', testId: 'all', label: t('bookDock.layout.filter.all'), count: props.summary.total },
  { view: 'needsReview', testId: 'needsReview', label: t('bookDock.layout.filter.needsReview'), count: props.summary.needsReview },
  { view: 'pending', testId: 'pending', label: t('bookDock.layout.filter.pending'), count: props.summary.pending },
  { view: 'readyToFile', testId: 'ready', label: t('bookDock.layout.filter.ready'), count: props.summary.readyToFile },
  { view: 'error', testId: 'error', label: t('bookDock.layout.filter.error'), count: props.summary.error },
])

function selectView(view: BookDockView) {
  emit('view', view)
}

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => emit('search', searchQuery.value), 300)
}

function clearSearch() {
  searchQuery.value = ''
  if (searchTimer) clearTimeout(searchTimer)
  emit('search', '')
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
      <button
        v-for="chip in chips"
        :key="chip.view"
        type="button"
        :data-testid="`book-dock-chip-${chip.testId}`"
        :aria-pressed="props.activeView === chip.view"
        :disabled="chip.count === 0 && props.activeView !== chip.view"
        class="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:opacity-45"
        :class="
          props.activeView === chip.view ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground enabled:hover:text-foreground'
        "
        @click="selectView(chip.view)"
      >
        {{ chip.label }}
        <span class="font-semibold tabular-nums">{{ formatNumber(chip.count) }}</span>
      </button>
    </div>

    <div class="flex h-8 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5">
      <Search class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        v-model="searchQuery"
        type="search"
        :placeholder="t('bookDock.searchPlaceholder')"
        :aria-label="t('bookDock.searchPlaceholder')"
        class="h-full w-28 bg-transparent text-xs outline-none placeholder:text-muted-foreground sm:w-44"
        @input="onSearchInput"
      />
      <button
        v-if="searchQuery"
        type="button"
        data-testid="book-dock-search-clear"
        :aria-label="t('bookDock.layout.clearSearch')"
        class="shrink-0 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        @click="clearSearch"
      >
        <X class="size-3.5" />
      </button>
    </div>
  </div>
</template>
