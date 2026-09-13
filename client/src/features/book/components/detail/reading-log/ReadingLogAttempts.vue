<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Pencil, Plus, RotateCcw, Trash2, X } from '@lucide/vue'
import type { ReadingAttempt, ReadingAttemptOutcome } from '@bookorbit/types'
import { READING_ATTEMPT_OUTCOMES } from '@bookorbit/types'
import { formatDate } from '@/i18n/formatters'
import type { ReadingAttemptDraft } from '@/features/book/composables/useReadingAttempts'

const props = defineProps<{
  attempts: ReadingAttempt[]
  loading: boolean
  saving: boolean
  error: string | null
  canManage: boolean
}>()

const emit = defineEmits<{
  save: [draft: ReadingAttemptDraft, attemptId: number | null]
  startReread: [resetProgress: boolean]
  remove: [attemptId: number]
}>()

const { t } = useI18n()

const addOpen = ref(false)
const rereadOpen = ref(false)
const editingId = ref<number | null>(null)
const confirmDeleteId = ref<number | null>(null)
const resetProgress = ref(true)
const draft = ref<{ startedOn: string; endedOn: string; outcome: ReadingAttemptOutcome }>({ startedOn: '', endedOn: '', outcome: 'completed' })
const localError = ref<string | null>(null)

/** Oldest first, so "attempt 2" means the second one the reader started. */
const ordinalById = computed(() => {
  const ordered = [...props.attempts].sort((left, right) => left.id - right.id)
  return new Map(ordered.map((attempt, index) => [attempt.id, index + 1]))
})

/** Newest first: the attempt in progress is the one worth seeing without scrolling. */
const ordered = computed(() => [...props.attempts].sort((left, right) => right.id - left.id))

const outcomeOptions = computed(() =>
  READING_ATTEMPT_OUTCOMES.map((outcome) => ({ value: outcome, label: t(`book.detail.readingLog.attempts.outcome.${outcome}`) })),
)

function outcomeLabel(attempt: ReadingAttempt): string {
  return attempt.outcome ? t(`book.detail.readingLog.attempts.outcome.${attempt.outcome}`) : t('book.detail.readingLog.attempts.outcome.inProgress')
}

function outcomeColor(attempt: ReadingAttempt): string {
  if (attempt.outcome === 'completed') return 'var(--pill-success)'
  if (attempt.outcome === 'abandoned') return 'var(--pill-warning)'
  if (attempt.outcome === 'skimmed') return 'var(--pill-kobo)'
  return 'var(--primary)'
}

function displayDate(value: string | null): string {
  if (!value) return ''
  const [year, month, day] = value.split('-').map(Number)
  return formatDate(new Date(year!, month! - 1, day!), { year: 'numeric', month: 'short', day: 'numeric' })
}

function spanLabel(attempt: ReadingAttempt): string {
  if (attempt.startedOn && attempt.endedOn)
    return t('book.detail.readingLog.attempts.spanRange', { from: displayDate(attempt.startedOn), to: displayDate(attempt.endedOn) })
  if (attempt.startedOn) return t('book.detail.readingLog.attempts.spanSince', { from: displayDate(attempt.startedOn) })
  if (attempt.endedOn) return t('book.detail.readingLog.attempts.spanEnded', { to: displayDate(attempt.endedOn) })
  return t('book.detail.readingLog.attempts.spanUnknown')
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return t('book.detail.readingLog.vitals.durationHm', { hours, minutes })
  if (minutes > 0) return t('book.detail.readingLog.vitals.durationM', { minutes })
  return t('book.detail.readingLog.vitals.durationS', { seconds: Math.floor(seconds) })
}

function resetDraft() {
  draft.value = { startedOn: '', endedOn: '', outcome: 'completed' }
  editingId.value = null
  localError.value = null
}

function handleToggleAdd() {
  resetDraft()
  rereadOpen.value = false
  addOpen.value = !addOpen.value
}

function handleToggleReread() {
  addOpen.value = false
  resetDraft()
  rereadOpen.value = !rereadOpen.value
}

