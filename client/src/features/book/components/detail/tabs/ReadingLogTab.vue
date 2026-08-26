<script setup lang="ts">
import { computed, nextTick, onActivated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ellipsis, RotateCcw } from '@lucide/vue'
import { Permission, type BookDetail, type UserBookStatus } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useDeferredLoading } from '@/composables/useDeferredLoading'
import { useBookReadingLog, type AddReadingSessionPayload } from '@/features/book/composables/useBookReadingLog'
import { useReadingAttempts, type ReadingAttemptDraft } from '@/features/book/composables/useReadingAttempts'
import { useResetReadingState } from '@/features/book/composables/useResetReadingState'
import ResetReadingStateDialog from '@/features/book/components/ResetReadingStateDialog.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import ReadingLogVitals from '../reading-log/ReadingLogVitals.vue'
import ReadingLogLedger from '../reading-log/ReadingLogLedger.vue'
import ReadingLogAttempts from '../reading-log/ReadingLogAttempts.vue'
import ReadingLogRecords from '../reading-log/ReadingLogRecords.vue'
import ReadingLogBand from '../reading-log/ReadingLogBand.vue'
import ReadingLogEmptyStage from '../reading-log/ReadingLogEmptyStage.vue'
import ReadingLogExportMenu from './ReadingLogExportMenu.vue'
import AddSessionDialog from './AddSessionDialog.vue'

// Named for the KeepAlive `include` list in BookDetailView.
defineOptions({ name: 'ReadingLogTab' })

const props = defineProps<{ book: BookDetail }>()

const emit = defineEmits<{
  saved: [book: BookDetail]
}>()

const { t } = useI18n()

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
  reload,
  exportAll,
  loadMore,
  setSort,
  setFilters,
} = useBookReadingLog(bookIdRef)

const {
  attempts,
  loading: attemptsLoading,
  saving: attemptsSaving,
  error: attemptsError,
  load: reloadAttempts,
  save: saveAttempt,
  startReread,
  remove: removeAttempt,
} = useReadingAttempts(bookIdRef)

// The tab is kept alive, so returning to it shows the rows it already had rather than replaying
// the load. A sync can land a session while another tab is open, so revalidate on the way back -
// silently, because a skeleton over rows that are already correct is the flash this avoids.
let activatedBefore = false
onActivated(() => {
  if (!activatedBefore) {
    activatedBefore = true
    return
  }
  void reload({ silent: true })
  void reloadAttempts({ silent: true })
})

const { hasPermission } = usePermissions()
const canManageReadingState = computed(() => hasPermission(Permission.LibraryEditMetadata))
const {
  open: resetDialogOpen,
  resetting: resettingReadingState,
  error: resetReadingStateError,
  openDialog: openResetReadingStateDialog,
  closeDialog: closeResetReadingStateDialog,
  resetReadingState,
} = useResetReadingState(bookIdRef)

type QuickFilter = 'all' | 'last30' | 'last90' | 'thisYear'
const activeQuick = ref<QuickFilter>('all')
const selectedFormat = ref<string | undefined>(undefined)

const uniqueFormats = computed(() => {
  const formats = props.book.files.map((file) => file.format).filter((format): format is string => format != null && format.length > 0)
  return [...new Set(formats)]
})

const hasMultipleFormats = computed(() => uniqueFormats.value.length >= 2)

const bookTitle = computed(() => props.book.title ?? t('book.detail.readingLog.untitled'))

// A book nobody has read has nothing for the ledger, the attempts card or the band to say.
// One panel that explains where sessions come from beats three that each say "nothing yet".
const emptyStageDismissed = ref(false)
const attemptsRef = ref<InstanceType<typeof ReadingLogAttempts> | null>(null)

// Both lists have to have landed before the tab can claim there is nothing here: deciding on the
// sessions alone flashes the empty stage and then jumps back to the full layout.
const blank = computed(
  () =>
    !emptyStageDismissed.value && !loading.value && !attemptsLoading.value && (stats.value?.totalSessions ?? 0) === 0 && attempts.value.length === 0,
)

