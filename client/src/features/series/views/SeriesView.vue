<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ChevronDown, Library, Rows3, X } from '@lucide/vue'

import BrowseHeader from '@/components/browse-header/BrowseHeader.vue'
import BrowseSearchField from '@/components/browse-header/BrowseSearchField.vue'
import BrowseSortControl from '@/components/browse-header/BrowseSortControl.vue'
import BrowseInlineGroup from '@/components/browse-header/BrowseInlineGroup.vue'
import BrowseLibraryPicker from '@/components/browse-header/BrowseLibraryPicker.vue'
import BrowseViewControls from '@/components/browse-header/BrowseViewControls.vue'
import { barButton, barButtonOn, barDivider } from '@/components/browse-header/browse-header'
import ViewHeaderDisplayControls from '@/components/view-header/ViewHeaderDisplayControls.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatNumber } from '@/i18n/formatters'
import { cn } from '@/lib/utils'
import type { BookViewMode } from '@/composables/useDisplaySettings'
import { useScrollRestoreOnActivate } from '@/features/book/composables/useScrollRestoreOnActivate'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { storage } from '@/services/storage'
import SeriesGridCard from '../components/SeriesGridCard.vue'
import SeriesIndexTable from '../components/SeriesIndexTable.vue'
import SeriesStatusTabs from '../components/SeriesStatusTabs.vue'
import SeriesVolumeLegend from '../components/SeriesVolumeLegend.vue'
import { useSeriesList } from '../composables/useSeriesList'
import { groupSeries } from '../lib/series-grouping'
import type { CompletionStatus, SeriesGrouping, SeriesListSort, SeriesViewMode, SortDirection } from '../types/series'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()

const mainRef = ref<HTMLElement | null>(null)
useScrollRestoreOnActivate(mainRef)

const { libraries, fetchLibraries } = useLibraries()
const { items, total, facets, loading, error, hasMore, q, sort, order, libraryId, completionStatus, load } = useSeriesList()

const CARD_WIDTH_KEY = 'bookorbit:seriesCardWidth'
const GRID_GAP_KEY = 'bookorbit:seriesGridGap'
const VIEW_MODE_KEY = 'bookorbit:seriesViewMode'
const GROUPING_KEY = 'bookorbit:seriesGrouping'

const CARD_WIDTH_DEFAULT = 300
const CARD_WIDTH_MIN = 200
const CARD_WIDTH_MAX = 420
const GRID_GAP_MIN = 8
const GRID_GAP_MAX = 40
const INITIAL_SKELETON_COUNT = 18

const hydrating = ref(true)
const suppressAutoReload = ref(false)
const initialLoadComplete = ref(false)

const sentinel = ref<HTMLElement | null>(null)

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

const cardWidth = ref(clamp(storage.get(CARD_WIDTH_KEY, CARD_WIDTH_DEFAULT), CARD_WIDTH_MIN, CARD_WIDTH_MAX))
const gridGap = ref(clamp(storage.get(GRID_GAP_KEY, 18), GRID_GAP_MIN, GRID_GAP_MAX))
const viewMode = ref<SeriesViewMode>(parseViewMode(storage.get<string>(VIEW_MODE_KEY, 'cards')))
const grouping = ref<SeriesGrouping>(parseGrouping(storage.get<string>(GROUPING_KEY, 'none')))

/** The list has no size control of its own, so its rows keep one comfortable height. */
const LIST_ROW_HEIGHT = 60

let observer: IntersectionObserver | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null

const sortLabels = computed<Record<SeriesListSort, string>>(() => ({
  name: t('series.list.sort.name'),
  bookCount: t('series.list.sort.bookCount'),
  lastAddedAt: t('series.list.sort.recentAdditions'),
  readProgress: t('series.list.sort.readingProgress'),
}))

const groupingLabels = computed<Record<SeriesGrouping, string>>(() => ({
  none: t('series.grouping.none'),
  letter: t('series.grouping.letter'),
  library: t('series.grouping.library'),
  status: t('series.grouping.status'),
}))

