<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BookDetail, UserBookStatus } from '@bookorbit/types'
import { useBookReadingLog, type AddReadingSessionPayload } from '@/features/book/composables/useBookReadingLog'
import ReadingLogHero from './ReadingLogHero.vue'
import ReadingLogSourceSplit from './ReadingLogSourceSplit.vue'
import ReadingLogJourneyChart from './ReadingLogJourneyChart.vue'
import ReadingLogHeatmap from './ReadingLogHeatmap.vue'
import ReadingLogTable from './ReadingLogTable.vue'
import ReadingLogExportMenu from './ReadingLogExportMenu.vue'
import AddSessionDialog from './AddSessionDialog.vue'

const props = defineProps<{ book: BookDetail }>()

const emit = defineEmits<{
  saved: [book: BookDetail]
}>()

const bookIdRef = computed(() => props.book.id)
const {
  sessions,
  total,
  stats,
  loading,
  loadingMore,
  error,
  sortBy,
  sortDir,
  hasMore,
  deleteSession,
  addSession,
  exportAll,
  loadMore,
  setSort,
  setFilters,
} = useBookReadingLog(bookIdRef)

type QuickFilter = 'all' | 'last30' | 'last90' | 'thisYear'
const activeQuick = ref<QuickFilter>('all')
const selectedFormat = ref<string | undefined>(undefined)

const uniqueFormats = computed(() => {
  const formats = props.book.files.map((f) => f.format).filter((f): f is string => f != null && f.length > 0)
  return [...new Set(formats)]
})

const hasMultipleFormats = computed(() => uniqueFormats.value.length >= 2)

const bookTitle = computed(() => props.book.title ?? 'Untitled')

function buildDateFrom(q: QuickFilter): string | undefined {
  const now = new Date()
  if (q === 'last30') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  if (q === 'last90') return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
  if (q === 'thisYear') return new Date(now.getFullYear(), 0, 1).toISOString()
  return undefined
}

function applyQuickFilter(q: QuickFilter) {
  activeQuick.value = q
  setFilters({ dateFrom: buildDateFrom(q), dateTo: undefined, format: selectedFormat.value })
}

function handleFormatChange(e: Event) {
  const fmt = (e.target as HTMLSelectElement).value || undefined
  selectedFormat.value = fmt
  setFilters({ dateFrom: buildDateFrom(activeQuick.value), dateTo: undefined, format: fmt })
}

function handleSortChange(by: string, dir: 'asc' | 'desc') {
  setSort(by as 'startedAt' | 'durationSeconds' | 'progressDelta' | 'endProgress', dir)
}

function handleLoadMore() {
  void loadMore()
}

async function handleDeleteSession(sessionId: number) {
  await deleteSession(sessionId)
}

function handleHeroSaved(readStatus: UserBookStatus) {
  emit('saved', { ...props.book, readStatus })
}

const addDialogOpen = ref(false)
const addSaving = ref(false)
const addError = ref<string | null>(null)

function handleOpenAddSession() {
  addError.value = null
  addDialogOpen.value = true
}

function handleCloseAddSession() {
  if (addSaving.value) return
  addDialogOpen.value = false
}

async function handleAddSessionSubmit(payload: AddReadingSessionPayload) {
  addSaving.value = true
  addError.value = null
  try {
    await addSession(payload)
    addDialogOpen.value = false
  } catch (e) {
    addError.value = e instanceof Error ? e.message : 'Failed to add session'
  } finally {
    addSaving.value = false
  }
}

const quickFilters: { label: string; value: QuickFilter }[] = [
  { label: 'All time', value: 'all' },
  { label: 'Last 30 days', value: 'last30' },
  { label: 'Last 90 days', value: 'last90' },
  { label: 'This year', value: 'thisYear' },
]
</script>

<template>
  <div class="space-y-5">
    <div v-if="error" class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {{ error }}
    </div>

    <ReadingLogHero :book="book" :stats="stats" :loading="loading" @saved="handleHeroSaved" @add-session="handleOpenAddSession" />

    <ReadingLogSourceSplit :stats="stats" />

    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="qf in quickFilters"
        :key="qf.value"
        class="px-3 py-1.5 rounded-md text-sm font-medium border transition-colors"
        :class="
          activeQuick === qf.value
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted'
        "
        @click="() => applyQuickFilter(qf.value)"
      >
        {{ qf.label }}
      </button>

      <div class="ml-auto flex items-center gap-2">
        <select
          v-if="hasMultipleFormats"
          class="px-3 py-1.5 rounded-md text-sm border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          :value="selectedFormat ?? ''"
          @change="handleFormatChange"
        >
          <option value="">All formats</option>
          <option v-for="fmt in uniqueFormats" :key="fmt" :value="fmt">{{ fmt.toUpperCase() }}</option>
        </select>

        <ReadingLogExportMenu :book-title="bookTitle" :total="total" :export-all="exportAll" />
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:items-start">
      <div class="lg:col-span-3">
        <ReadingLogJourneyChart :stats="stats" :loading="loading" />
      </div>
      <div class="lg:col-span-2">
        <ReadingLogHeatmap :stats="stats" :loading="loading" :quick-filter="activeQuick" />
      </div>
    </div>

    <ReadingLogTable
      :sessions="sessions"
      :total="total"
      :sort-by="sortBy"
      :sort-dir="sortDir"
      :loading="loading"
      :loading-more="loadingMore"
      :has-more="hasMore"
      :has-multiple-formats="hasMultipleFormats"
      @sort-change="handleSortChange"
      @load-more="handleLoadMore"
      @delete-session="handleDeleteSession"
    />

    <AddSessionDialog
      :open="addDialogOpen"
      :formats="uniqueFormats"
      :saving="addSaving"
      :error="addError"
      @close="handleCloseAddSession"
      @submit="handleAddSessionSubmit"
    />
  </div>
</template>
