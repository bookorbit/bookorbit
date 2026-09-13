<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, ChevronsUpDown, Loader2, RotateCcw, Trash2, X } from '@lucide/vue'
import type { BookReadingSession, ReadingAttempt, ReadingSessionSourceBucket } from '@bookorbit/types'
import { toReadingSessionSourceBucket, READING_SESSION_SOURCE_BUCKET_LABELS } from '@bookorbit/types'
import { formatDate } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { buildReadingCheckpointRoute } from '@/lib/reading-checkpoint'

const props = defineProps<{
  bookId: number
  sessions: BookReadingSession[]
  total: number
  sortBy: string
  sortDir: 'asc' | 'desc'
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  attempts: ReadingAttempt[]
}>()

const emit = defineEmits<{
  sortChange: [sortBy: string, sortDir: 'asc' | 'desc']
  loadMore: []
  deleteSession: [sessionId: number]
}>()

const { t } = useI18n()

// Eight columns wide, dropping the two least load-bearing ones as the pane narrows. Hidden grid
// items are removed from the grid entirely, so each breakpoint declares exactly the columns it
// still renders.
const ROW_GRID =
  'grid items-center gap-x-2.5 grid-cols-[4.5rem_3.25rem_2.75rem_minmax(0,1fr)_3rem_1.5rem] ' +
  'sm:grid-cols-[5rem_3.5rem_3rem_3.5rem_minmax(0,1fr)_3.25rem_1.5rem] ' +
  'lg:grid-cols-[5.5rem_3.5rem_3rem_3.5rem_minmax(0,1fr)_3.25rem_4.75rem_1.5rem]'

const BUCKET_TOKEN: Record<ReadingSessionSourceBucket, string> = {
  bookorbit: '--pill-web',
  koreader: '--pill-koreader',
  kobo: '--pill-kobo',
}

/** Gaps of a day or two are the normal rhythm of reading a book; only a real stall is a fact. */
const MIN_GAP_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

const confirmDeleteId = ref<number | null>(null)

watch(
  () => props.sessions,
  () => {
    confirmDeleteId.value = null
  },
)

function localDayKey(iso: string): string {
  const value = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
}

function dayFromKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}

function formatDayLabel(dayKey: string): string {
  return formatDate(dayFromKey(dayKey), { month: 'short', day: 'numeric' })
}

function formatWeekday(dayKey: string): string {
  return formatDate(dayFromKey(dayKey), { weekday: 'short' })
}

function formatTime(iso: string): string {
  return formatDate(new Date(iso), { hour: 'numeric', minute: '2-digit' })
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return t('book.detail.readingLog.vitals.durationHm', { hours, minutes })
  if (minutes > 0) return t('book.detail.readingLog.vitals.durationM', { minutes })
  return t('book.detail.readingLog.vitals.durationS', { seconds: Math.floor(seconds % 60) })
}

function formatProgressDelta(progressDelta: number | null): string {
  if (progressDelta == null) return '-'
  if (Math.abs(progressDelta) < 0.05) return '0%'
  const prefix = progressDelta > 0 ? '+' : ''
  return `${prefix}${progressDelta.toFixed(1)}%`
}

function formatEndProgress(endProgress: number | null): string {
  return endProgress == null ? '-' : `${endProgress.toFixed(0)}%`
}

function checkpointRoute(session: BookReadingSession) {
  return buildReadingCheckpointRoute(props.bookId, session)
}

function sourceLabel(session: BookReadingSession): string {
  return READING_SESSION_SOURCE_BUCKET_LABELS[toReadingSessionSourceBucket(session.source)]
}

function sourceColor(session: BookReadingSession): string {
  return `var(${BUCKET_TOKEN[toReadingSessionSourceBucket(session.source)]})`
}