const statusGroupLabels = computed(() => ({
  inProgress: t('series.status.inProgress'),
  hasGaps: t('series.status.hasGaps'),
  notStarted: t('series.status.notStarted'),
  complete: t('series.status.complete'),
}))

const isDefaultSort = computed(() => sort.value === 'name' && order.value === 'asc')
const sortSummary = computed(() => sortLabels.value[sort.value])
const SERIES_SORT_FIELDS: SeriesListSort[] = ['name', 'bookCount', 'lastAddedAt', 'readProgress']
const SERIES_GROUPINGS: SeriesGrouping[] = ['none', 'letter', 'library', 'status']

const statusLabels = computed<Record<CompletionStatus, string>>(() => ({
  in_progress: t('series.status.reading'),
  not_started: t('series.status.unread'),
  complete: t('series.status.complete'),
  has_gaps: t('series.status.gaps'),
}))

const libraryOptions = computed(() =>
  libraries.value.filter((library) => library.type !== 'podcasts').map((library) => ({ id: library.id, name: library.name })),
)
const foldedCount = computed(() => formatNumber(total.value))

const activeFilterCount = computed(() => {
  let count = 0
  if (q.value.trim()) count += 1
  if (libraryId.value !== null) count += 1
  if (completionStatus.value !== null) count += 1
  return count
})

const isFiltered = computed(() => activeFilterCount.value > 0)
const showSkeleton = computed(() => !initialLoadComplete.value && items.value.length === 0)

const groups = computed(() => groupSeries(items.value, grouping.value, statusGroupLabels.value))

const headerViewMode = computed<BookViewMode>(() => (viewMode.value === 'cards' ? 'grid' : 'list'))

function parseViewMode(value: unknown): SeriesViewMode {
  return value === 'list' ? 'list' : 'cards'
}

function parseGrouping(value: unknown): SeriesGrouping {
  return value === 'letter' || value === 'library' || value === 'status' ? value : 'none'
}

function parseSort(value: unknown): SeriesListSort {
  return value === 'bookCount' || value === 'lastAddedAt' || value === 'readProgress' || value === 'name' ? value : 'name'
}

function parseOrder(value: unknown): SortDirection {
  return value === 'desc' || value === 'asc' ? value : 'asc'
}

function parseLibraryId(value: unknown): number | null {
  const raw = typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(raw) && raw > 0 ? raw : null
}

function parseCompletionStatus(value: unknown): CompletionStatus | null {
  if (value === 'not_started' || value === 'in_progress' || value === 'complete' || value === 'has_gaps') return value
  return null
}

function syncRouteQuery() {
  void router.replace({
    name: 'series',
    query: {
      q: q.value.trim() || undefined,
      sort: sort.value !== 'name' ? sort.value : undefined,
      order: order.value !== 'asc' ? order.value : undefined,
      libraryId: libraryId.value ? String(libraryId.value) : undefined,
      completionStatus: completionStatus.value ?? undefined,
    },
  })
}

function openSeries(seriesId: number) {
  void router.push({ name: 'series-detail', params: { seriesId }, query: { from: route.fullPath } })
}

function setSortField(field: SeriesListSort) {
  if (sort.value === field) {
    order.value = order.value === 'asc' ? 'desc' : 'asc'
    return
  }
  sort.value = field
  order.value = field === 'name' ? 'asc' : 'desc'
}

function toggleSortDirection() {
  order.value = order.value === 'asc' ? 'desc' : 'asc'
}

function resetSort() {
  sort.value = 'name'
  order.value = 'asc'
}

function handleGroupingUpdate(value: unknown) {
  if (value === 'none' || value === 'letter' || value === 'library' || value === 'status') grouping.value = value
}

function handleCardWidthUpdate(value: number) {
  cardWidth.value = value
}

