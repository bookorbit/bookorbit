<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate } from '@/i18n/formatters'
import { Check, ChevronDown, Clock, Minus, Plus, TrendingDown, TrendingUp } from '@lucide/vue'
import type { BookDetail, BookReadingSessionStats, ReadStatus, UserBookStatus } from '@bookorbit/types'
import { isAudioFormat } from '@bookorbit/types'
import { api } from '@/lib/api'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { STATUS_COLORS, STATUS_ICONS, STATUS_OPTIONS, useBookStatus } from '@/features/book/composables/useBookStatus'
import AchievementProgressRing from '@/features/achievements/components/AchievementProgressRing.vue'
import ReadingLogSourceSplit from './ReadingLogSourceSplit.vue'

const props = defineProps<{
  book: BookDetail
  stats: BookReadingSessionStats | null
  loading: boolean
}>()

const emit = defineEmits<{
  saved: [readStatus: UserBookStatus]
  addSession: []
}>()

const { t } = useI18n()
const { setStatus, updateStatus } = useBookStatus()

const DAY_MS = 24 * 60 * 60 * 1000
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function dateToDateKey(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toDateInputValue(value: string | null | undefined): string {
  if (!value) return ''
  if (DATE_KEY_RE.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return dateToDateKey(parsed)
}

function formatDisplayDate(dateKey: string): string {
  if (!dateKey) return t('book.detail.readingLog.hero.notSet')
  const [year, month, day] = dateKey.split('-').map(Number)
  const d = new Date(year!, month! - 1, day!)
  return formatDate(d, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}

function formatRelative(iso: string | null): string {
  if (!iso) return '-'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return t('book.detail.readingLog.hero.relative.seconds', { count: s })
  const m = Math.floor(s / 60)
  if (m < 60) return t('book.detail.readingLog.hero.relative.minutes', { count: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('book.detail.readingLog.hero.relative.hours', { count: h })
  const d = Math.floor(h / 24)
  if (d < 30) return t('book.detail.readingLog.hero.relative.days', { count: d })
  const mo = Math.floor(d / 30)
  if (mo < 12) return t('book.detail.readingLog.hero.relative.months', { count: mo }, mo)
  const yr = Math.floor(mo / 12)
  return t('book.detail.readingLog.hero.relative.years', { count: yr }, yr)
}

const todayDateInput = computed(() => dateToDateKey(new Date()))

const localReadStatus = ref<ReadStatus | null>(props.book.readStatus?.status ?? null)
const savedDates = ref({ startedAt: '', finishedAt: '' })
const draftDates = ref({ startedAt: '', finishedAt: '' })
const activeDateField = ref<'startedAt' | 'finishedAt' | null>(null)
const savingDates = ref(false)
const datesError = ref<string | null>(null)

function normalizeDates(readStatus: UserBookStatus | null | undefined) {
  return {
    startedAt: toDateInputValue(readStatus?.startedAt),
    finishedAt: toDateInputValue(readStatus?.finishedAt),
  }
}

watch(
  () => props.book.readStatus,
  (value) => {
    activeDateField.value = null
    localReadStatus.value = value?.status ?? null
    const normalized = normalizeDates(value)
    savedDates.value = normalized
    draftDates.value = { ...normalized }
    datesError.value = null
  },
  { immediate: true },
)

function validateDates(values: { startedAt: string; finishedAt: string }): string | null {
  if (values.startedAt && values.startedAt > todayDateInput.value) return t('book.detail.readingLog.hero.dateErrors.startFuture')
  if (values.finishedAt && values.finishedAt > todayDateInput.value) return t('book.detail.readingLog.hero.dateErrors.finishFuture')
  if (values.startedAt && values.finishedAt && values.finishedAt < values.startedAt)
    return t('book.detail.readingLog.hero.dateErrors.finishBeforeStart')
  return null
}

function applyReadStatusUpdate(updated: UserBookStatus) {
  localReadStatus.value = updated.status
  const normalized = normalizeDates(updated)
  savedDates.value = normalized
  draftDates.value = { ...normalized }
  datesError.value = null
  emit('saved', updated)
}

async function handleSetReadStatus(status: ReadStatus) {
  const prev = localReadStatus.value
  localReadStatus.value = status
  try {
    const updated = await setStatus(props.book.id, status)
    applyReadStatusUpdate(updated)
  } catch {
    localReadStatus.value = prev
  }
}

function startEditingDate(field: 'startedAt' | 'finishedAt') {
  if (savingDates.value) return
  draftDates.value = { ...savedDates.value }
  activeDateField.value = field
  datesError.value = null
}

function handleStartedClick() {
  startEditingDate('startedAt')
}

function handleFinishedClick() {
  startEditingDate('finishedAt')
}

async function saveDateField(field: 'startedAt' | 'finishedAt') {
  if (activeDateField.value !== field || savingDates.value) return
  const validationError = validateDates(draftDates.value)
  datesError.value = validationError
  if (validationError) return
  if (draftDates.value[field] === savedDates.value[field]) {
    activeDateField.value = null
    return
  }
  savingDates.value = true
  try {
    const patch = field === 'startedAt' ? { startedAt: draftDates.value.startedAt || null } : { finishedAt: draftDates.value.finishedAt || null }
    const updated = await updateStatus(props.book.id, patch)
    applyReadStatusUpdate(updated)
    activeDateField.value = null
  } catch {
    datesError.value = t('book.detail.readingLog.hero.dateErrors.saveFailed')
  } finally {
    savingDates.value = false
  }
}

function cancelDateEdit(field: 'startedAt' | 'finishedAt') {
  if (activeDateField.value !== field) return
  activeDateField.value = null
  draftDates.value[field] = savedDates.value[field]
  datesError.value = null
}

function handleStartedSave() {
  void saveDateField('startedAt')
}

function handleStartedCancel() {
  cancelDateEdit('startedAt')
}

function handleFinishedSave() {
  void saveDateField('finishedAt')
}

function handleFinishedCancel() {
  cancelDateEdit('finishedAt')
}

const currentProgress = ref(0)
const progressLoaded = ref(false)

async function loadProgress() {
  progressLoaded.value = false
  const bookId = props.book.id
  const hasAudio = props.book.files.some((f) => f.format != null && isAudioFormat(f.format))
  try {
    const [progressRes, audioRes] = await Promise.all([
      api(`/api/v1/books/${bookId}/progress`).catch(() => null),
      hasAudio ? api(`/api/v1/books/${bookId}/audio-progress`).catch(() => null) : Promise.resolve(null),
    ])
    if (bookId !== props.book.id) return

    let max = 0
    if (progressRes?.ok) {
      const rows = (await progressRes.json()) as { fileId: number; percentage: number }[]
      for (const row of rows) {
        if (Number.isFinite(row.percentage)) max = Math.max(max, row.percentage)
      }
    }
    if (audioRes?.ok) {
      const data = (await audioRes.json()) as { percentage?: number } | null
      if (data && Number.isFinite(data.percentage)) max = Math.max(max, data.percentage!)
    }
    currentProgress.value = Math.min(100, Math.max(0, max))
  } catch {
    currentProgress.value = 0
  } finally {
    progressLoaded.value = true
  }
}

watch(() => props.book.id, loadProgress, { immediate: true })

const progressLabel = computed(() => {
  const value = currentProgress.value
  if (value > 0 && value < 1) return '<1%'
  if (value > 99 && value < 100) return '>99%'
  return `${Math.round(value)}%`
})

const pacePercentPerHour = computed(() => {
  const stats = props.stats
  if (!stats || stats.paceProgressDelta <= 0 || stats.paceDurationSeconds <= 0) return null
  return stats.paceProgressDelta / (stats.paceDurationSeconds / 3600)
})

const etaLabel = computed(() => {
  const status = localReadStatus.value
  if (status === 'read' || status === 'abandoned') return null
  const pace = pacePercentPerHour.value
  if (pace == null || !progressLoaded.value) return null
  const remaining = 100 - currentProgress.value
  if (remaining <= 0) return null
  const totalMinutes = (remaining / pace) * 60
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null
  if (totalMinutes > 99 * 60) return t('book.detail.readingLog.hero.eta.max')
  const rounded = Math.max(5, Math.round(totalMinutes / 5) * 5)
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  if (h <= 0) return t('book.detail.readingLog.hero.eta.minutes', { m })
  if (m === 0) return t('book.detail.readingLog.hero.eta.hours', { h })
  return t('book.detail.readingLog.hero.eta.hoursMinutes', { h, m })
})

function toUtcDayStart(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function toUtcDayKey(dayStartMs: number): string {
  return new Date(dayStartMs).toISOString().slice(0, 10)
}

const momentum = computed(() => {
  const summary = props.stats?.dailySummary ?? []
  const map = new Map(summary.map((row) => [row.day, row.totalMinutes]))
  const todayStart = toUtcDayStart(new Date())
  let last7 = 0
  let prev7 = 0
  for (let offset = 0; offset < 7; offset += 1) {
    last7 += map.get(toUtcDayKey(todayStart - offset * DAY_MS)) ?? 0
    prev7 += map.get(toUtcDayKey(todayStart - (offset + 7) * DAY_MS)) ?? 0
  }
  if (last7 === 0 && prev7 === 0) return { direction: 'flat' as const, title: t('book.detail.readingLog.hero.momentum.none') }
  if (prev7 <= 0) return { direction: 'up' as const, title: t('book.detail.readingLog.hero.momentum.new') }
  const pct = Math.round(((last7 - prev7) / prev7) * 100)
  if (pct > 0) return { direction: 'up' as const, title: t('book.detail.readingLog.hero.momentum.up', { pct }) }
  if (pct < 0) return { direction: 'down' as const, title: t('book.detail.readingLog.hero.momentum.down', { pct }) }
  return { direction: 'flat' as const, title: t('book.detail.readingLog.hero.momentum.flat') }
})

const statCells = computed(() => [
  {
    label: t('book.detail.readingLog.hero.stats.totalTime'),
    value: props.stats ? formatDuration(props.stats.totalSeconds) : '0s',
    withMomentum: true,
  },
  { label: t('book.detail.readingLog.hero.stats.sessions'), value: String(props.stats?.totalSessions ?? 0), withMomentum: false },
  {
    label: t('book.detail.readingLog.hero.stats.avgSession'),
    value: props.stats ? formatDuration(props.stats.avgDurationSeconds) : '0s',
    withMomentum: false,
  },
  {
    label: t('book.detail.readingLog.hero.stats.lastRead'),
    value: props.stats ? formatRelative(props.stats.lastSessionAt) : '-',
    withMomentum: false,
  },
])

const currentStatusOption = computed(() => STATUS_OPTIONS.find((o) => o.value === (localReadStatus.value ?? 'unread')))

function handleAddSession() {
  emit('addSession')
}
</script>

<template>
  <section
    class="rounded-xl border border-border bg-card px-3.5 py-3 shadow-[var(--elevation-xs)] sm:px-4"
    :aria-label="t('book.detail.readingLog.hero.summaryAria')"
  >
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div class="flex min-w-0 items-center gap-3">
        <div class="relative flex size-16 shrink-0 items-center justify-center rounded-xl bg-primary/10">
          <AchievementProgressRing :percent="currentProgress" color="text-primary" :size="56" />
          <span class="absolute inset-0 flex items-center justify-center text-xs font-semibold text-foreground">
            {{ progressLoaded ? progressLabel : '' }}
          </span>
        </div>

        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button class="flex w-fit items-center gap-1.5 rounded-md text-sm font-semibold text-foreground transition-colors hover:text-primary">
                  <component :is="STATUS_ICONS[localReadStatus ?? 'unread']" class="size-4" :class="STATUS_COLORS[localReadStatus ?? 'unread']" />
                  {{ currentStatusOption?.label }}
                  <ChevronDown class="size-3.5 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem v-for="opt in STATUS_OPTIONS" :key="opt.value" @click="handleSetReadStatus(opt.value)">
                  <component :is="STATUS_ICONS[opt.value]" class="mr-2 size-4" :class="STATUS_COLORS[opt.value]" />
                  {{ opt.label }}
                  <Check v-if="localReadStatus === opt.value" class="ml-auto size-3 text-primary" />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <span v-if="etaLabel" class="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock class="size-3" />
              {{ etaLabel }}
            </span>
          </div>

          <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              Started
              <input
                v-if="activeDateField === 'startedAt'"
                v-model="draftDates.startedAt"
                type="date"
                :max="todayDateInput"
                :disabled="savingDates"
                class="ml-1 h-6 rounded border border-input bg-background px-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                autofocus
                @blur="handleStartedSave"
                @keydown.enter.prevent="handleStartedSave"
                @keydown.esc.prevent="handleStartedCancel"
              />
              <button v-else class="ml-1 font-medium text-foreground transition-colors hover:text-primary" @click="handleStartedClick">
                {{ formatDisplayDate(savedDates.startedAt) }}
              </button>
            </span>
            <span v-if="savedDates.finishedAt || activeDateField === 'finishedAt' || localReadStatus === 'read' || localReadStatus === 'abandoned'">
              Finished
              <input
                v-if="activeDateField === 'finishedAt'"
                v-model="draftDates.finishedAt"
                type="date"
                :max="todayDateInput"
                :disabled="savingDates"
                class="ml-1 h-6 rounded border border-input bg-background px-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                autofocus
                @blur="handleFinishedSave"
                @keydown.enter.prevent="handleFinishedSave"
                @keydown.esc.prevent="handleFinishedCancel"
              />
              <button v-else class="ml-1 font-medium text-foreground transition-colors hover:text-primary" @click="handleFinishedClick">
                {{ savedDates.finishedAt ? formatDisplayDate(savedDates.finishedAt) : 'Set date' }}
              </button>
            </span>
          </div>
          <p v-if="datesError" class="mt-1.5 text-xs text-destructive">{{ datesError }}</p>
        </div>
      </div>

      <div
        class="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 transition-opacity sm:grid-cols-4 lg:ml-auto lg:max-w-xl lg:border-t-0 lg:pt-0"
        :class="{ 'opacity-50': loading && stats !== null }"
      >
        <template v-if="stats === null && loading">
          <div v-for="i in 4" :key="i">
            <div class="mb-1 h-3 w-14 rounded bg-muted animate-shimmer" />
            <div class="h-5 w-10 rounded bg-muted animate-shimmer" />
          </div>
        </template>
        <template v-else>
          <div v-for="cell in statCells" :key="cell.label" class="min-w-0 lg:border-l lg:border-border lg:pl-4 lg:first:border-l-0 lg:first:pl-0">
            <p class="text-[11px] text-muted-foreground">{{ cell.label }}</p>
            <p class="mt-0.5 flex items-center gap-1 text-base font-semibold tracking-tight text-foreground">
              {{ cell.value }}
              <span v-if="cell.withMomentum" :title="momentum.title" class="inline-flex">
                <TrendingUp v-if="momentum.direction === 'up'" class="size-3.5 text-primary" />
                <TrendingDown v-else-if="momentum.direction === 'down'" class="size-3.5 text-destructive" />
                <Minus v-else class="size-3.5 text-muted-foreground" />
              </span>
            </p>
          </div>
        </template>
      </div>

      <button
        class="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        @click="handleAddSession"
      >
        <Plus class="size-3.5" />
        Add session
      </button>
    </div>
    <ReadingLogSourceSplit :stats="stats" compact class="mt-2 border-t border-border pt-2" />
  </section>
</template>
