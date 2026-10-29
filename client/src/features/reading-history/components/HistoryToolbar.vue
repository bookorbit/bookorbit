<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { BookCheck, LayoutGrid, List, Search, X } from '@lucide/vue'
import type { ReadingAttemptOutcome, ReadingHistorySort } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import type { ReadingHistoryView } from '../composables/useReadingHistoryFilters'

defineProps<{
  outcomes: ReadingAttemptOutcome[]
  counts: Record<ReadingAttemptOutcome, number> | null
  sort: ReadingHistorySort
  view: ReadingHistoryView
  bookTitle: string | null
}>()

const search = defineModel<string>('search', { required: true })

const emit = defineEmits<{
  outcome: [outcome: ReadingAttemptOutcome]
  sort: [sort: ReadingHistorySort]
  view: [view: ReadingHistoryView]
  clearBook: []
}>()

const { t } = useI18n()

const OUTCOMES: { value: ReadingAttemptOutcome; dot: string | null }[] = [
  { value: 'completed', dot: null },
  { value: 'skimmed', dot: 'var(--pill-info)' },
  { value: 'abandoned', dot: 'var(--pill-warning)' },
]
const TOGGLE =
  'inline-flex h-6 items-center gap-1 rounded-xs px-2 text-[11px] 2xl:gap-1.5 2xl:px-2.5 font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function toggleClass(active: boolean) {
  return [TOGGLE, active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground']
}

function handleOutcome(outcome: ReadingAttemptOutcome) {
  emit('outcome', outcome)
}

function handleSort(event: Event) {
  emit('sort', (event.target as HTMLSelectElement).value as ReadingHistorySort)
}

function handleListView() {
  emit('view', 'list')
}

function handleCoversView() {
  emit('view', 'covers')
}

function handleClearBook() {
  emit('clearBook')
}

function handleClearSearch() {
  search.value = ''
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 xl:min-h-[42px] xl:py-1.5">
    <label
      class="flex h-7 min-w-0 basis-full items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 sm:min-w-[7rem] sm:flex-1 sm:basis-0 xl:max-w-[20rem]"
    >
      <Search class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        v-model="search"
        type="search"
        :placeholder="t('readingHistory.toolbar.search')"
        :aria-label="t('readingHistory.toolbar.searchLabel')"
        class="h-full w-full min-w-0 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
      />
      <button
        v-if="search"
        type="button"
        class="grid size-5 shrink-0 place-items-center rounded-xs text-muted-foreground hover:text-foreground"
        :aria-label="t('readingHistory.toolbar.clearSearch')"
        @click="handleClearSearch"
      >
        <X class="size-3" aria-hidden="true" />
      </button>
    </label>

    <div
      class="flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
      role="group"
      :aria-label="t('readingHistory.toolbar.outcomes')"
    >
      <button
        v-for="option in OUTCOMES"
        :key="option.value"
        type="button"
        :class="toggleClass(outcomes.includes(option.value))"
        :aria-pressed="outcomes.includes(option.value)"
        @click="handleOutcome(option.value)"
      >
        <BookCheck v-if="!option.dot" class="size-3" aria-hidden="true" />
        <span v-else class="size-1.5 rounded-full" :style="{ backgroundColor: option.dot }" aria-hidden="true" />
        {{ t(`readingHistory.toolbar.outcome.${option.value}`) }}
        <b v-if="counts" class="font-bold tabular-nums">{{ formatNumber(counts[option.value]) }}</b>
      </button>
    </div>

    <label class="sr-only" for="reading-history-sort">{{ t('readingHistory.toolbar.order') }}</label>
    <select
      id="reading-history-sort"
      :value="sort"
      class="h-7 shrink-0 rounded-md border border-border bg-muted/40 px-2 text-[11.5px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      @change="handleSort"
    >
      <option value="newest">{{ t('readingHistory.toolbar.newest') }}</option>
      <option value="oldest">{{ t('readingHistory.toolbar.oldest') }}</option>
    </select>

    <button
      v-if="bookTitle"
      type="button"
      class="inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2 text-[11.5px] font-semibold text-primary hover:bg-primary/15"
      :aria-label="t('readingHistory.toolbar.clearBook', { title: bookTitle })"
      @click="handleClearBook"
    >
      <span class="truncate">{{ bookTitle }}</span>
      <X class="size-3 shrink-0" aria-hidden="true" />
    </button>

    <div
      class="ms-auto flex h-8 shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
      role="group"
      :aria-label="t('readingHistory.toolbar.view')"
    >
      <button
        type="button"
        :class="toggleClass(view === 'list')"
        :aria-pressed="view === 'list'"
        :title="t('readingHistory.toolbar.listView')"
        @click="handleListView"
      >
        <List class="size-3" aria-hidden="true" /><span class="max-2xl:sr-only">{{ t('readingHistory.toolbar.list') }}</span>
      </button>
      <button
        type="button"
        :class="toggleClass(view === 'covers')"
        :aria-pressed="view === 'covers'"
        :title="t('readingHistory.toolbar.coversView')"
        @click="handleCoversView"
      >
        <LayoutGrid class="size-3" aria-hidden="true" /><span class="max-2xl:sr-only">{{ t('readingHistory.toolbar.covers') }}</span>
      </button>
    </div>
  </div>
</template>