function formatBadgeStyle(format: string) {
  const color = formatColorVar(format)
  return {
    color,
    borderColor: `color-mix(in oklch, ${color} 45%, transparent)`,
    backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`,
  }
}

/** The stretch of the book a session covered, as a start offset and a width in percent. */
function positionBar(session: BookReadingSession) {
  const delta = session.progressDelta ?? 0
  const end = Math.max(0, Math.min(100, session.endProgress ?? 0))
  const from = Math.max(0, Math.min(100, end - delta))
  const low = Math.min(from, end)
  const high = Math.max(from, end)
  // A session that ends at 100% still needs a visible mark, and neither the fill nor the tick
  // may hang off the end of the track.
  const width = Math.max(1.5, high - low)
  return {
    left: `${Math.min(low, 100 - width)}%`,
    width: `${width}%`,
    end: `clamp(0px, ${end}% - 1px, 100% - 2px)`,
    backwards: delta < -0.5,
  }
}

const attemptById = computed(() => new Map(props.attempts.map((attempt) => [attempt.id, attempt])))
const attemptOrdinalById = computed(() => {
  const ordered = [...props.attempts].sort((left, right) => left.id - right.id)
  return new Map(ordered.map((attempt, index) => [attempt.id, index + 1]))
})

/** Where an attempt started and how long the reading stopped only mean anything in date order. */
const chronological = computed(() => props.sortBy === 'startedAt')

type LedgerRow =
  | { kind: 'session'; key: string; session: BookReadingSession; showDay: boolean; startsDay: boolean }
  | { kind: 'gap'; key: string; days: number }
  | { kind: 'attempt'; key: string; attemptId: number }

const rows = computed<LedgerRow[]>(() => {
  const out: LedgerRow[] = []
  let previousDay: string | null = null
  props.sessions.forEach((session, index) => {
    const dayKey = localDayKey(session.startedAt)
    if (chronological.value && index > 0) {
      const previous = props.sessions[index - 1]!
      const previousKey = localDayKey(previous.startedAt)
      if (session.attemptId !== previous.attemptId) {
        // The rule marks where the newer of the two attempts began, whichever way the list runs.
        // Sessions recorded while no attempt was open carry null, which is not an event.
        const newerAttemptId = props.sortDir === 'desc' ? previous.attemptId : session.attemptId
        if (newerAttemptId != null) out.push({ kind: 'attempt', key: `a-${session.id}`, attemptId: newerAttemptId })
      }
      const gap = Math.abs(Date.parse(`${previousKey}T00:00:00`) - Date.parse(`${dayKey}T00:00:00`)) / DAY_MS - 1
      if (gap >= MIN_GAP_DAYS) out.push({ kind: 'gap', key: `g-${session.id}`, days: Math.round(gap) })
    }
    const startsDay = dayKey !== previousDay
    out.push({ kind: 'session', key: `s-${session.id}`, session, showDay: !chronological.value || startsDay, startsDay })
    previousDay = dayKey
  })
  // Only claim where the oldest attempt began once there is nothing older left to load.
  const last = props.sessions[props.sessions.length - 1]
  if (chronological.value && props.sortDir === 'desc' && last?.attemptId != null && !props.hasMore) {
    out.push({ kind: 'attempt', key: `a-tail-${last.id}`, attemptId: last.attemptId })
  }
  return out
})

function attemptLabel(attemptId: number): string {
  const ordinal = attemptOrdinalById.value.get(attemptId)
  if (ordinal == null) return t('book.detail.readingLog.ledger.attemptOutsideAny')
  return t('book.detail.readingLog.ledger.attemptBegan', { index: ordinal })
}

function attemptDetail(attemptId: number): string {
  const attempt = attemptById.value.get(attemptId)
  if (!attempt?.startedOn) return ''
  return formatDate(dayFromKey(attempt.startedOn), { year: 'numeric', month: 'short', day: 'numeric' })
}

const SORTABLE_COLUMNS = computed(() => [
  { id: 'startedAt', key: 'day', label: t('book.detail.readingLog.ledger.colDay') },
  { id: 'durationSeconds', key: 'length', label: t('book.detail.readingLog.ledger.colLength') },
  { id: 'progressDelta', key: 'change', label: t('book.detail.readingLog.ledger.colChange') },
  { id: 'endProgress', key: 'reached', label: t('book.detail.readingLog.ledger.colReached') },
])

function columnFor(key: string) {
  return SORTABLE_COLUMNS.value.find((column) => column.key === key)!
}

function handleSortClick(event: MouseEvent) {
  const column = (event.currentTarget as HTMLElement).dataset.sortColumn
  if (!column) return
  confirmDeleteId.value = null
  emit('sortChange', column, props.sortBy === column && props.sortDir === 'asc' ? 'desc' : 'asc')
}

function handleDeleteSessionClick(event: MouseEvent) {
  const sessionId = Number((event.currentTarget as HTMLElement).dataset.sessionId)
  if (!Number.isInteger(sessionId)) return
  if (confirmDeleteId.value === sessionId) {
    emit('deleteSession', sessionId)
    confirmDeleteId.value = null
    return
  }
  confirmDeleteId.value = sessionId
}

function clearConfirmDelete() {
  confirmDeleteId.value = null
}

function handleLoadMore() {
  confirmDeleteId.value = null
  emit('loadMore')
}
</script>

<template>
  <section
    class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    :aria-label="t('book.detail.readingLog.ledger.title')"
  >
    <header class="flex flex-none flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <h2 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.readingLog.ledger.title') }}</h2>
      <p class="text-[11px] tabular-nums text-muted-foreground">
        <template v-if="total === 0">{{ t('book.detail.readingLog.ledger.none') }}</template>
        <template v-else-if="sessions.length < total">{{ t('book.detail.readingLog.table.showing', { shown: sessions.length, total }) }}</template>
        <template v-else>{{ total }}</template>
      </p>
      <div class="ml-auto flex flex-wrap items-center gap-1.5">
        <slot name="actions" />
      </div>
    </header>

    <div v-if="sessions.length === 0 && loading" class="flex flex-1 flex-col gap-2 px-3 py-3" aria-hidden="true">
      <div v-for="row in 6" :key="row" class="h-4 rounded bg-muted animate-shimmer" />
    </div>

    <div v-else-if="sessions.length === 0" class="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 py-10 text-center">
      <p class="text-[13px] font-medium text-foreground">{{ t('book.detail.readingLog.ledger.empty') }}</p>
      <p class="max-w-[34ch] text-xs leading-relaxed text-muted-foreground">{{ t('book.detail.readingLog.ledger.emptyHint') }}</p>
    </div>

    <template v-else>
      <div :class="[ROW_GRID, 'group/ledgerhead flex-none border-b border-border bg-muted/40 px-3 py-1.5']">
        <button
          :data-sort-column="columnFor('day').id"
          class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition-colors"
          :class="sortBy === columnFor('day').id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="handleSortClick"
        >
          {{ columnFor('day').label }}
          <ChevronUp v-if="sortBy === columnFor('day').id && sortDir === 'asc'" :size="10" />
          <ChevronDown v-else-if="sortBy === columnFor('day').id" :size="10" />
          <ChevronsUpDown v-else :size="10" class="opacity-0 transition-opacity group-hover/ledgerhead:opacity-50" />
        </button>
        <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.readingLog.ledger.colTime') }}</span>
        <button
          :data-sort-column="columnFor('length').id"
          class="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition-colors"
          :class="sortBy === columnFor('length').id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="handleSortClick"
        >
          {{ columnFor('length').label }}
          <ChevronUp v-if="sortBy === columnFor('length').id && sortDir === 'asc'" :size="10" />
          <ChevronDown v-else-if="sortBy === columnFor('length').id" :size="10" />
          <ChevronsUpDown v-else :size="10" class="opacity-0 transition-opacity group-hover/ledgerhead:opacity-50" />
        </button>
        <button
          :data-sort-column="columnFor('change').id"
          class="hidden items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition-colors sm:flex"
          :class="sortBy === columnFor('change').id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="handleSortClick"
        >
          {{ columnFor('change').label }}
          <ChevronUp v-if="sortBy === columnFor('change').id && sortDir === 'asc'" :size="10" />
          <ChevronDown v-else-if="sortBy === columnFor('change').id" :size="10" />
          <ChevronsUpDown v-else :size="10" class="opacity-0 transition-opacity group-hover/ledgerhead:opacity-50" />
        </button>
        <span class="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{
          t('book.detail.readingLog.ledger.colPosition')
        }}</span>
        <button
          :data-sort-column="columnFor('reached').id"
          class="flex items-center justify-end gap-1 text-[10px] font-semibold uppercase tracking-wider transition-colors"
          :class="sortBy === columnFor('reached').id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="handleSortClick"
        >
          {{ columnFor('reached').label }}
          <ChevronUp v-if="sortBy === columnFor('reached').id && sortDir === 'asc'" :size="10" />
          <ChevronDown v-else-if="sortBy === columnFor('reached').id" :size="10" />
          <ChevronsUpDown v-else :size="10" class="opacity-0 transition-opacity group-hover/ledgerhead:opacity-50" />
        </button>
        <span class="hidden text-[10px] font-semibold uppercase tracking-wider text-muted-foreground lg:block">{{
          t('book.detail.readingLog.ledger.colSource')
        }}</span>
        <span />
      </div>

      <div
        class="min-h-0 flex-1 overflow-y-auto transition-opacity [&>*:first-child]:border-t-0"
        :class="{ 'pointer-events-none opacity-50': loading }"
      >
        <template v-for="row in rows" :key="row.key">
          <p v-if="row.kind === 'gap'" class="flex items-center gap-2.5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
            <span class="h-px flex-1 bg-border" aria-hidden="true" />
            {{ t('book.detail.readingLog.ledger.gapDays', { count: row.days }, row.days) }}
            <span class="h-px flex-1 bg-border" aria-hidden="true" />
          </p>

          <p
            v-else-if="row.kind === 'attempt'"
            class="flex items-center gap-2 border-t border-primary/40 bg-primary/5 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-primary"
          >
            <RotateCcw class="size-3 shrink-0" aria-hidden="true" />
            {{ attemptLabel(row.attemptId) }}
            <span v-if="attemptDetail(row.attemptId)" class="font-normal text-muted-foreground">{{ attemptDetail(row.attemptId) }}</span>
          </p>

          <div
            v-else
            :class="[
              ROW_GRID,
              'h-[30px] border-t px-3 transition-colors hover:bg-muted/40',
              row.startsDay && chronological ? 'border-border' : 'border-border/50',
            ]"
          >
            <span class="truncate text-[11px] font-semibold leading-4 text-foreground" :class="{ invisible: !row.showDay }">
              {{ formatDayLabel(localDayKey(row.session.startedAt)) }}
              <span class="font-normal text-muted-foreground">{{ formatWeekday(localDayKey(row.session.startedAt)) }}</span>
            </span>
            <span class="truncate whitespace-nowrap text-[11px] leading-4 tabular-nums text-muted-foreground">{{
              formatTime(row.session.startedAt)
            }}</span>
            <span class="whitespace-nowrap text-xs font-semibold leading-4 tabular-nums text-foreground">{{
              formatDuration(row.session.durationSeconds)
            }}</span>
            <span
              class="hidden whitespace-nowrap text-xs font-semibold leading-4 tabular-nums sm:block"
              :class="
                (row.session.progressDelta ?? 0) > 0.05
                  ? 'text-primary'
                  : (row.session.progressDelta ?? 0) < -0.05
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-muted-foreground'
              "
            >
              {{ formatProgressDelta(row.session.progressDelta) }}
            </span>
            <span class="relative h-1.5 overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-border" aria-hidden="true">
              <span
                class="absolute inset-y-0 rounded-full"
                :class="positionBar(row.session).backwards ? 'bg-amber-500' : 'bg-primary'"
                :style="{ left: positionBar(row.session).left, width: positionBar(row.session).width }"
              />
              <span class="absolute inset-y-0 w-0.5 bg-foreground/70" :style="{ left: positionBar(row.session).end }" />
            </span>
            <span class="whitespace-nowrap text-right text-xs font-semibold leading-4 tabular-nums text-muted-foreground">
              <RouterLink
                v-if="checkpointRoute(row.session)"
                :to="checkpointRoute(row.session)!"
                class="rounded underline decoration-border underline-offset-2 transition-colors hover:decoration-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                :aria-label="t('book.detail.readingLog.table.jumpToProgress', { progress: row.session.endProgress?.toFixed(1) })"
              >
                {{ formatEndProgress(row.session.endProgress) }}
              </RouterLink>
              <template v-else>{{ formatEndProgress(row.session.endProgress) }}</template>
            </span>
            <span class="hidden min-w-0 items-center gap-1.5 lg:flex">
              <span class="size-1.5 shrink-0 rounded-full" :style="{ backgroundColor: sourceColor(row.session) }" :title="sourceLabel(row.session)" />
              <span
                v-if="row.session.format"
                class="inline-flex h-4 shrink-0 items-center rounded border px-1 text-[10px] font-bold uppercase leading-none tracking-wider"
                :style="formatBadgeStyle(row.session.format)"
              >
                {{ row.session.format }}
              </span>
            </span>
            <span class="flex items-center justify-end">
              <button
                v-if="confirmDeleteId === row.session.id"
                class="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                :title="t('book.detail.readingLog.table.cancelDelete')"
                :aria-label="t('book.detail.readingLog.table.cancelDeleteAria')"
                @click="clearConfirmDelete"
              >
                <X :size="12" />
              </button>
              <button
                :data-session-id="row.session.id"
                class="inline-flex size-5 items-center justify-center rounded transition-colors"
                :class="
                  confirmDeleteId === row.session.id
                    ? 'bg-destructive/15 text-destructive ring-1 ring-destructive/40'
                    : 'text-muted-foreground hover:bg-muted hover:text-destructive'
                "
                :title="confirmDeleteId === row.session.id ? t('book.detail.readingLog.table.confirmDeleteTitle') : t('common.delete')"
                :aria-label="
                  confirmDeleteId === row.session.id
                    ? t('book.detail.readingLog.table.confirmDeleteAria')
                    : t('book.detail.readingLog.table.deleteAria')
                "
                @click="handleDeleteSessionClick"
              >
                <Trash2 :size="12" />
              </button>
            </span>
          </div>
        </template>
      </div>

      <footer v-if="hasMore" class="flex flex-none justify-center border-t border-border px-3 py-1.5">
        <button
          class="inline-flex h-6 items-center gap-1.5 rounded-md border border-border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="loadingMore"
          @click="handleLoadMore"
        >
          <Loader2 v-if="loadingMore" :size="11" class="animate-spin" />
          {{ t('book.detail.readingLog.table.loadMore') }}
        </button>
      </footer>
    </template>
  </section>
</template>