function handleEdit(attempt: ReadingAttempt) {
  addOpen.value = false
  rereadOpen.value = false
  confirmDeleteId.value = null
  editingId.value = attempt.id
  draft.value = { startedOn: attempt.startedOn ?? '', endedOn: attempt.endedOn ?? '', outcome: attempt.outcome ?? 'completed' }
  localError.value = null
}

function handleCancelEdit() {
  resetDraft()
  addOpen.value = false
}

function handleSubmit() {
  if (props.saving) return
  if (draft.value.startedOn && draft.value.endedOn && draft.value.endedOn < draft.value.startedOn) {
    localError.value = t('book.detail.readingLog.attempts.endBeforeStart')
    return
  }
  localError.value = null
  emit('save', { startedOn: draft.value.startedOn || null, endedOn: draft.value.endedOn || null, outcome: draft.value.outcome }, editingId.value)
  addOpen.value = false
  editingId.value = null
}

function handleStartReread() {
  if (props.saving) return
  emit('startReread', resetProgress.value)
  rereadOpen.value = false
}

function handleDeleteClick(attempt: ReadingAttempt) {
  if (confirmDeleteId.value === attempt.id) {
    emit('remove', attempt.id)
    confirmDeleteId.value = null
    return
  }
  confirmDeleteId.value = attempt.id
}

function handleCancelDelete() {
  confirmDeleteId.value = null
}

/** The empty stage offers "record a past reading" before this card is on screen. */
function openAddForm() {
  resetDraft()
  rereadOpen.value = false
  addOpen.value = true
}

defineExpose({ openAddForm })
</script>