// The data decides which of two layouts the tab settles into, so until the first load lands there
// is no shape to commit to. Latched, because a later filter reload must not throw the pane back
// to the placeholder. The placeholder covers the same box either settled layout puts there, so
// whichever way it resolves nothing moves.
const resolved = ref(false)
watch([loading, attemptsLoading], ([sessionsBusy, attemptsBusy]) => {
  if (!sessionsBusy && !attemptsBusy) resolved.value = true
})
const firstLoadPending = computed(() => !resolved.value)
const showFirstLoadSkeleton = useDeferredLoading(firstLoadPending)

function buildDateFrom(quick: QuickFilter): string | undefined {
  const now = new Date()
  if (quick === 'last30') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
  if (quick === 'last90') return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString()
  if (quick === 'thisYear') return new Date(now.getFullYear(), 0, 1).toISOString()
  return undefined
}

function applyQuickFilter(quick: QuickFilter) {
  activeQuick.value = quick
  setFilters({ dateFrom: buildDateFrom(quick), dateTo: undefined, format: selectedFormat.value })
}

function handleQuickFilterClick(event: MouseEvent) {
  const value = (event.currentTarget as HTMLElement).dataset.quickFilter as QuickFilter | undefined
  if (!value) return
  applyQuickFilter(value)
}

function handleFormatChange(event: Event) {
  const format = (event.target as HTMLSelectElement).value || undefined
  selectedFormat.value = format
  setFilters({ dateFrom: buildDateFrom(activeQuick.value), dateTo: undefined, format })
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

function handleVitalsSaved(readStatus: UserBookStatus) {
  emit('saved', { ...props.book, readStatus })
}

function handleOpenResetReadingState() {
  openResetReadingStateDialog()
}

async function handleResetReadingState() {
  const result = await resetReadingState()
  if (!result) return
  await reload()
  await reloadAttempts()
  emit('saved', { ...props.book, readStatus: result.readStatus })
}

async function handleSaveAttempt(draft: ReadingAttemptDraft, attemptId: number | null) {
  await saveAttempt(draft, attemptId)
  await reload()
}

async function handleStartReread(resetProgress: boolean) {
  const readStatus = await startReread(resetProgress)
  if (!readStatus) return
  await reload()
  emit('saved', { ...props.book, readStatus })
}

async function handleRemoveAttempt(attemptId: number) {
  await removeAttempt(attemptId)
  await reload()
}

function handleRecordPast() {
  emptyStageDismissed.value = true
  void nextTick(() => attemptsRef.value?.openAddForm())
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
    await reloadAttempts()
    addDialogOpen.value = false
  } catch (cause) {
    addError.value = cause instanceof Error ? cause.message : t('book.detail.readingLog.addSessionFailed')
  } finally {
    addSaving.value = false
  }
}

const quickFilters = computed<{ label: string; value: QuickFilter }[]>(() => [
  { label: t('book.detail.readingLog.filters.allTime'), value: 'all' },
  { label: t('book.detail.readingLog.filters.last30'), value: 'last30' },
  { label: t('book.detail.readingLog.filters.last90'), value: 'last90' },
  { label: t('book.detail.readingLog.filters.thisYear'), value: 'thisYear' },
])
</script>

