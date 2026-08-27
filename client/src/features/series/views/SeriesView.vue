<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpDown, Filter, Library, Rows3, Search, X } from '@lucide/vue'

import ViewHeader from '@/components/ViewHeader.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
const filtersOpen = ref(false)
const mobileSearchOpen = ref(false)
const initialLoadComplete = ref(false)

const sentinel = ref<HTMLElement | null>(null)
const mobileSearchInput = ref<HTMLInputElement | null>(null)
const pageHeader = ref<HTMLElement | null>(null)
const headerOffset = ref(0)

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
let headerObserver: ResizeObserver | null = null
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

function setSortOrder(direction: SortDirection) {
  order.value = direction
}

function resetSort() {
  sort.value = 'name'
  order.value = 'asc'
}

function setGrouping(value: SeriesGrouping) {
  grouping.value = value
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

function clearSearchQuery() {
  q.value = ''
}

function toggleFiltersOpen() {
  filtersOpen.value = !filtersOpen.value
}

function toggleMobileSearch() {
  mobileSearchOpen.value = !mobileSearchOpen.value
  if (!mobileSearchOpen.value) return
  void nextTick(() => mobileSearchInput.value?.focus())
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

function measureHeaderOffset() {
  headerOffset.value = pageHeader.value?.offsetHeight ?? 0
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
  if (pageHeader.value) {
    headerObserver = new ResizeObserver(measureHeaderOffset)
    headerObserver.observe(pageHeader.value)
    measureHeaderOffset()
  }
})

onUnmounted(() => {
  observer?.disconnect()
  headerObserver?.disconnect()
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
  void nextTick(measureHeaderOffset)
})

watch(grouping, (value) => storage.set(GROUPING_KEY, value))

defineOptions({ name: 'SeriesView' })
</script>

<template>
  <section class="flex h-full flex-col">
    <ViewHeader
      :title="t('series.list.title')"
      icon="Library"
      fallback-icon="Library"
      :total="total"
      :view-mode="headerViewMode"
      :show-selection="false"
      :allowed-view-modes="['grid', 'list']"
      :mobile-display-in-menu="false"
      :show-display-controls="viewMode === 'cards'"
      v-model:coverSize="cardWidth"
      v-model:gridGap="gridGap"
      :cover-size-min="CARD_WIDTH_MIN"
      :cover-size-max="CARD_WIDTH_MAX"
      :cover-size-step="20"
      :grid-gap-min="GRID_GAP_MIN"
      :grid-gap-max="GRID_GAP_MAX"
      @update:view-mode="handleHeaderViewMode"
    >
      <template #toolbar>
        <div class="hidden h-8 w-56 items-center gap-2 rounded-lg border border-input bg-background px-2.5 lg:flex">
          <Search :size="14" class="shrink-0 text-muted-foreground" />
          <input
            v-model="q"
            type="search"
            :placeholder="t('series.list.searchPlaceholder')"
            :aria-label="t('series.list.searchPlaceholder')"
            class="series-search h-full w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            v-if="q.trim()"
            type="button"
            class="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            :aria-label="t('series.list.clearSearch')"
            @click="clearSearchQuery"
          >
            <X :size="12" />
          </button>
        </div>

        <button
          type="button"
          class="flex size-8 items-center justify-center rounded-lg border border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          :class="mobileSearchOpen ? 'border-ring bg-primary/10 text-foreground' : ''"
          :aria-label="t('series.list.searchPlaceholder')"
          :aria-expanded="mobileSearchOpen"
          @click="toggleMobileSearch"
        >
          <Search :size="14" />
        </button>

        <Popover>
          <PopoverTrigger as-child>
            <button
              type="button"
              class="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors"
              :class="
                !isDefaultSort
                  ? 'border-ring bg-primary/10 text-foreground'
                  : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
              "
              :aria-label="t('series.list.sortBy')"
            >
              <ArrowUpDown :size="13" />
              <span class="hidden xl:inline">{{ sortSummary }}</span>
              <span aria-hidden="true">{{ order === 'asc' ? '↑' : '↓' }}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-56 p-2">
            <div class="mb-2 px-1 text-xs font-medium text-muted-foreground">{{ t('series.list.sortBy') }}</div>
            <div class="flex flex-col gap-0.5">
              <button
                v-for="field in ['name', 'bookCount', 'lastAddedAt', 'readProgress'] as const"
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
            <div class="my-2 border-t border-border" />
            <div class="flex gap-1">
              <button
                v-for="direction in ['asc', 'desc'] as const"
                :key="direction"
                type="button"
                class="flex-1 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                :class="order === direction ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'"
                @click="setSortOrder(direction)"
              >
                {{ direction === 'asc' ? t('series.list.ascending') : t('series.list.descending') }}
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
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger as-child>
            <button
              type="button"
              class="hidden h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors md:flex"
              :class="
                grouping !== 'none'
                  ? 'border-ring bg-primary/10 text-foreground'
                  : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
              "
              :aria-label="t('series.grouping.label')"
            >
              <Rows3 :size="13" />
              <span class="hidden xl:inline">{{ groupingLabels[grouping] }}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-48 p-2">
            <div class="mb-2 px-1 text-xs font-medium text-muted-foreground">{{ t('series.grouping.label') }}</div>
            <button
              v-for="option in ['none', 'letter', 'library', 'status'] as const"
              :key="option"
              type="button"
              class="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
              :class="grouping === option ? 'font-medium text-foreground' : 'text-muted-foreground'"
              @click="setGrouping(option)"
            >
              {{ groupingLabels[option] }}
            </button>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          class="flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm transition-colors"
          :class="
            isFiltered || filtersOpen
              ? 'border-ring bg-primary/10 text-foreground'
              : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          :aria-expanded="filtersOpen"
          :aria-label="t('series.list.filters')"
          @click="toggleFiltersOpen"
        >
          <Filter :size="13" />
          <span class="hidden xl:inline">{{ t('series.list.filters') }}</span>
          <span v-if="activeFilterCount > 0" class="text-xs font-semibold tabular-nums">{{ activeFilterCount }}</span>
        </button>
      </template>
    </ViewHeader>

    <div v-if="mobileSearchOpen" class="mb-2 flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-2.5 lg:hidden">
      <Search :size="14" class="shrink-0 text-muted-foreground" />
      <input
        ref="mobileSearchInput"
        v-model="q"
        type="search"
        :placeholder="t('series.list.searchPlaceholder')"
        :aria-label="t('series.list.searchPlaceholder')"
        class="series-search h-full w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <button
        v-if="q.trim()"
        type="button"
        class="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        :aria-label="t('series.list.clearSearch')"
        @click="clearSearchQuery"
      >
        <X :size="12" />
      </button>
    </div>

    <main ref="mainRef" class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-2">
      <div ref="pageHeader" class="sticky top-0 z-40 mb-3.5 border-b border-border bg-background/85 pb-2.5 pt-0.5 backdrop-blur-md">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <SeriesStatusTabs :status="completionStatus" :facets="facets" @select="setCompletionStatus" />

          <div v-if="filtersOpen" class="flex min-w-0 flex-wrap items-center gap-1.5 rounded-lg bg-muted p-0.5">
            <button
              type="button"
              class="h-7 shrink-0 rounded-md px-2.5 text-xs transition-colors"
              :class="libraryId === null ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'"
              @click="setLibraryId(null)"
            >
              {{ t('series.filters.allLibraries') }}
            </button>
            <button
              v-for="library in libraries"
              :key="library.id"
              type="button"
              class="h-7 min-w-0 shrink-0 rounded-md px-2.5 text-xs transition-colors"
              :class="
                libraryId === library.id ? 'bg-background font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              "
              @click="setLibraryId(library.id)"
            >
              <span class="truncate">{{ library.name }}</span>
            </button>
          </div>

          <button
            v-if="isFiltered"
            type="button"
            class="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:text-destructive"
            @click="clearFilters"
          >
            <X :size="13" />
            <span class="hidden sm:inline">{{ t('series.list.clear') }}</span>
          </button>

          <div class="flex-1" />
          <SeriesVolumeLegend class="hidden xl:flex" />
        </div>
      </div>

      <template v-if="showSkeleton">
        <div v-if="viewMode === 'cards'" class="series-grid grid" :style="{ '--series-card-width': `${cardWidth}px`, gap: `${gridGap}px` }">
          <div v-for="n in INITIAL_SKELETON_COUNT" :key="n" class="overflow-hidden rounded-xl border border-border bg-card">
            <div class="animate-pulse bg-muted/80" style="aspect-ratio: 5 / 4" />
            <div class="space-y-2 px-3 py-3">
              <div class="h-3.5 w-2/3 rounded bg-muted/80" />
              <div class="h-3 w-1/2 rounded bg-muted/70" />
            </div>
          </div>
        </div>
        <div v-else class="overflow-hidden rounded-xl border border-border bg-card">
          <div v-for="n in 12" :key="n" class="flex items-center gap-3 border-b border-border px-3.5 py-3 last:border-b-0">
            <div class="h-10 w-7 shrink-0 animate-pulse rounded bg-muted/80" />
            <div class="min-w-0 flex-1 space-y-2">
              <div class="h-3 w-2/5 rounded bg-muted/80" />
              <div class="h-2.5 w-1/4 rounded bg-muted/70" />
            </div>
            <div class="hidden h-2.5 w-1/3 rounded bg-muted/70 sm:block" />
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
          :header-offset="headerOffset"
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
