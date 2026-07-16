<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
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

const { t } = useI18n()

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
  return formatLocaleDate(new Date(iso), { hour: '2-digit', minute: '2-digit' })
}

function formatDate(iso: string): string {
  return formatLocaleDate(new Date(iso), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateCompact(iso: string): string {
  return formatLocaleDate(new Date(iso), {
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

const SESSION_SOURCE_PILLS = computed<Record<ReadingSessionSource, { label: string; class: string }>>(() => ({
  web: { label: t('book.detail.readingLog.table.sourceWeb'), class: 'border-[var(--pill-web)]/40 bg-[var(--pill-web)]/10 text-[var(--pill-web)]' },
  koreader: { label: 'KOReader', class: 'border-[var(--pill-koreader)]/40 bg-[var(--pill-koreader)]/10 text-[var(--pill-koreader)]' },
  kobo: { label: 'Kobo', class: 'border-[var(--pill-kobo)]/40 bg-[var(--pill-kobo)]/10 text-[var(--pill-kobo)]' },
  manual: { label: t('book.detail.readingLog.table.sourceManual'), class: 'border-border bg-muted text-muted-foreground' },
}))

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

function handleSortClick(event: MouseEvent) {
  const col = (event.currentTarget as HTMLElement).dataset.sortColumn
  if (!col) return
  handleSort(col)
}

function handleDeleteSessionClick(event: MouseEvent) {
  const sessionId = Number((event.currentTarget as HTMLElement).dataset.sessionId)
  if (!Number.isInteger(sessionId)) return
  handleDeleteClick(sessionId)
}

const SORTABLE_COLS = computed(() => [
  { id: 'startedAt', label: t('book.detail.readingLog.table.colDate'), mobileLabel: t('book.detail.readingLog.table.colDateMobile') },
  {
    id: 'durationSeconds',
    label: t('book.detail.readingLog.table.colDuration'),
    mobileLabel: t('book.detail.readingLog.table.colDurationMobile'),
  },
  {
    id: 'progressDelta',
    label: t('book.detail.readingLog.table.colProgressChange'),
    mobileLabel: t('book.detail.readingLog.table.colProgressChangeMobile'),
  },
  {
    id: 'endProgress',
    label: t('book.detail.readingLog.table.colEndProgress'),
    mobileLabel: t('book.detail.readingLog.table.colEndProgressMobile'),
  },
])

const columnCount = computed(() => {
  let count = SORTABLE_COLS.value.length + 2
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
  return formatLocaleDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
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
  <section
    class="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--elevation-xs)]"
    aria-labelledby="reading-sessions-heading"
    @click.self="clearConfirmDelete"
  >
    <header class="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-5">
      <div>
        <h2 id="reading-sessions-heading" class="text-sm font-semibold text-foreground">{{ t('book.detail.readingLog.table.title') }}</h2>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{ total === 1 ? '1 recorded session' : `${total} recorded sessions` }}
        </p>
      </div>
      <span v-if="sessions.length > 0" class="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
        {{ grouped ? 'Grouped by day' : 'Custom sort' }}
      </span>
    </header>

    <div v-if="sessions.length === 0 && !loading" class="flex flex-col items-center justify-center px-4 py-16 text-center">
      <p class="text-sm font-medium text-foreground">{{ t('book.detail.readingLog.table.empty') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('book.detail.readingLog.table.emptyHint') }}</p>
    </div>

    <div v-else class="transition-opacity" :class="{ 'opacity-50 pointer-events-none': loading }">
      <div class="divide-y divide-border sm:hidden">
        <template v-for="row in rows" :key="row.key">
          <div v-if="row.kind === 'header'" class="flex items-center justify-between gap-3 bg-muted/55 px-4 py-2.5">
            <span class="text-xs font-medium text-foreground">{{ row.label }}</span>
            <span class="text-xs text-muted-foreground">
              {{ formatDayDuration(row.totalSeconds) }}
              <template v-if="row.netDelta != null">
                · <span :class="row.netDelta > 0 ? 'text-primary' : 'text-muted-foreground'">{{ formatProgressDelta(row.netDelta) }}</span>
              </template>
            </span>
          </div>
          <article v-else class="px-4 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-medium text-foreground">
                  <template v-if="grouped">{{ formatTime(row.session.startedAt) }}</template>
                  <template v-else>{{ formatDateCompact(row.session.startedAt) }}</template>
                </p>
                <div class="mt-1 flex flex-wrap items-center gap-1.5">
                  <span v-if="row.session.source" :class="[PILL_BASE, SESSION_SOURCE_PILLS[row.session.source].class]">
                    {{ SESSION_SOURCE_PILLS[row.session.source].label }}
                  </span>
                  <span
                    v-if="hasMultipleFormats && row.session.format"
                    class="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                  >
                    {{ row.session.format.toUpperCase() }}
                  </span>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <template v-if="confirmDeleteId === row.session.id">
                  <button
                    class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    :title="t('book.detail.readingLog.table.cancelDelete')"
                    :aria-label="t('book.detail.readingLog.table.cancelDeleteAria')"
                    @click="clearConfirmDelete"
                  >
                    <X :size="14" />
                  </button>
                  <button
                    :data-session-id="row.session.id"
                    class="inline-flex h-6 items-center justify-center rounded bg-destructive/15 px-2 text-[10px] font-medium uppercase tracking-wide text-destructive ring-1 ring-destructive/40 transition-colors"
                    :title="t('book.detail.readingLog.table.confirmDeleteTitle')"
                    :aria-label="t('book.detail.readingLog.table.confirmDeleteAria')"
                    @click="handleDeleteSessionClick"
                  >
                    Confirm
                  </button>
                </template>
                <button
                  v-else
                  :data-session-id="row.session.id"
                  class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  :title="t('common.delete')"
                  :aria-label="t('book.detail.readingLog.table.deleteAria')"
                  @click="handleDeleteSessionClick"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </div>
            <dl class="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div>
                <dt class="text-muted-foreground">{{ t('book.detail.readingLog.table.colDuration') }}</dt>
                <dd class="mt-0.5 font-medium text-foreground">{{ formatDuration(row.session.durationSeconds) }}</dd>
              </div>
              <div>
                <dt class="text-muted-foreground">{{ t('book.detail.readingLog.journey.tooltipProgress') }}</dt>
                <dd
                  class="mt-0.5 font-medium"
                  :class="row.session.progressDelta != null && row.session.progressDelta > 0 ? 'text-primary' : 'text-foreground'"
                >
                  {{ formatProgressDelta(row.session.progressDelta) }}
                </dd>
              </div>
              <div>
                <dt class="text-muted-foreground">{{ t('book.detail.readingLog.table.colEndProgressMobile') }}</dt>
                <dd class="mt-0.5 font-medium text-foreground">
                  {{ row.session.endProgress != null ? `${row.session.endProgress.toFixed(1)}%` : '-' }}
                </dd>
              </div>
            </dl>
          </article>
        </template>
      </div>

      <div class="hidden overflow-x-auto sm:block" :class="{ 'opacity-50 pointer-events-none': loading }">
        <table class="w-full min-w-max text-sm">
          <thead>
            <tr class="border-b border-border bg-muted/50">
              <th
                v-for="col in SORTABLE_COLS"
                :key="col.id"
                class="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                <button
                  :data-sort-column="col.id"
                  class="flex items-center gap-1 whitespace-nowrap transition-colors hover:text-foreground"
                  @click="handleSortClick"
                >
                  {{ col.label }}
                  <ChevronUp v-if="sortBy === col.id && sortDir === 'asc'" :size="12" />
                  <ChevronDown v-else-if="sortBy === col.id && sortDir === 'desc'" :size="12" />
                  <ChevronsUpDown v-else :size="12" class="opacity-40" />
                </button>
              </th>
              <th class="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {{ t('book.detail.readingLog.table.colPace') }}
              </th>
              <th v-if="showSource" class="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {{ t('book.detail.readingLog.table.colSource') }}
              </th>
              <th v-if="hasMultipleFormats" class="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Format
              </th>
              <th class="w-28 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            <template v-for="row in rows" :key="row.key">
              <tr v-if="row.kind === 'header'" class="border-b border-border bg-muted/40">
                <td :colspan="columnCount" class="px-4 py-1.5">
                  <div class="flex items-center justify-between gap-2 text-xs">
                    <span class="font-medium text-foreground">{{ row.label }}</span>
                    <span class="whitespace-nowrap text-muted-foreground">
                      {{ formatDayDuration(row.totalSeconds) }}
                      <template v-if="row.netDelta != null">
                        · <span :class="row.netDelta > 0 ? 'text-primary' : 'text-muted-foreground'">{{ formatProgressDelta(row.netDelta) }}</span>
                      </template>
                    </span>
                  </div>
                </td>
              </tr>
              <tr v-else class="border-b border-border last:border-0 transition-colors hover:bg-muted/30">
                <td class="whitespace-nowrap px-4 py-1.5 text-foreground">
                  <template v-if="grouped">{{ formatTime(row.session.startedAt) }}</template>
                  <template v-else>{{ formatDate(row.session.startedAt) }}</template>
                </td>
                <td class="whitespace-nowrap px-4 py-1.5 font-medium text-foreground">{{ formatDuration(row.session.durationSeconds) }}</td>
                <td
                  class="whitespace-nowrap px-4 py-1.5"
                  :class="row.session.progressDelta != null && row.session.progressDelta > 0 ? 'text-primary' : 'text-muted-foreground'"
                >
                  {{ formatProgressDelta(row.session.progressDelta) }}
                </td>
                <td class="whitespace-nowrap px-4 py-1.5 text-foreground">
                  {{ row.session.endProgress != null ? `${row.session.endProgress.toFixed(1)}%` : '-' }}
                </td>
                <td class="hidden whitespace-nowrap px-4 py-1.5 text-muted-foreground sm:table-cell">{{ formatPace(row.session) }}</td>
                <td v-if="showSource" class="whitespace-nowrap px-4 py-1.5">
                  <span v-if="row.session.source" :class="[PILL_BASE, SESSION_SOURCE_PILLS[row.session.source].class]">
                    {{ SESSION_SOURCE_PILLS[row.session.source].label }}
                  </span>
                  <span v-else class="text-muted-foreground">-</span>
                </td>
                <td v-if="hasMultipleFormats" class="whitespace-nowrap px-4 py-1.5 text-foreground">{{ row.session.format ?? '-' }}</td>
                <td class="w-28 px-4 py-1.5">
                  <div class="ml-auto flex h-6 w-[5.75rem] items-center justify-end gap-1">
                    <template v-if="confirmDeleteId === row.session.id">
                      <button
                        class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        :title="t('book.detail.readingLog.table.cancelDelete')"
                        :aria-label="t('book.detail.readingLog.table.cancelDeleteAria')"
                        @click="clearConfirmDelete"
                      >
                        <X :size="14" />
                      </button>
                      <button
                        :data-session-id="row.session.id"
                        class="inline-flex h-6 items-center justify-center rounded bg-destructive/15 px-2 text-[10px] font-medium uppercase tracking-wide text-destructive ring-1 ring-destructive/40 transition-colors"
                        :title="t('book.detail.readingLog.table.confirmDeleteTitle')"
                        :aria-label="t('book.detail.readingLog.table.confirmDeleteAria')"
                        @click="handleDeleteSessionClick"
                      >
                        Confirm
                      </button>
                    </template>
                    <button
                      v-else
                      :data-session-id="row.session.id"
                      class="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                      :title="t('common.delete')"
                      :aria-label="t('book.detail.readingLog.table.deleteAria')"
                      @click="handleDeleteSessionClick"
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
    </div>

    <footer v-if="total > 0" class="flex flex-col items-center gap-2 border-t border-border px-4 py-4">
      <button
        v-if="hasMore"
        class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="loadingMore"
        @click="handleLoadMore"
      >
        <Loader2 v-if="loadingMore" :size="14" class="animate-spin" />
        {{ t('book.detail.readingLog.table.loadMore') }}
      </button>
      <span class="text-xs text-muted-foreground">Showing {{ sessions.length }} of {{ total }} sessions</span>
    </footer>
  </section>
</template>
