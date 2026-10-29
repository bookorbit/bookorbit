<script setup lang="ts">
import { computed, nextTick, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { refDebounced } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { Download, History, Image } from '@lucide/vue'
import type { ReadingAttemptOutcome, ReadingHistorySort } from '@bookorbit/types'
import PageTitleRow from '@/components/page-header/PageTitleRow.vue'
import HistoryCoverWall from '../components/HistoryCoverWall.vue'
import HistoryList from '../components/HistoryList.vue'
import HistoryPeriodPicker from '../components/HistoryPeriodPicker.vue'
import HistoryRail from '../components/HistoryRail.vue'
import HistoryReadPanel from '../components/HistoryReadPanel.vue'
import HistoryToolbar from '../components/HistoryToolbar.vue'
import ExportHistoryDialog from '../components/ExportHistoryDialog.vue'
import ShareImageDialog from '../components/ShareImageDialog.vue'
import { updateReadRating, type ReadingHistoryListParams } from '../api/reading-history.api'
import { useReadingHistoryFilters, type ReadingHistoryView } from '../composables/useReadingHistoryFilters'
import { useReadingHistoryList } from '../composables/useReadingHistoryList'
import { useReadingHistorySummary } from '../composables/useReadingHistorySummary'
import { useReadMarks } from '../composables/useReadMarks'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { filters, currentYear, setYear, toggleQuarter, toggleOutcome, clearBook } = useReadingHistoryFilters()

const search = refDebounced(toRef(filters, 'search'), 250)
const listParams = computed<ReadingHistoryListParams>(() => ({
  year: filters.year,
  quarter: filters.quarter,
  outcomes: [...filters.outcomes],
  search: search.value,
  bookId: filters.bookId,
  sort: filters.sort,
}))
const period = computed(() => ({ year: filters.year, quarter: filters.quarter }))

const list = useReadingHistoryList(listParams)
const { summary, refresh: refreshSummary } = useReadingHistorySummary(period)
const marks = useReadMarks()

const openId = ref<number | null>(null)
const ratingBusyId = ref<number | null>(null)
const shareOpen = ref(false)
const exportOpen = ref(false)
const listView = ref<InstanceType<typeof HistoryList> | null>(null)
const wallView = ref<InstanceType<typeof HistoryCoverWall> | null>(null)
let lastRange: [number, number] | null = null

const now = new Date()
const today = { year: now.getFullYear(), month: now.getMonth() + 1 }

const periodLabel = computed(() => {
  if (filters.year === null) return t('readingHistory.period.allTime')
  return filters.quarter ? t('readingHistory.period.quarterYear', { quarter: filters.quarter, year: filters.year }) : String(filters.year)
})
const selectedItem = computed(() => (filters.view === 'covers' && openId.value !== null ? list.findItem(openId.value) : null))
const bookTitle = computed(() => (filters.bookId === null ? null : (list.itemAt(0)?.title ?? t('readingHistory.toolbar.oneBook'))))
const outcomeCounts = computed(() => summary.value?.outcomes ?? null)
const filtered = computed(
  () => !!search.value.trim() || filters.bookId !== null || filters.quarter !== null || filters.outcomes.join(',') !== 'completed',
)
const showEmpty = computed(() => list.loaded.value && !list.loading.value && !list.error.value && list.total.value === 0)

watch([listParams, () => filters.view], () => {
  openId.value = null
})

// Rows already on screen when new data lands still need their pages.
watch(list.loading, (loading) => {
  if (!loading && lastRange) list.ensureRange(lastRange[0], lastRange[1])
})

// A link from the dashboard or a chart can name a month to open on.
watch(
  () => list.loaded.value && !list.loading.value,
  async (ready) => {
    const month = typeof route.query.month === 'string' ? route.query.month : null
    if (!ready || !month) return
    await nextTick()
    ;(filters.view === 'covers' ? wallView.value : listView.value)?.scrollToMonth(month)
    void router.replace({ query: Object.fromEntries(Object.entries(route.query).filter(([key]) => key !== 'month')) })
  },
  { immediate: true },
)

function handleRange(start: number, end: number) {
  lastRange = [start, end]
  list.ensureRange(start, end)
}

function handleToggle(attemptId: number) {
  openId.value = openId.value === attemptId ? null : attemptId
}

function handleSelect(attemptId: number) {
  openId.value = attemptId
}

function handleClosePanel() {
  openId.value = null
}

function handleLoadMarks(attemptId: number) {
  void marks.load(attemptId)
}

function marksFor(attemptId: number) {
  return marks.get(attemptId)
}

async function handleRate(attemptId: number, rating: number | null) {
  const item = list.findItem(attemptId)
  if (!item || ratingBusyId.value !== null) return
  const previous = item.rating
  ratingBusyId.value = attemptId
  list.patchItem(attemptId, { rating })
  try {
    await updateReadRating(attemptId, rating)
    refreshSummary()
  } catch {
    list.patchItem(attemptId, { rating: previous })
    toast.error(t('readingHistory.rating.failed'))
  } finally {
    ratingBusyId.value = null
  }
}

function handleYear(year: number | null) {
  setYear(year)
}

function handleQuarter(quarter: number) {
  toggleQuarter(quarter)
}

function handleOutcome(outcome: ReadingAttemptOutcome) {
  toggleOutcome(outcome)
}

function handleSort(sort: ReadingHistorySort) {
  filters.sort = sort
}

/** Switching views keeps the read at the top of the screen there, rather than wherever the new view's height leaves the page. */
async function handleView(view: ReadingHistoryView) {
  if (view === filters.view) return
  const shell = document.querySelector<HTMLElement>('.app-shell-scroll')
  const top = shell?.scrollTop ?? 0
  const anchor = (filters.view === 'covers' ? wallView.value : listView.value)?.topAnchor() ?? null
  filters.view = view
  await nextTick()
  if (anchor) (view === 'covers' ? wallView.value : listView.value)?.scrollToAnchor(anchor)
  else shell?.scrollTo({ top, behavior: 'instant' })
}

function handleClearBook() {
  clearBook()
}

function handleJumpMonth(month: string) {
  ;(filters.view === 'covers' ? wallView.value : listView.value)?.scrollToMonth(month)
}

function handleShowUndated() {
  setYear(null)
}

function handleOpenShare() {
  shareOpen.value = true
}

function handleOpenExport() {
  exportOpen.value = true
}

function handleRetry() {
  list.refresh()
  refreshSummary()
}
</script>

<template>
  <div class="flex w-full flex-col gap-4 pt-2 pb-4">
    <PageTitleRow class="shrink-0" :eyebrow="t('components.sidebar.zones.reading')" :title="t('readingHistory.title')" :icon="History">
      <template #inline>
        <HistoryPeriodPicker
          :years="summary?.years ?? []"
          :year="filters.year"
          :quarter="filters.quarter"
          :current-year="currentYear"
          @year="handleYear"
          @quarter="handleQuarter"
        />
      </template>
      <template #actions>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:bg-accent max-sm:size-8 max-sm:justify-center max-sm:px-0"
            :aria-label="t('readingHistory.actions.share')"
            @click="handleOpenShare"
          >
            <Image class="size-3.5" aria-hidden="true" /><span class="max-sm:hidden">{{ t('readingHistory.actions.share') }}</span>
          </button>
          <button
            type="button"
            class="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-foreground transition-colors hover:bg-accent max-sm:size-8 max-sm:justify-center max-sm:px-0"
            :aria-label="t('readingHistory.actions.export')"
            @click="handleOpenExport"
          >
            <Download class="size-3.5" aria-hidden="true" /><span class="max-sm:hidden">{{ t('readingHistory.actions.export') }}</span>
          </button>
        </div>
      </template>
    </PageTitleRow>

    <div class="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_21rem] xl:items-start">
      <section
        class="order-2 min-w-0 rounded-xl border border-border bg-card xl:order-1"
        :aria-label="t('readingHistory.listLabel', { period: periodLabel })"
        :aria-busy="list.loading.value"
      >
        <HistoryToolbar
          v-model:search="filters.search"
          :outcomes="filters.outcomes"
          :counts="outcomeCounts"
          :sort="filters.sort"
          :view="filters.view"
          :book-title="bookTitle"
          @outcome="handleOutcome"
          @sort="handleSort"
          @view="handleView"
          @clear-book="handleClearBook"
        />
        <div class="relative h-0.5" aria-hidden="true">
          <span v-if="list.loading.value && list.loaded.value" class="history-progress absolute inset-y-0 start-0 w-1/3 rounded-full bg-primary" />
        </div>
        <div class="px-3 pb-2 md:px-4">
          <div
            v-if="list.error.value"
            role="alert"
            class="my-6 rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {{ t('readingHistory.error') }}
            <button type="button" class="ms-2 font-semibold underline underline-offset-2" @click="handleRetry">
              {{ t('readingHistory.retry') }}
            </button>
          </div>
          <div v-else-if="showEmpty" class="flex flex-col items-center gap-2 px-4 py-16 text-center">
            <History class="size-8 text-muted-foreground" aria-hidden="true" />
            <p class="text-sm font-semibold text-foreground">
              {{ filtered ? t('readingHistory.empty.filteredTitle') : t('readingHistory.empty.title') }}
            </p>
            <p class="max-w-sm text-xs leading-5 text-muted-foreground">
              {{ filtered ? t('readingHistory.empty.filteredBody') : t('readingHistory.empty.body') }}
            </p>
          </div>
          <div v-else-if="!list.loaded.value" class="flex flex-col gap-3 py-4" aria-hidden="true">
            <span v-for="row in 6" :key="row" class="h-[68px] rounded-lg bg-muted/50" />
          </div>
          <HistoryList
            v-else-if="filters.view === 'list'"
            ref="listView"
            :rows="list.rows.value"
            :item-at="list.itemAt"
            :open-id="openId"
            :marks-for="marksFor"
            :rating-busy-id="ratingBusyId"
            @range="handleRange"
            @toggle="handleToggle"
            @load-marks="handleLoadMarks"
            @rate="handleRate"
          />
          <HistoryCoverWall
            v-else
            ref="wallView"
            :months="list.months.value"
            :item-at="list.itemAt"
            :selected-id="openId"
            class="pt-1"
            @range="handleRange"
            @select="handleSelect"
          />
        </div>
      </section>

      <div class="order-1 min-w-0 xl:sticky xl:top-3 xl:order-2 xl:max-h-[calc(100svh-1.5rem)] xl:overflow-y-auto xl:[scrollbar-width:thin]">
        <HistoryRail
          :class="selectedItem ? 'xl:hidden' : undefined"
          :summary="summary"
          :year="filters.year"
          :quarter="filters.quarter"
          :period-label="periodLabel"
          :today="today"
          @jump-month="handleJumpMonth"
          @quarter="handleQuarter"
          @show-undated="handleShowUndated"
        />
        <HistoryReadPanel
          v-if="selectedItem"
          :item="selectedItem"
          :marks="marksFor(selectedItem.id)"
          :rating-busy="ratingBusyId === selectedItem.id"
          @close="handleClosePanel"
          @load-marks="handleLoadMarks"
          @rate="handleRate"
        />
      </div>
    </div>

    <ShareImageDialog v-model:open="shareOpen" :year="filters.year ?? currentYear" :quarter="filters.quarter" />
    <ExportHistoryDialog v-model:open="exportOpen" :params="listParams" :period-label="periodLabel" :total="list.total.value" />
  </div>
</template>

<style scoped>
.history-progress {
  animation: history-progress 1.1s ease-in-out infinite;
}

@media (prefers-reduced-motion: reduce) {
  .history-progress {
    animation: none;
  }
}

@keyframes history-progress {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(300%);
  }
}
</style>