<template>
  <section
    class="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    :aria-label="t('book.detail.readingLog.attempts.title')"
  >
    <header class="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
      <h2 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{{ t('book.detail.readingLog.attempts.title') }}</h2>
      <p class="text-[11px] text-muted-foreground">{{ attempts.length > 0 ? attempts.length : t('book.detail.readingLog.attempts.none') }}</p>
      <div class="ml-auto flex items-center gap-1.5">
        <button
          class="inline-flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          :title="t('book.detail.readingLog.attempts.addPast')"
          :aria-label="t('book.detail.readingLog.attempts.addPast')"
          @click="handleToggleAdd"
        >
          <Plus class="size-3" />
        </button>
        <button
          v-if="canManage"
          class="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="handleToggleReread"
        >
          <RotateCcw class="size-3" />
          {{ t('book.detail.readingLog.attempts.reread') }}
        </button>
      </div>
    </header>

    <p v-if="error || localError" role="alert" class="flex-none px-3 pt-2 text-[11px] text-destructive">{{ localError ?? error }}</p>

    <div v-if="rereadOpen" class="flex-none border-b border-border bg-muted/40 px-3 py-2.5">
      <p class="text-xs font-medium text-foreground">{{ t('book.detail.readingLog.attempts.rereadPrompt') }}</p>
      <label class="mt-2 flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
        <input v-model="resetProgress" type="checkbox" class="mt-0.5 size-3.5 shrink-0 rounded border-input" />
        {{ t('book.detail.readingLog.attempts.rereadResetProgress') }}
      </label>
      <div class="mt-2.5 flex gap-2">
        <button
          class="inline-flex h-7 items-center rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          :disabled="saving"
          @click="handleStartReread"
        >
          {{ t('book.detail.readingLog.attempts.rereadConfirm') }}
        </button>
        <button
          class="inline-flex h-7 items-center rounded-md border border-border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="handleToggleReread"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>

    <div v-if="addOpen || editingId !== null" class="flex-none border-b border-border bg-muted/40 px-3 py-2.5">
      <div class="grid gap-2 sm:grid-cols-3">
        <label class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t('book.detail.readingLog.attempts.fieldStarted') }}
          <input
            v-model="draft.startedOn"
            type="date"
            class="mt-1 h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs font-normal normal-case tracking-normal text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t('book.detail.readingLog.attempts.fieldEnded') }}
          <input
            v-model="draft.endedOn"
            type="date"
            class="mt-1 h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs font-normal normal-case tracking-normal text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ t('book.detail.readingLog.attempts.fieldOutcome') }}
          <select
            v-model="draft.outcome"
            class="mt-1 h-7 w-full rounded-md border border-input bg-background px-1.5 text-xs font-normal normal-case tracking-normal text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option v-for="option in outcomeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
      </div>
      <div class="mt-2.5 flex gap-2">
        <button
          class="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          :disabled="saving"
          @click="handleSubmit"
        >
          <Check class="size-3" />
          {{ t('common.save') }}
        </button>
        <button
          class="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="handleCancelEdit"
        >
          <X class="size-3" />
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>

    <div v-if="ordered.length === 0 && loading" class="flex flex-1 flex-col gap-2 px-3 py-3" aria-hidden="true">
      <div v-for="row in 3" :key="row" class="h-8 rounded bg-muted animate-shimmer" />
    </div>

    <div v-else-if="ordered.length === 0" class="flex flex-1 flex-col items-center justify-center gap-1.5 px-4 py-6 text-center">
      <p class="text-[13px] font-medium text-foreground">{{ t('book.detail.readingLog.attempts.empty') }}</p>
      <p class="max-w-[32ch] text-xs leading-relaxed text-muted-foreground">{{ t('book.detail.readingLog.attempts.emptyHint') }}</p>
    </div>

    <ol v-if="ordered.length > 0" class="min-h-0 flex-1 overflow-y-auto px-3 py-1.5">
      <li v-for="(attempt, index) in ordered" :key="attempt.id" class="group grid grid-cols-[0.875rem_minmax(0,1fr)] gap-x-2 py-1.5">
        <span class="relative flex justify-center">
          <span
            class="absolute left-1/2 w-px -translate-x-1/2 bg-border"
            :class="[index === 0 ? 'top-2.5' : 'top-0', index === ordered.length - 1 ? 'bottom-[calc(100%-0.625rem)]' : 'bottom-0']"
            aria-hidden="true"
          />
          <span class="relative mt-1 size-2.5 rounded-full ring-2 ring-card" :style="{ backgroundColor: outcomeColor(attempt) }" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[11.5px] font-semibold" :style="{ color: outcomeColor(attempt) }">
              {{ t('book.detail.readingLog.attempts.ordinal', { index: ordinalById.get(attempt.id) }) }} · {{ outcomeLabel(attempt) }}
            </span>
            <span
              class="inline-flex h-4 items-center rounded border border-border px-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground"
            >
              {{ attempt.origin }}
            </span>
            <span class="ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <button
                class="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                :aria-label="t('book.detail.readingLog.attempts.editAria')"
                @click="handleEdit(attempt)"
              >
                <Pencil class="size-3" />
              </button>
              <template v-if="canManage">
                <button
                  v-if="confirmDeleteId === attempt.id"
                  class="inline-flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  :aria-label="t('book.detail.readingLog.attempts.cancelDeleteAria')"
                  @click="handleCancelDelete"
                >
                  <X class="size-3" />
                </button>
                <button
                  class="inline-flex size-5 items-center justify-center rounded transition-colors"
                  :class="
                    confirmDeleteId === attempt.id
                      ? 'bg-destructive/15 text-destructive ring-1 ring-destructive/40'
                      : 'text-muted-foreground hover:bg-muted hover:text-destructive'
                  "
                  :aria-label="
                    confirmDeleteId === attempt.id
                      ? t('book.detail.readingLog.attempts.confirmDeleteAria')
                      : t('book.detail.readingLog.attempts.deleteAria')
                  "
                  @click="handleDeleteClick(attempt)"
                >
                  <Trash2 class="size-3" />
                </button>
              </template>
            </span>
          </div>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground">
            <span>{{ spanLabel(attempt) }}</span>
            <template v-if="attempt.totalSessions > 0">
              <span aria-hidden="true">·</span>
              <span>{{ t('book.detail.readingLog.attempts.sessionCount', { count: attempt.totalSessions }, attempt.totalSessions) }}</span>
              <span aria-hidden="true">·</span>
              <span class="font-medium text-foreground">{{ formatDuration(attempt.totalSeconds) }}</span>
            </template>
          </p>
        </div>
      </li>
    </ol>
  </section>
</template>
