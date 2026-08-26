<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, Clock, Minus, Plus, TrendingDown, TrendingUp } from '@lucide/vue'
import type { BookDetail, BookReadingSessionStats, ReadStatus, UserBookStatus } from '@bookorbit/types'
import { isAudioFormat } from '@bookorbit/types'
import { api } from '@/lib/api'
import { formatDate, formatNumber, formatRelativeFromNow } from '@/i18n/formatters'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { STATUS_COLORS, STATUS_ICONS, STATUS_OPTIONS, useBookStatus } from '@/features/book/composables/useBookStatus'
import { useReadingLogInsights } from '@/features/book/composables/useReadingLogInsights'
import AchievementProgressRing from '@/features/achievements/components/AchievementProgressRing.vue'
import ReadingLogSourceSplit from './ReadingLogSourceSplit.vue'

const props = defineProps<{
  book: BookDetail
  stats: BookReadingSessionStats | null
  loading: boolean
  /** The empty stage carries its own call to action; two of them read as a mistake. */
  hideAddSession?: boolean
}>()

const emit = defineEmits<{
  saved: [readStatus: UserBookStatus]
  addSession: []
}>()

const { t } = useI18n()
const { setStatus, updateStatus } = useBookStatus()

const statsRef = computed(() => props.stats)
const { activeDays, spanDays, pacePercentPerHour, momentum } = useReadingLogInsights(statsRef)

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
  if (!dateKey) return t('book.detail.readingLog.vitals.notSet')
  const [year, month, day] = dateKey.split('-').map(Number)
  return formatDate(new Date(year!, month! - 1, day!), { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return t('book.detail.readingLog.vitals.durationM', { minutes: 0 })
  if (seconds < 60) return t('book.detail.readingLog.vitals.durationS', { seconds: Math.round(seconds) })
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours > 0 ? t('book.detail.readingLog.vitals.durationHm', { hours, minutes }) : t('book.detail.readingLog.vitals.durationM', { minutes })
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
    return t('book.detail.readingLog.hero.dateErrors.finishBeforeStartWithDate', { date: formatDisplayDate(values.startedAt) })
  return null
}

function dateSaveError(error: unknown): string {
  const errorCode = typeof error === 'object' && error !== null && 'errorCode' in error ? (error as { errorCode?: unknown }).errorCode : null
  if (errorCode === 'READING_DATE_STARTED_IN_FUTURE') return t('book.detail.readingLog.hero.dateErrors.startFuture')
  if (errorCode === 'READING_DATE_FINISHED_IN_FUTURE') return t('book.detail.readingLog.hero.dateErrors.finishFuture')
  if (errorCode === 'READING_DATES_INVALID_ORDER') return t('book.detail.readingLog.hero.dateErrors.finishBeforeStart')
  return t('book.detail.readingLog.hero.dateErrors.saveFailed')
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
  const previous = localReadStatus.value
  localReadStatus.value = status
  try {
    applyReadStatusUpdate(await setStatus(props.book.id, status))
  } catch {
    localReadStatus.value = previous
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
    applyReadStatusUpdate(await updateStatus(props.book.id, patch))
    activeDateField.value = null
  } catch (error) {
    datesError.value = dateSaveError(error)
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

const readerProgress = ref(0)
const progressLoaded = ref(false)

async function loadProgress() {
  progressLoaded.value = false
  const bookId = props.book.id
  const hasAudio = props.book.files.some((file) => file.format != null && isAudioFormat(file.format))
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
    readerProgress.value = Math.min(100, Math.max(0, max))
  } catch {
    readerProgress.value = 0
  } finally {
    progressLoaded.value = true
  }
}

watch(() => props.book.id, loadProgress, { immediate: true })

// The stored reading position only moves when a reader or a synced device writes it, so a book
// whose progress was only ever logged by hand has none. Sessions are the other observation of how
// far the book got, combined the same way as the ebook and audio positions.
const loggedProgress = computed(() => {
  const value = props.stats?.latestEndProgress
  if (value == null || !Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
})

const currentProgress = computed(() => Math.max(readerProgress.value, loggedProgress.value))

const progressLabel = computed(() => {
  const value = currentProgress.value
  if (value > 0 && value < 1) return '<1%'
  if (value > 99 && value < 100) return '>99%'
  return `${Math.round(value)}%`
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
  const hours = Math.floor(rounded / 60)
  const minutes = rounded % 60
  if (hours <= 0) return t('book.detail.readingLog.hero.eta.minutes', { m: minutes })
  if (minutes === 0) return t('book.detail.readingLog.hero.eta.hours', { h: hours })
  return t('book.detail.readingLog.hero.eta.hoursMinutes', { h: hours, m: minutes })
})

const momentumTitle = computed(() => {
  const value = momentum.value
  if (!value.hasActivity) return t('book.detail.readingLog.hero.momentum.none')
  if (value.isNew) return t('book.detail.readingLog.hero.momentum.new')
  if (value.percent == null || value.percent === 0) return t('book.detail.readingLog.hero.momentum.flat')
  if (value.percent > 0) return t('book.detail.readingLog.hero.momentum.up', { pct: value.percent })
  return t('book.detail.readingLog.hero.momentum.down', { pct: value.percent })
})

const formatLine = computed(() =>
  [...new Set(props.book.files.map((file) => file.format).filter((format): format is string => format != null && format.length > 0))]
    .map((format) => format.toUpperCase())
    .join(' · '),
)

const currentStatusOption = computed(() => STATUS_OPTIONS.find((option) => option.value === (localReadStatus.value ?? 'unread')))

// A book with no sessions still answers with a stats object of zeros, so a null one means the
// first load has not landed. Printing its zeros claims the book is unread until the real count
// arrives; the dash the pace and last-read rows already use says "not known yet" instead.
const statsPending = computed(() => props.stats === null)

const ledgerRows = computed(() => [
  {
    key: 'total',
    label: t('book.detail.readingLog.vitals.totalTime'),
    value: statsPending.value ? '-' : formatDuration(props.stats?.totalSeconds ?? 0),
    withMomentum: true,
  },
  {
    key: 'sessions',
    label: t('book.detail.readingLog.vitals.sessions'),
    value: statsPending.value ? '-' : formatNumber(props.stats?.totalSessions ?? 0),
    withMomentum: false,
  },
  {
    key: 'average',
    label: t('book.detail.readingLog.vitals.avgSession'),
    value: statsPending.value ? '-' : formatDuration(props.stats?.avgDurationSeconds ?? 0),
    withMomentum: false,
  },
  {
    key: 'activeDays',
    label: t('book.detail.readingLog.vitals.activeDays'),
    value: statsPending.value
      ? '-'
      : spanDays.value > 0
        ? t('book.detail.readingLog.vitals.activeDaysOf', { active: activeDays.value, total: spanDays.value })
        : '0',
    withMomentum: false,
  },
  {
    key: 'pace',
    label: t('book.detail.readingLog.vitals.pace'),
    value: pacePercentPerHour.value == null ? '-' : t('book.detail.readingLog.vitals.pacePerHour', { percent: pacePercentPerHour.value.toFixed(1) }),
    withMomentum: false,
  },
  {
    key: 'lastRead',
    label: t('book.detail.readingLog.vitals.lastRead'),
    value: props.stats?.lastSessionAt ? formatRelativeFromNow(Date.parse(props.stats.lastSessionAt)) : '-',
    withMomentum: false,
  },
])

function handleAddSession() {
  emit('addSession')
}
</script>

<template>
  <section class="flex min-h-0 flex-col rounded-xl border border-border bg-card px-3.5 py-3" :aria-label="t('book.detail.readingLog.vitals.aria')">
    <div class="flex shrink-0 items-center gap-3">
      <div class="relative flex size-15 shrink-0 items-center justify-center">
        <AchievementProgressRing :percent="currentProgress" color="text-primary" :size="58" />
        <span class="absolute inset-0 flex items-center justify-center text-xs font-semibold text-foreground">
          {{ progressLoaded ? progressLabel : '' }}
        </span>
      </div>

      <div class="min-w-0 flex-1">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              class="flex max-w-full items-center gap-1.5 rounded-md text-sm font-semibold text-foreground transition-colors hover:text-primary"
            >
              <component
                :is="STATUS_ICONS[localReadStatus ?? 'unread']"
                class="size-4 shrink-0"
                :class="STATUS_COLORS[localReadStatus ?? 'unread']"
              />
              <span class="truncate">{{ currentStatusOption?.label }}</span>
              <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem v-for="option in STATUS_OPTIONS" :key="option.value" @click="handleSetReadStatus(option.value)">
              <component :is="STATUS_ICONS[option.value]" class="mr-2 size-4" :class="STATUS_COLORS[option.value]" />
              {{ option.label }}
              <Check v-if="localReadStatus === option.value" class="ml-auto size-3 text-primary" />
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <p v-if="etaLabel" class="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Clock class="size-3 shrink-0" />
          <span class="truncate">{{ etaLabel }}</span>
        </p>
        <p v-else-if="formatLine" class="mt-1 truncate text-xs text-muted-foreground">{{ formatLine }}</p>
      </div>
    </div>

    <dl class="mt-3 shrink-0">
      <div class="flex h-[26px] items-center gap-2">
        <dt class="text-xs leading-4 text-muted-foreground">{{ t('book.detail.readingLog.vitals.started') }}</dt>
        <dd class="ml-auto flex items-center">
          <input
            v-if="activeDateField === 'startedAt'"
            v-model="draftDates.startedAt"
            type="date"
            :max="todayDateInput"
            :disabled="savingDates"
            class="h-6 rounded border border-input bg-background px-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            :aria-label="t('book.detail.readingLog.vitals.editStarted')"
            autofocus
            @blur="handleStartedSave"
            @keydown.enter.prevent="handleStartedSave"
            @keydown.esc.prevent="handleStartedCancel"
          />
          <button
            v-else
            class="border-b border-dashed border-border text-xs font-semibold leading-4 text-foreground transition-colors hover:border-primary hover:text-primary"
            :aria-label="t('book.detail.readingLog.vitals.editStarted')"
            @click="handleStartedClick"
          >
            {{ formatDisplayDate(savedDates.startedAt) }}
          </button>
        </dd>
      </div>
      <div class="flex h-[26px] items-center gap-2 border-t border-border/60">
        <dt class="text-xs leading-4 text-muted-foreground">{{ t('book.detail.readingLog.vitals.finished') }}</dt>
        <dd class="ml-auto flex items-center">
          <input
            v-if="activeDateField === 'finishedAt'"
            v-model="draftDates.finishedAt"
            type="date"
            :max="todayDateInput"
            :disabled="savingDates"
            class="h-6 rounded border border-input bg-background px-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            :aria-label="t('book.detail.readingLog.vitals.editFinished')"
            autofocus
            @blur="handleFinishedSave"
            @keydown.enter.prevent="handleFinishedSave"
            @keydown.esc.prevent="handleFinishedCancel"
          />
          <button
            v-else
            class="border-b border-dashed border-border text-xs font-semibold leading-4 text-foreground transition-colors hover:border-primary hover:text-primary"
            :aria-label="t('book.detail.readingLog.vitals.editFinished')"
            @click="handleFinishedClick"
          >
            {{ formatDisplayDate(savedDates.finishedAt) }}
          </button>
        </dd>
      </div>
    </dl>
    <p v-if="datesError" role="alert" class="mt-1 text-xs text-destructive">{{ datesError }}</p>

    <div class="mt-2.5 min-h-0 flex-1 overflow-y-auto border-t border-border pt-1" :class="{ 'opacity-50': loading && stats !== null }">
      <dl>
        <div v-for="row in ledgerRows" :key="row.key" class="flex h-[26px] items-center gap-2 border-t border-border/60 first:border-t-0">
          <dt class="text-xs leading-4 text-muted-foreground">{{ row.label }}</dt>
          <dd class="ml-auto flex items-center gap-1 text-xs font-semibold leading-4 tabular-nums text-foreground">
            <span v-if="row.withMomentum" :title="momentumTitle" class="inline-flex">
              <TrendingUp v-if="momentum.direction === 'up'" class="size-3.5 text-primary" />
              <TrendingDown v-else-if="momentum.direction === 'down'" class="size-3.5 text-amber-500" />
              <Minus v-else class="size-3.5 text-muted-foreground" />
            </span>
            {{ row.value }}
          </dd>
        </div>
      </dl>
    </div>

    <div v-if="(stats?.bySource.length ?? 0) >= 2" class="mt-3 shrink-0">
      <h3 class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {{ t('book.detail.readingLog.vitals.whereYouRead') }}
      </h3>
      <ReadingLogSourceSplit :stats="stats" variant="stacked" />
    </div>

    <button
      v-if="!hideAddSession"
      class="mt-3 inline-flex h-8 w-full shrink-0 items-center justify-center gap-1.5 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      @click="handleAddSession"
    >
      <Plus class="size-3.5" />
      {{ t('book.detail.readingLog.vitals.addSession') }}
    </button>
  </section>
</template>