function handleGridGapUpdate(value: number) {
  gridGap.value = value
}

function setViewMode(mode: SeriesViewMode) {
  viewMode.value = mode
}

function handleHeaderViewMode(mode: BookViewMode) {
  setViewMode(mode === 'list' ? 'list' : 'cards')
}

function setCompletionStatus(value: CompletionStatus | null) {
  completionStatus.value = value
}

function setLibraryId(value: number | null) {
  libraryId.value = value
}

async function clearFilters() {
  if (searchTimer) clearTimeout(searchTimer)
  suppressAutoReload.value = true

  q.value = ''
  libraryId.value = null
  completionStatus.value = null

  syncRouteQuery()
  await load(true)

  await nextTick()
  suppressAutoReload.value = false
}

function loadIfSentinelVisible() {
  if (loading.value || !hasMore.value || !sentinel.value) return
  if (sentinel.value.getBoundingClientRect().top < window.innerHeight + 250) {
    void load()
  }
}

onMounted(async () => {
  q.value = typeof route.query.q === 'string' ? route.query.q : ''
  sort.value = parseSort(route.query.sort)
  order.value = parseOrder(route.query.order)
  libraryId.value = parseLibraryId(route.query.libraryId)
  completionStatus.value = parseCompletionStatus(route.query.completionStatus)

  await fetchLibraries()
  hydrating.value = false

  await load(true)
  initialLoadComplete.value = true

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !loading.value) void load()
    },
    { rootMargin: '280px' },
  )

  await nextTick()
  if (sentinel.value) observer.observe(sentinel.value)
})

onUnmounted(() => {
  observer?.disconnect()
  if (searchTimer) clearTimeout(searchTimer)
})

watch([sort, order, libraryId, completionStatus], () => {
  if (hydrating.value || suppressAutoReload.value) return
  syncRouteQuery()
  void load(true)
})

watch(q, () => {
  if (hydrating.value || suppressAutoReload.value) return
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    syncRouteQuery()
    void load(true)
  }, 250)
})

watch(
  loading,
  (isLoading) => {
    if (!isLoading) loadIfSentinelVisible()
  },
  { flush: 'post' },
)

watch(cardWidth, (value) => {
  const normalized = clamp(value, CARD_WIDTH_MIN, CARD_WIDTH_MAX)
  if (normalized !== value) {
    cardWidth.value = normalized
    return
  }
  storage.set(CARD_WIDTH_KEY, normalized)
})

watch(gridGap, (value) => {
  const normalized = clamp(value, GRID_GAP_MIN, GRID_GAP_MAX)
  if (normalized !== value) {
    gridGap.value = normalized
    return
  }
  storage.set(GRID_GAP_KEY, normalized)
})

watch(viewMode, (value) => {
  storage.set(VIEW_MODE_KEY, value)
})

watch(grouping, (value) => storage.set(GROUPING_KEY, value))

defineOptions({ name: 'SeriesView' })
</script>