<template>
  <div class="flex flex-col gap-4 xl:h-full xl:min-h-0">
    <div v-if="error" role="alert" class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {{ error }}
    </div>

    <!--
      Direction A+. Below xl the tab is a single scrolling column. From xl the pane owns the
      height: vitals, the session ledger and the attempts/records stack fill row one, and the
      one panel that genuinely wants width - the progress band - takes row two.
    -->
    <div
      class="flex flex-col gap-4 xl:grid xl:min-h-0 xl:flex-1 xl:gap-x-5 xl:gap-y-4"
      :class="
        blank && resolved
          ? 'xl:grid-cols-[17rem_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)]'
          : 'xl:grid-cols-[17rem_minmax(0,1fr)_19.25rem] xl:grid-rows-[minmax(0,1fr)_13.5rem]'
      "
    >
      <ReadingLogVitals
        class="xl:col-start-1 xl:row-start-1"
        :class="{ 'xl:row-span-2': !resolved }"
        :book="book"
        :stats="stats"
        :loading="loading"
        :hide-add-session="blank || !resolved"
        @saved="handleVitalsSaved"
        @add-session="handleOpenAddSession"
      />

      <div
        v-if="!resolved"
        class="min-h-80 rounded-xl border border-border bg-card xl:col-start-2 xl:col-span-2 xl:row-start-1 xl:row-span-2 xl:min-h-0"
        aria-busy="true"
      >
        <div v-if="showFirstLoadSkeleton" class="flex flex-col gap-2 px-3 py-3" aria-hidden="true">
          <div v-for="row in 6" :key="row" class="h-4 rounded bg-muted animate-shimmer" />
        </div>
      </div>

      <ReadingLogEmptyStage
        v-else-if="blank"
        class="xl:col-start-2 xl:row-start-1"
        @add-session="handleOpenAddSession"
        @record-past="handleRecordPast"
      />

      <template v-else>
        <ReadingLogLedger
          class="max-h-[28rem] xl:col-start-2 xl:row-start-1 xl:max-h-none"
          :book-id="book.id"
          :sessions="sessions"
          :total="total"
          :sort-by="sortBy"
          :sort-dir="sortDir"
          :loading="loading"
          :loading-more="loadingMore"
          :has-more="hasMore"
          :attempts="attempts"
          @sort-change="handleSortChange"
          @load-more="handleLoadMore"
          @delete-session="handleDeleteSession"
        >
          <template #actions>
            <div
              class="flex items-center gap-0.5 rounded-lg border border-border bg-muted/60 p-0.5"
              role="group"
              :aria-label="t('book.detail.readingLog.filters.dateRangeAria')"
            >
              <button
                v-for="quick in quickFilters"
                :key="quick.value"
                :data-quick-filter="quick.value"
                class="h-6 rounded-md px-2 text-[11px] font-medium transition-colors"
                :class="
                  activeQuick === quick.value ? 'bg-card text-foreground shadow-[var(--elevation-xs)]' : 'text-muted-foreground hover:text-foreground'
                "
                @click="handleQuickFilterClick"
              >
                {{ quick.label }}
              </button>
            </div>

            <label v-if="hasMultipleFormats" class="sr-only" for="reading-log-format">{{ t('book.detail.readingLog.ledger.colFormat') }}</label>
            <select
              v-if="hasMultipleFormats"
              id="reading-log-format"
              class="h-6 rounded-md border border-border bg-background px-1.5 text-[11px] font-medium text-muted-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-primary"
              :value="selectedFormat ?? ''"
              @change="handleFormatChange"
            >
              <option value="">{{ t('book.detail.readingLog.filters.allFormats') }}</option>
              <option v-for="format in uniqueFormats" :key="format" :value="format">{{ format.toUpperCase() }}</option>
            </select>

            <ReadingLogExportMenu :book-title="bookTitle" :total="total" :export-all="exportAll" />

            <DropdownMenu v-if="canManageReadingState">
              <DropdownMenuTrigger as-child>
                <button
                  class="inline-flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  :aria-label="t('book.detail.readingLog.moreActionsAria')"
                >
                  <Ellipsis class="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-52">
                <DropdownMenuItem class="text-destructive focus:text-destructive" @click="handleOpenResetReadingState">
                  <RotateCcw class="mr-2 size-4" />
                  {{ t('book.detail.readingLog.resetReadingState') }}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </template>
        </ReadingLogLedger>

        <div class="flex min-h-0 flex-col gap-4 xl:col-start-3 xl:row-start-1">
          <ReadingLogAttempts
            ref="attemptsRef"
            class="max-h-80 xl:min-h-0 xl:max-h-none xl:flex-1"
            :attempts="attempts"
            :loading="attemptsLoading"
            :saving="attemptsSaving"
            :error="attemptsError"
            :can-manage="canManageReadingState"
            @save="handleSaveAttempt"
            @start-reread="handleStartReread"
            @remove="handleRemoveAttempt"
          />
          <ReadingLogRecords class="shrink-0" :stats="stats" :max="4" />
        </div>

        <ReadingLogBand class="h-56 xl:col-span-full xl:row-start-2 xl:h-auto" :sessions="sessions" :stats="stats" :loading="loading" />
      </template>
    </div>

    <AddSessionDialog
      :open="addDialogOpen"
      :formats="uniqueFormats"
      :saving="addSaving"
      :error="addError"
      @close="handleCloseAddSession"
      @submit="handleAddSessionSubmit"
    />

    <ResetReadingStateDialog
      :open="resetDialogOpen"
      :resetting="resettingReadingState"
      :error="resetReadingStateError"
      @close="closeResetReadingStateDialog"
      @confirm="handleResetReadingState"
    />
  </div>
</template>
