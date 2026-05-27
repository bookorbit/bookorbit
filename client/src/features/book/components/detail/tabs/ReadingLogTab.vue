<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BookDetail } from '@bookorbit/types'
import { useBookReadingLog } from '@/features/book/composables/useBookReadingLog'
import ReadingLogStatsStrip from './ReadingLogStatsStrip.vue'
import ReadingLogSparkline from './ReadingLogSparkline.vue'
import ReadingLogTable from './ReadingLogTable.vue'

const props = defineProps<{ book: BookDetail }>()

const bookIdRef = computed(() => props.book.id)
const { sessions, total, stats, loading, error, page, pageSize, sortBy, sortDir, deleteSession, setPage, setSort, setFilters } =
  useBookReadingLog(bookIdRef)

type QuickFilter = 'all' | 'last30' | 'last90' | 'thisYear'
const activeQuick = ref<QuickFilter>('all')
const selectedFormat = ref<string | undefined>(undefined)

const uniqueFormats = computed(() => {
  const formats = props.book.files.map((f) => f.format).filter((f): f is string => f != null && f.length > 0)
  return [...new Set(formats)]
})

const hasMultipleFormats = computed(() => uniqueFormats.value.length >= 2)

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

function handlePageChange(p: number) {
  setPage(p)
}

async function handleDeleteSession(sessionId: number) {
  await deleteSession(sessionId)
}

const quickFilters: { label: string; value: QuickFilter }[] = [
  { label: 'All time', value: 'all' },
  { label: 'Last 30 days', value: 'last30' },
  { label: 'Last 90 days', value: 'last90' },
  { label: 'This year', value: 'thisYear' },
]
</script>

<template>
  <div class="space-y-4">
    <div v-if="error" class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {{ error }}
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <button
        v-for="qf in quickFilters"
        :key="qf.value"
        class="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors sm:px-3 sm:py-1.5 sm:text-sm"
        :class="
          activeQuick === qf.value
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-card text-muted-foreground border-border hover:text-foreground hover:bg-muted'
        "
        @click="() => applyQuickFilter(qf.value)"
      >
        {{ qf.label }}
      </button>

      <select
        v-if="hasMultipleFormats"
        class="ml-auto rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:px-3 sm:py-1.5 sm:text-sm"
        :value="selectedFormat ?? ''"
        @change="handleFormatChange"
      >
        <option value="">All formats</option>
        <option v-for="fmt in uniqueFormats" :key="fmt" :value="fmt">{{ fmt.toUpperCase() }}</option>
      </select>
    </div>

    <ReadingLogSparkline :stats="stats" :loading="loading" />

    <ReadingLogStatsStrip :stats="stats" :loading="loading" :quick-filter="activeQuick" />

    <ReadingLogTable
      :sessions="sessions"
      :total="total"
      :page="page"
      :page-size="pageSize"
      :sort-by="sortBy"
      :sort-dir="sortDir"
      :loading="loading"
      :has-multiple-formats="hasMultipleFormats"
      @sort-change="handleSortChange"
      @page-change="handlePageChange"
      @delete-session="handleDeleteSession"
    />
  </div>
</template>