<template>
  <section class="flex h-full flex-col">
    <BrowseHeader
      :eyebrow="t('components.browseHeader.eyebrow.browse')"
      :title="t('series.list.title')"
      icon="Library"
      fallback-icon="Library"
      :folded-count="foldedCount"
      :scroll-container="mainRef"
    >
      <template #facts>
        <span class="truncate">{{ t('components.browseHeader.facts.series', { count: total }) }}</span>
      </template>

      <template #bar>
        <BrowseSearchField v-model="q" :placeholder="t('series.list.searchPlaceholder')" :active="isFiltered" @clear="clearFilters" />
        <span :class="barDivider" aria-hidden="true" />
        <BrowseSortControl
          :label="sortSummary"
          :direction="order"
          :changed="!isDefaultSort"
          popover-class="w-56 p-2"
          @toggle-direction="toggleSortDirection"
        >
          <div class="mb-2 px-1 text-xs font-medium text-muted-foreground">{{ t('series.list.sortBy') }}</div>
          <div class="flex flex-col gap-0.5">
            <button
              v-for="field in SERIES_SORT_FIELDS"
              :key="field"
              type="button"
              class="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
              :class="sort === field ? 'font-medium text-foreground' : 'text-muted-foreground'"
              @click="setSortField(field)"
            >
              {{ sortLabels[field] }}
              <span v-if="sort === field" class="text-xs text-primary" aria-hidden="true">{{ order === 'asc' ? '↑' : '↓' }}</span>
            </button>
          </div>
          <template v-if="!isDefaultSort">
            <div class="my-2 border-t border-border" />
            <button
              type="button"
              class="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
              @click="resetSort"
            >
              {{ t('common.resetSortAria') }}
            </button>
          </template>
        </BrowseSortControl>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              type="button"
              :class="cn(barButton, 'hidden md:inline-flex', grouping !== 'none' && barButtonOn)"
              :aria-label="t('series.grouping.label')"
            >
              <Rows3 :size="14" :class="grouping !== 'none' ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
              <span class="hidden xl:inline">{{ groupingLabels[grouping] }}</span>
              <ChevronDown
                :size="13"
                class="-ms-0.5 hidden xl:block"
                :class="grouping !== 'none' ? 'text-primary' : 'text-muted-foreground'"
                aria-hidden="true"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-48">
            <DropdownMenuRadioGroup :model-value="grouping" @update:model-value="handleGroupingUpdate">
              <DropdownMenuRadioItem v-for="option in SERIES_GROUPINGS" :key="option" :value="option">{{
                groupingLabels[option]
              }}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span :class="barDivider" aria-hidden="true" />
        <BrowseInlineGroup
          :label="t('components.browseHeader.facets.status')"
          :value="completionStatus === null ? null : statusLabels[completionStatus]"
          :active="completionStatus !== null"
          :show-label="false"
        >
          <SeriesStatusTabs :status="completionStatus" :facets="facets" @select="setCompletionStatus" />
        </BrowseInlineGroup>
        <BrowseLibraryPicker
          v-if="libraryOptions.length > 1"
          hide-on-phone
          :libraries="libraryOptions"
          :model-value="libraryId"
          @update:model-value="setLibraryId"
        />
        <span :class="barDivider" aria-hidden="true" />
        <BrowseViewControls
          :view-mode="headerViewMode"
          :allowed-view-modes="['grid', 'list']"
          :show-selection="false"
          :show-display="viewMode === 'cards'"
          @update:view-mode="handleHeaderViewMode"
        >
          <template #display>
            <ViewHeaderDisplayControls
              view-mode="grid"
              :cover-size="cardWidth"
              :grid-gap="gridGap"
              :cover-size-min="CARD_WIDTH_MIN"
              :cover-size-max="CARD_WIDTH_MAX"
              :cover-size-step="20"
              :grid-gap-min="GRID_GAP_MIN"
              :grid-gap-max="GRID_GAP_MAX"
              @update:cover-size="handleCardWidthUpdate"
              @update:grid-gap="handleGridGapUpdate"
            >
              <template #extra>
                <div class="space-y-2 border-t border-border pt-3">
                  <span class="text-xs text-muted-foreground">{{ t('components.browseHeader.legend') }}</span>
                  <SeriesVolumeLegend class="flex-wrap gap-x-3 gap-y-1.5" />
                </div>
              </template>
            </ViewHeaderDisplayControls>
          </template>
        </BrowseViewControls>
      </template>
    </BrowseHeader>

    <main ref="mainRef" class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-2">
      <template v-if="showSkeleton">
        <div v-if="viewMode === 'cards'" class="series-grid grid" :style="{ '--series-card-width': `${cardWidth}px`, gap: `${gridGap}px` }">
          <div v-for="n in INITIAL_SKELETON_COUNT" :key="n" class="overflow-hidden rounded-xl border border-border bg-card">
            <div class="animate-pulse bg-muted/80" style="aspect-ratio: 5 / 4" />
            <div class="space-y-2 px-3 py-3">
              <div class="h-3.5 w-2/3 rounded-xs bg-muted/80" />
              <div class="h-3 w-1/2 rounded-xs bg-muted/70" />
            </div>
          </div>
        </div>
        <div v-else class="overflow-hidden rounded-xl border border-border bg-card">
          <div v-for="n in 12" :key="n" class="flex items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0">
            <div class="h-10 w-7 shrink-0 animate-pulse rounded-xs bg-muted/80" />
            <div class="min-w-0 flex-1 space-y-2">
              <div class="h-3 w-2/5 rounded-xs bg-muted/80" />
              <div class="h-2.5 w-1/4 rounded-xs bg-muted/70" />
            </div>
            <div class="hidden h-2.5 w-1/3 rounded-xs bg-muted/70 sm:block" />
          </div>
        </div>
      </template>

      <template v-else-if="items.length > 0">
        <div v-if="viewMode === 'cards'" class="flex flex-col">
          <template v-for="group in groups" :key="group.key">
            <div v-if="group.label" class="flex items-center gap-2.5 pb-2 pt-4 text-[12.5px] font-bold tracking-[0.03em] text-foreground first:pt-0">
              <span>{{ group.label }}</span>
              <span class="font-medium tabular-nums text-muted-foreground">{{ group.items.length }}</span>
              <span class="h-px flex-1 bg-border" />
            </div>
            <div class="series-grid grid" :style="{ '--series-card-width': `${cardWidth}px`, gap: `${gridGap}px` }">
              <SeriesGridCard v-for="series in group.items" :key="series.id" :series="series" @open="openSeries" />
            </div>
          </template>
        </div>

        <SeriesIndexTable
          v-else
          :groups="groups"
          :sort="sort"
          :order="order"
          :row-height="LIST_ROW_HEIGHT"
          :header-offset="0"
          @open="openSeries"
          @sort="setSortField"
        />
      </template>

      <div v-else-if="initialLoadComplete && !loading" class="flex flex-col items-center justify-center px-5 py-14 text-center">
        <div class="mb-3 grid size-11 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
          <Library :size="20" />
        </div>
        <p class="text-[15px] font-semibold text-foreground">{{ isFiltered ? t('series.list.noMatch') : t('series.list.empty') }}</p>
        <p class="mt-1 text-[13px] text-muted-foreground">{{ isFiltered ? t('series.list.noMatchHint') : t('series.list.emptyHint') }}</p>
        <button
          v-if="isFiltered"
          type="button"
          class="mt-3 flex h-8 items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="clearFilters"
        >
          <X :size="13" />
          {{ t('series.list.clear') }}
        </button>
      </div>

      <p v-if="error" role="alert" class="mt-8 text-center text-sm text-destructive">{{ error }}</p>

      <div ref="sentinel" class="h-px" />
    </main>
  </section>
</template>

<style scoped>
.series-search::-webkit-search-decoration,
.series-search::-webkit-search-cancel-button,
.series-search::-webkit-search-results-button,
.series-search::-webkit-search-results-decoration {
  -webkit-appearance: none;
  appearance: none;
}

.series-search::-ms-clear,
.series-search::-ms-reveal {
  display: none;
  width: 0;
  height: 0;
}

.series-grid {
  grid-template-columns: repeat(auto-fill, minmax(var(--series-card-width), 1fr));
}

/* Two fixed columns on a small tablet: auto-fill would leave one enormous card in the band
   between a phone row and the point where a second column fits on its own. */
@media (min-width: 520px) and (max-width: 833px) {
  .series-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
    gap: 12px !important;
  }
}

/* Phone: the card turns on its side rather than shrinking below legible. */
@media (max-width: 519px) {
  .series-grid {
    grid-template-columns: 1fr !important;
    gap: 9px !important;
  }
}
</style>
