<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, ChevronDown, Clock, Minus, Plus, TrendingDown, TrendingUp } from '@lucide/vue'
import type { BookDetail, BookReadingSessionStats, ReadStatus, UserBookStatus } from '@bookorbit/types'
import { isAudioFormat } from '@bookorbit/types'
import { api } from '@/lib/api'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { STATUS_COLORS, STATUS_ICONS, STATUS_OPTIONS, useBookStatus } from '@/features/book/composables/useBookStatus'
import AchievementProgressRing from '@/features/achievements/components/AchievementProgressRing.vue'

const props = defineProps<{
  book: BookDetail
  stats: BookReadingSessionStats | null
  loading: boolean
}>()

const emit = defineEmits<{
  saved: [readStatus: UserBookStatus]
  addSession: []
}>()

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
  if (!dateKey) return 'Not set'
  const [year, month, day] = dateKey.split('-').map(Number)
  const d = new Date(year!, month! - 1, day!)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
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
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`
  const yr = Math.floor(mo / 12)
  return `${yr} year${yr === 1 ? '' : 's'} ago`
}

function formatSessionDate(iso: string | null): string {
  if (!iso) return 'No sessions'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  if (values.startedAt && values.startedAt > todayDateInput.value) return 'Start date cannot be in the future.'
  if (values.finishedAt && values.finishedAt > todayDateInput.value) return 'Finish date cannot be in the future.'
  if (values.startedAt && values.finishedAt && values.finishedAt < values.startedAt) return 'Finish date must be on or after the start date.'
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
    datesError.value = 'Failed to save reading dates.'
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
  if (totalMinutes > 99 * 60) return '99h+ to finish'
  const rounded = Math.max(5, Math.round(totalMinutes / 5) * 5)
  const h = Math.floor(rounded / 60)
  const m = rounded % 60
  if (h <= 0) return `~${m}m to finish`
  if (m === 0) return `~${h}h to finish`
  return `~${h}h ${m}m to finish`
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
  if (last7 === 0 && prev7 === 0) return { direction: 'flat' as const, title: 'No activity in the last two weeks' }
  if (prev7 <= 0) return { direction: 'up' as const, title: 'New activity this week' }
  const pct = Math.round(((last7 - prev7) / prev7) * 100)
  if (pct > 0) return { direction: 'up' as const, title: `+${pct}% vs previous 7 days` }
  if (pct < 0) return { direction: 'down' as const, title: `${pct}% vs previous 7 days` }
  return { direction: 'flat' as const, title: 'Unchanged vs previous 7 days' }
})

const statCells = computed(() => [
  { label: 'Total Time', value: props.stats ? formatDuration(props.stats.totalSeconds) : '0s', withMomentum: true },
  { label: 'Sessions', value: String(props.stats?.totalSessions ?? 0), withMomentum: false },
  { label: 'Avg Session', value: props.stats ? formatDuration(props.stats.avgDurationSeconds) : '0s', withMomentum: false },
  { label: 'Last Read', value: props.stats ? formatRelative(props.stats.lastSessionAt) : '-', withMomentum: false },
])

const currentStatusOption = computed(() => STATUS_OPTIONS.find((o) => o.value === (localReadStatus.value ?? 'unread')))
const firstReadLabel = computed(() => formatSessionDate(props.stats?.firstSessionAt ?? null))
const lastReadLabel = computed(() => formatSessionDate(props.stats?.lastSessionAt ?? null))

function handleAddSession() {
  emit('addSession')
}
</script>

<template>
  <div class="rounded-lg border border-border bg-card p-4 sm:p-5">
    <div class="flex flex-col gap-5 lg:flex-row lg:items-center lg:gap-8">
      <div class="flex items-center gap-4">
        <div class="relative shrink-0">
          <AchievementProgressRing :percent="currentProgress" color="text-primary" :size="76" />
          <span class="absolute inset-0 flex items-center justify-center text-sm font-semibold text-foreground">
            {{ progressLoaded ? progressLabel : '' }}
          </span>
        </div>

        <div class="flex min-w-0 flex-col gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button class="flex w-fit items-center gap-1.5 rounded-md text-sm font-medium text-foreground hover:text-primary transition-colors">
                <component :is="STATUS_ICONS[localReadStatus ?? 'unread']" class="size-4" :class="STATUS_COLORS[localReadStatus ?? 'unread']" />
                {{ currentStatusOption?.label }}
                <ChevronDown class="size-3.5 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem v-for="opt in STATUS_OPTIONS" :key="opt.value" @click="handleSetReadStatus(opt.value)">
                <component :is="STATUS_ICONS[opt.value]" class="size-4 mr-2" :class="STATUS_COLORS[opt.value]" />
                {{ opt.label }}
                <Check v-if="localReadStatus === opt.value" class="size-3 ml-auto text-primary" />
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span class="flex items-center gap-1">
              First Read
              <span class="font-medium text-foreground">{{ firstReadLabel }}</span>
            </span>
            <span class="flex items-center gap-1">
              Last Read
              <span class="font-medium text-foreground">{{ lastReadLabel }}</span>
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span class="flex items-center gap-1">
              Date Started
              <input
                v-if="activeDateField === 'startedAt'"
                v-model="draftDates.startedAt"
                type="date"
                :max="todayDateInput"
                :disabled="savingDates"
                class="h-6 rounded border border-input bg-background px-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                autofocus
                @blur="handleStartedSave"
                @keydown.enter.prevent="handleStartedSave"
                @keydown.esc.prevent="handleStartedCancel"
              />
              <button v-else class="font-medium text-foreground hover:text-primary transition-colors" @click="handleStartedClick">
                {{ formatDisplayDate(savedDates.startedAt) }}
              </button>
            </span>
            <span class="flex items-center gap-1">
              Date Finished
              <input
                v-if="activeDateField === 'finishedAt'"
                v-model="draftDates.finishedAt"
                type="date"
                :max="todayDateInput"
                :disabled="savingDates"
                class="h-6 rounded border border-input bg-background px-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                autofocus
                @blur="handleFinishedSave"
                @keydown.enter.prevent="handleFinishedSave"
                @keydown.esc.prevent="handleFinishedCancel"
              />
              <button v-else class="font-medium text-foreground hover:text-primary transition-colors" @click="handleFinishedClick">
                {{ formatDisplayDate(savedDates.finishedAt) }}
              </button>
            </span>
          </div>

          <p v-if="datesError" class="text-xs text-destructive">{{ datesError }}</p>

          <p v-if="etaLabel" class="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock class="size-3" />
            {{ etaLabel }}
          </p>
        </div>
      </div>

      <div class="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 transition-opacity" :class="{ 'opacity-50': loading && stats !== null }">
        <template v-if="stats === null && loading">
          <div v-for="i in 4" :key="i" class="rounded-lg border border-border bg-background/40 px-3 py-2.5">
            <div class="mb-2 h-3 w-16 rounded bg-muted animate-shimmer" />
            <div class="h-6 w-12 rounded bg-muted animate-shimmer" />
          </div>
        </template>
        <template v-else>
          <div v-for="cell in statCells" :key="cell.label" class="rounded-lg border border-border bg-background/40 px-3 py-2.5">
            <p class="mb-0.5 text-[11px] text-muted-foreground">{{ cell.label }}</p>
            <p class="flex items-center gap-1.5 text-lg font-semibold text-foreground">
              {{ cell.value }}
              <span v-if="cell.withMomentum" :title="momentum.title" class="inline-flex">
                <TrendingUp v-if="momentum.direction === 'up'" class="size-4 text-green-600" />
                <TrendingDown v-else-if="momentum.direction === 'down'" class="size-4 text-destructive" />
                <Minus v-else class="size-4 text-muted-foreground" />
              </span>
            </p>
          </div>
        </template>
      </div>

      <div class="lg:self-start">
        <button
          class="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          @click="handleAddSession"
        >
          <Plus :size="14" />
          Add session
        </button>
      </div>
    </div>
  </div>
</template>
