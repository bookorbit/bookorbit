<script setup lang="ts">
import { computed, ref } from 'vue'
import type { BookDetail } from '@bookorbit/types'
import { useBookReadingLog } from '@/features/book/composables/useBookReadingLog'
import ReadingLogStatsStrip from './ReadingLogStatsStrip.vue'
import ReadingLogSparkline from './ReadingLogSparkline.vue'
import ReadingLogTable from './ReadingLogTable.vue'

const props = defineProps<{ book: BookDetail }>()

const bookIdRef = computed(() => props.book.id)
const { sessions, total, stats, koboReadingState, loading, error, page, pageSize, sortBy, sortDir, deleteSession, setPage, setSort, setFilters } =
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

function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
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

      <select
        v-if="hasMultipleFormats"
        class="ml-auto px-3 py-1.5 rounded-md text-sm border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        :value="selectedFormat ?? ''"
        @change="handleFormatChange"
      >
        <option value="">All formats</option>
        <option v-for="fmt in uniqueFormats" :key="fmt" :value="fmt">{{ fmt.toUpperCase() }}</option>
      </select>
    </div>

    <ReadingLogSparkline :stats="stats" :loading="loading" />

    <ReadingLogStatsStrip :stats="stats" :loading="loading" :quick-filter="activeQuick" />

    <div v-if="koboReadingState" class="rounded-lg border border-border bg-card p-3 space-y-1.5">
      <div class="flex items-center gap-2">
        <span
          class="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
          style="background-color: #6366f11a; color: #6366f1; border: 1px solid #6366f140"
          >Kobo</span
        >
        <span class="text-sm text-foreground">Kobo reading progress</span>
      </div>
      <div class="flex items-center gap-4 text-xs text-muted-foreground">
        <span v-if="koboReadingState.progressPercent != null">
          Progress: <span class="text-foreground font-medium">{{ koboReadingState.progressPercent.toFixed(1) }}%</span>
        </span>
        <span v-if="koboReadingState.status">
          Status: <span class="text-foreground font-medium">{{ koboReadingState.status }}</span>
        </span>
        <span v-if="koboReadingState.lastModified">
          Last synced: <span class="text-foreground font-medium">{{ formatDateShort(koboReadingState.lastModified) }}</span>
        </span>
      </div>
    </div>
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
