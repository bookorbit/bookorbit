<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, ChevronsUpDown, Loader2, Trash2, X } from '@lucide/vue'
import type { BookReadingSession, ReadingSessionSource } from '@bookorbit/types'

const props = defineProps<{
  sessions: BookReadingSession[]
  total: number
  sortBy: string
  sortDir: 'asc' | 'desc'
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  hasMultipleFormats: boolean
}>()

const emit = defineEmits<{
  sortChange: [sortBy: string, sortDir: 'asc' | 'desc']
  loadMore: []
  deleteSession: [sessionId: number]
}>()

const confirmDeleteId = ref<number | null>(null)

watch(
  () => props.sessions,
  () => {
    confirmDeleteId.value = null
  },
)

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDayDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(seconds % 60)}s`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateCompact(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatProgressDelta(progressDelta: number | null): string {
  if (progressDelta == null) return '-'
  const prefix = progressDelta > 0 ? '+' : ''
  return `${prefix}${progressDelta.toFixed(1)}%`
}

function formatPace(session: BookReadingSession): string {
  if (session.progressDelta == null || session.progressDelta <= 0 || session.durationSeconds === 0) return '-'
  return `${((session.progressDelta / session.durationSeconds) * 3600).toFixed(1)}%/hr`
}

const PILL_BASE = 'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium'

const SESSION_SOURCE_PILLS: Record<ReadingSessionSource, { label: string; class: string }> = {
  web: { label: 'Web', class: 'border-[var(--pill-web)]/40 bg-[var(--pill-web)]/10 text-[var(--pill-web)]' },
  koreader: { label: 'KOReader', class: 'border-[var(--pill-koreader)]/40 bg-[var(--pill-koreader)]/10 text-[var(--pill-koreader)]' },
  kobo: { label: 'Kobo', class: 'border-[var(--pill-kobo)]/40 bg-[var(--pill-kobo)]/10 text-[var(--pill-kobo)]' },
  manual: { label: 'Manual', class: 'border-border bg-muted text-muted-foreground' },
}

const showSource = computed(() => props.sessions.some((s) => s.source != null))

function handleDeleteClick(sessionId: number) {
  if (confirmDeleteId.value === sessionId) {
    emit('deleteSession', sessionId)
    confirmDeleteId.value = null
  } else {
    confirmDeleteId.value = sessionId
  }
}

function clearConfirmDelete() {
  confirmDeleteId.value = null
}

function handleLoadMore() {
  confirmDeleteId.value = null
  emit('loadMore')
}

function handleSort(col: string) {
  confirmDeleteId.value = null
  const dir = props.sortBy === col && props.sortDir === 'asc' ? 'desc' : 'asc'
  emit('sortChange', col, dir)
}

const SORTABLE_COLS = [
  { id: 'startedAt', label: 'Date', mobileLabel: 'Date' },
  { id: 'durationSeconds', label: 'Duration', mobileLabel: 'Duration' },
  { id: 'progressDelta', label: 'Progress Change', mobileLabel: 'Delta' },
  { id: 'endProgress', label: 'End Progress', mobileLabel: 'End' },
] as const

const columnCount = computed(() => {
  let count = SORTABLE_COLS.length + 2
  if (showSource.value) count += 1
  if (props.hasMultipleFormats) count += 1
  return count
})

function localDayKey(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number)
  const d = new Date(year!, month! - 1, day!)
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

type TableRow =
  | { kind: 'header'; key: string; label: string; totalSeconds: number; netDelta: number | null }
  | { kind: 'session'; key: string; session: BookReadingSession }

const grouped = computed(() => props.sortBy === 'startedAt')

const rows = computed<TableRow[]>(() => {
  if (!grouped.value) {
    return props.sessions.map((session) => ({ kind: 'session' as const, key: `s-${session.id}`, session }))
  }

  const out: TableRow[] = []
  let currentKey: string | null = null
  let headerIndex = -1
  for (const session of props.sessions) {
    const dayKey = localDayKey(session.startedAt)
    if (dayKey !== currentKey) {
      currentKey = dayKey
      out.push({ kind: 'header', key: `h-${dayKey}`, label: formatDayLabel(dayKey), totalSeconds: 0, netDelta: null })
      headerIndex = out.length - 1
    }
    const header = out[headerIndex] as Extract<TableRow, { kind: 'header' }>
    header.totalSeconds += session.durationSeconds
    if (session.progressDelta != null) {
      header.netDelta = (header.netDelta ?? 0) + session.progressDelta
    }
    out.push({ kind: 'session', key: `s-${session.id}`, session })
  }
  return out
})
</script>

<template>
  <div @click.self="clearConfirmDelete">
    <div v-if="sessions.length === 0 && !loading" class="flex items-center justify-center py-16 text-muted-foreground text-sm">
      No reading sessions recorded yet.
    </div>

    <div v-else class="overflow-x-auto rounded-lg border border-border transition-opacity" :class="{ 'opacity-50 pointer-events-none': loading }">
      <table class="w-full min-w-max text-xs sm:text-sm">
        <thead>
          <tr class="border-b border-border bg-muted/50">
            <th
              v-for="col in SORTABLE_COLS"
              :key="col.id"
              class="px-2 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:px-4 sm:py-3 sm:text-xs"
            >
              <button class="flex items-center gap-1 whitespace-nowrap hover:text-foreground transition-colors" @click="() => handleSort(col.id)">
                <span class="sm:hidden">{{ col.mobileLabel }}</span>
                <span class="hidden sm:inline">{{ col.label }}</span>
                <ChevronUp v-if="sortBy === col.id && sortDir === 'asc'" :size="12" />
                <ChevronDown v-else-if="sortBy === col.id && sortDir === 'desc'" :size="12" />
                <ChevronsUpDown v-else :size="12" class="opacity-40" />
              </button>
            </th>
            <th
              class="hidden px-2 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:table-cell sm:px-4 sm:py-3 sm:text-xs"
            >
              Pace
            </th>
            <th
              v-if="showSource"
              class="hidden px-2 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:table-cell sm:px-4 sm:py-3 sm:text-xs"
            >
              Source
            </th>
            <th
              v-if="hasMultipleFormats"
              class="px-2 py-2.5 text-left text-[11px] font-medium text-muted-foreground uppercase tracking-wide sm:px-4 sm:py-3 sm:text-xs"
            >
              <span class="sm:hidden">Fmt</span>
              <span class="hidden sm:inline">Format</span>
            </th>
            <th class="w-28 px-2 py-2.5 sm:px-4 sm:py-3" />
          </tr>
        </thead>
        <tbody>
          <template v-for="row in rows" :key="row.key">
            <tr v-if="row.kind === 'header'" class="border-b border-border bg-muted/40">
              <td :colspan="columnCount" class="px-2 py-1.5 sm:px-4">
                <div class="flex items-center justify-between gap-2 text-[11px] sm:text-xs">
                  <span class="font-medium text-foreground">{{ row.label }}</span>
                  <span class="text-muted-foreground whitespace-nowrap">
                    {{ formatDayDuration(row.totalSeconds) }}
                    <template v-if="row.netDelta != null">
                      · <span :class="row.netDelta > 0 ? 'text-green-600' : 'text-muted-foreground'">{{ formatProgressDelta(row.netDelta) }}</span>
                    </template>
                  </span>
                </div>
              </td>
            </tr>
            <tr v-else class="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
              <td class="px-2 py-1.5 text-foreground whitespace-nowrap sm:px-4 sm:py-2">
                <span class="sm:hidden">
                  <template v-if="grouped">{{ formatTime(row.session.startedAt) }}</template>
                  <template v-else>{{ formatDateCompact(row.session.startedAt) }}</template>
                  <span v-if="row.session.source" class="ml-1.5" :class="[PILL_BASE, SESSION_SOURCE_PILLS[row.session.source].class]">
                    {{ SESSION_SOURCE_PILLS[row.session.source].label }}
                  </span>
                </span>
                <span class="hidden sm:inline">
                  <template v-if="grouped">{{ formatTime(row.session.startedAt) }}</template>
                  <template v-else>{{ formatDate(row.session.startedAt) }}</template>
                </span>
              </td>
              <td class="px-2 py-1.5 text-foreground whitespace-nowrap sm:px-4 sm:py-2">{{ formatDuration(row.session.durationSeconds) }}</td>
              <td
                class="px-2 py-1.5 whitespace-nowrap sm:px-4 sm:py-2"
                :class="row.session.progressDelta != null && row.session.progressDelta > 0 ? 'text-green-600' : 'text-muted-foreground'"
              >
                {{ formatProgressDelta(row.session.progressDelta) }}
              </td>
              <td class="px-2 py-1.5 text-foreground whitespace-nowrap sm:px-4 sm:py-2">
                {{ row.session.endProgress != null ? `${row.session.endProgress.toFixed(1)}%` : '-' }}
              </td>
              <td class="hidden px-2 py-1.5 text-muted-foreground whitespace-nowrap sm:table-cell sm:px-4 sm:py-2">
                {{ formatPace(row.session) }}
              </td>
              <td v-if="showSource" class="hidden px-2 py-1.5 whitespace-nowrap sm:table-cell sm:px-4 sm:py-2">
                <span v-if="row.session.source" :class="[PILL_BASE, SESSION_SOURCE_PILLS[row.session.source].class]">
                  {{ SESSION_SOURCE_PILLS[row.session.source].label }}
                </span>
                <span v-else class="text-muted-foreground">-</span>
              </td>
              <td v-if="hasMultipleFormats" class="px-2 py-1.5 text-foreground whitespace-nowrap sm:px-4 sm:py-2">
                {{ row.session.format ?? '-' }}
              </td>
              <td class="w-28 px-2 py-1.5 sm:px-4 sm:py-2">
                <div class="ml-auto flex h-6 w-[5.75rem] items-center justify-end gap-1">
                  <template v-if="confirmDeleteId === row.session.id">
                    <button
                      class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="Cancel delete"
                      aria-label="Cancel delete session"
                      @click="clearConfirmDelete"
                    >
                      <X :size="14" />
                    </button>
                    <button
                      class="inline-flex h-6 items-center justify-center rounded px-1.5 text-[10px] font-medium uppercase tracking-wide transition-colors bg-destructive/15 text-destructive ring-1 ring-destructive/40"
                      title="Click again to confirm delete"
                      aria-label="Confirm delete session"
                      @click="() => handleDeleteClick(row.session.id)"
                    >
                      Confirm
                    </button>
                  </template>
                  <button
                    v-else
                    class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                    title="Delete"
                    aria-label="Delete session"
                    @click="() => handleDeleteClick(row.session.id)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <div v-if="total > 0" class="mt-4 flex flex-col items-center gap-2">
      <button
        v-if="hasMore"
        class="inline-flex items-center gap-1.5 px-4 py-1.5 rounded border border-border bg-card hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed text-foreground text-sm transition-colors"
        :disabled="loadingMore"
        @click="handleLoadMore"
      >
        <Loader2 v-if="loadingMore" :size="14" class="animate-spin" />
        Load more
      </button>
      <span class="text-xs text-muted-foreground">Showing {{ sessions.length }} of {{ total }} sessions</span>
    </div>
  </div>
</template>
