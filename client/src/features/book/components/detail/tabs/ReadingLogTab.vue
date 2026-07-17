<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ellipsis, RotateCcw } from '@lucide/vue'
import { Permission, type BookDetail, type UserBookStatus } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookReadingLog, type AddReadingSessionPayload } from '@/features/book/composables/useBookReadingLog'
import { useResetReadingState } from '@/features/book/composables/useResetReadingState'
import ResetReadingStateDialog from '@/features/book/components/ResetReadingStateDialog.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import ReadingLogHero from './ReadingLogHero.vue'
import ReadingLogJourneyChart from './ReadingLogJourneyChart.vue'
import ReadingLogHeatmap from './ReadingLogHeatmap.vue'
import ReadingLogTable from './ReadingLogTable.vue'
import ReadingLogExportMenu from './ReadingLogExportMenu.vue'
import AddSessionDialog from './AddSessionDialog.vue'
import ReadingAttemptHistory from './ReadingAttemptHistory.vue'

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

const { hasPermission } = usePermissions()
const canResetReadingState = computed(() => hasPermission(Permission.LibraryEditMetadata))
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
  const formats = props.book.files.map((f) => f.format).filter((f): f is string => f != null && f.length > 0)
  return [...new Set(formats)]
})

const hasMultipleFormats = computed(() => uniqueFormats.value.length >= 2)

const bookTitle = computed(() => props.book.title ?? t('book.detail.readingLog.untitled'))

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

function handleQuickFilterClick(event: MouseEvent) {
  const value = (event.currentTarget as HTMLElement).dataset.quickFilter as QuickFilter | undefined
  if (!value) return
  applyQuickFilter(value)
}

function handleFormatChange(e: Event) {
  const fmt = (e.target as HTMLSelectElement).value || undefined
  selectedFormat.value = fmt
  setFilters({ dateFrom: buildDateFrom(activeQuick.value), dateTo: undefined, format: fmt })
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

function handleHeroSaved(readStatus: UserBookStatus) {
  emit('saved', { ...props.book, readStatus })
}

function handleOpenResetReadingState() {
  openResetReadingStateDialog()
}

async function handleResetReadingState() {
  const result = await resetReadingState()
  if (!result) return
  await reload()
  emit('saved', { ...props.book, readStatus: result.readStatus })
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
    addDialogOpen.value = false
  } catch (e) {
    addError.value = e instanceof Error ? e.message : t('book.detail.readingLog.addSessionFailed')
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
  <div class="space-y-4">
    <div v-if="error" class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {{ error }}
    </div>

    <ReadingLogHero :book="book" :stats="stats" :loading="loading" @saved="handleHeroSaved" @add-session="handleOpenAddSession" />

    <ReadingAttemptHistory :book-id="book.id" @saved="handleHeroSaved" />

    <div class="rounded-xl border border-border/80 bg-card p-2 shadow-[var(--elevation-xs)]">
      <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="px-2 text-xs font-medium text-muted-foreground">{{ t('book.detail.readingLog.filters.show') }}</span>
          <div
            class="flex flex-wrap items-center gap-1 rounded-lg bg-muted/70 p-1"
            role="group"
            :aria-label="t('book.detail.readingLog.filters.dateRangeAria')"
          >
            <button
              v-for="qf in quickFilters"
              :key="qf.value"
              :data-quick-filter="qf.value"
              class="h-7 rounded-md px-2.5 text-xs font-medium transition-colors sm:text-sm"
              :class="
                activeQuick === qf.value ? 'bg-card text-foreground shadow-[var(--elevation-xs)]' : 'text-muted-foreground hover:text-foreground'
              "
              @click="handleQuickFilterClick"
            >
              {{ qf.label }}
            </button>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <label v-if="hasMultipleFormats" class="sr-only" for="reading-log-format">{{ t('book.detail.readingLog.table.colFormat') }}</label>
          <select
            v-if="hasMultipleFormats"
            id="reading-log-format"
            class="h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground transition-colors focus:outline-none focus:ring-1 focus:ring-primary"
            :value="selectedFormat ?? ''"
            @change="handleFormatChange"
          >
            <option value="">{{ t('book.detail.readingLog.filters.allFormats') }}</option>
            <option v-for="fmt in uniqueFormats" :key="fmt" :value="fmt">{{ fmt.toUpperCase() }}</option>
          </select>

          <ReadingLogExportMenu :book-title="bookTitle" :total="total" :export-all="exportAll" />
          <DropdownMenu v-if="canResetReadingState">
            <DropdownMenuTrigger as-child>
              <button
                class="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                :aria-label="t('book.detail.readingLog.moreActionsAria')"
              >
                <Ellipsis class="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-52">
              <DropdownMenuItem class="text-destructive focus:text-destructive" @click="handleOpenResetReadingState">
                <RotateCcw class="mr-2 size-4" />
                Reset reading state
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <ReadingLogJourneyChart :sessions="sessions" :stats="stats" :loading="loading" />
      <ReadingLogHeatmap :stats="stats" :loading="loading" :quick-filter="activeQuick" />
    </div>

    <ReadingLogTable
      :sessions="sessions"
      :total="total"
      :sort-by="sortBy"
      :sort-dir="sortDir"
      :loading="loading"
      :loading-more="loadingMore"
      :has-more="hasMore"
      :has-multiple-formats="hasMultipleFormats"
      @sort-change="handleSortChange"
      @load-more="handleLoadMore"
      @delete-session="handleDeleteSession"
    />

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
