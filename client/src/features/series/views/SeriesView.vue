<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpDown, Filter, Search, SlidersHorizontal, X } from 'lucide-vue-next'

import ViewHeader from '@/components/ViewHeader.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { storage } from '@/services/storage'
import SeriesCard from '../components/SeriesCard.vue'
import SeriesFilters from '../components/SeriesFilters.vue'
import { useSeriesList } from '../composables/useSeriesList'
import type { CompletionStatus, SeriesListSort, SortDirection } from '../types/series'

const router = useRouter()
const route = useRoute()
const { viewMode } = useDisplaySettings()
const { libraries, fetchLibraries } = useLibraries()
const { items, total, loading, error, hasMore, q, sort, order, libraryId, completionStatus, load } = useSeriesList()

const SERIES_CARD_WIDTH_STORAGE_KEY = 'bookorbit:seriesCardWidth'
const SERIES_GRID_GAP_STORAGE_KEY = 'bookorbit:seriesGridGap'
const SERIES_CARD_WIDTH_DEFAULT = 260
const SERIES_CARD_WIDTH_MIN = 240
const SERIES_CARD_WIDTH_MAX = 420
const SERIES_GRID_GAP_MIN = 8
const SERIES_GRID_GAP_MAX = 48

const hydrating = ref(true)
const suppressAutoReload = ref(false)
const filtersOpen = ref(false)
const mobileControlsExpanded = ref(false)
const initialLoadComplete = ref(false)
const INITIAL_SKELETON_COUNT = 18

const sentinel = ref<HTMLElement | null>(null)
const mobileSearchInput = ref<HTMLInputElement | null>(null)
const seriesCardWidth = ref(
  Math.min(Math.max(storage.get(SERIES_CARD_WIDTH_STORAGE_KEY, SERIES_CARD_WIDTH_DEFAULT), SERIES_CARD_WIDTH_MIN), SERIES_CARD_WIDTH_MAX),
)
const seriesGridGap = ref(Math.max(storage.get(SERIES_GRID_GAP_STORAGE_KEY, 20), SERIES_GRID_GAP_MIN))
let observer: IntersectionObserver | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null

const SORT_LABELS: Record<SeriesListSort, string> = {
  name: 'Name',
  bookCount: 'Book Count',
  lastAddedAt: 'Recent Additions',
  readProgress: 'Reading Progress',
}

const isDefaultSort = computed(() => sort.value === 'name' && order.value === 'asc')
const sortSummary = computed(() => `${SORT_LABELS[sort.value]} ${order.value === 'asc' ? '↑' : '↓'}`)

const activeFilterCount = computed(() => {
  let count = 0
  if (q.value.trim()) count += 1
  if (libraryId.value !== null) count += 1
  if (completionStatus.value !== null) count += 1
  return count
})
const mobileControlsBadgeCount = computed(() => activeFilterCount.value + (!isDefaultSort.value ? 1 : 0))

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
  if (value === 'not_started' || value === 'in_progress' || value === 'complete') return value
  return null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
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
  sort.value = field
  order.value = 'asc'
}

function setSortOrder(dir: SortDirection) {
  order.value = dir
}

function resetSort() {
  sort.value = 'name'
  order.value = 'asc'
}

function onMobileSortChange(event: Event) {
  const value = parseSort((event.target as HTMLSelectElement).value)
  setSortField(value)
}

function clearSearchQuery() {
  q.value = ''
}

function toggleFiltersOpen() {
  filtersOpen.value = !filtersOpen.value
}

function closeFiltersPanel() {
  filtersOpen.value = false
}

function closeMobileControls() {
  mobileControlsExpanded.value = false
}

function toggleMobileControls() {
  if (mobileControlsExpanded.value) {
    closeMobileControls()
    return
  }
  mobileControlsExpanded.value = true
  void nextTick(() => {
    mobileSearchInput.value?.focus()
  })
}

async function clearFilters() {
  if (searchTimer) clearTimeout(searchTimer)
  suppressAutoReload.value = true

  q.value = ''
  sort.value = 'name'
  order.value = 'asc'
  libraryId.value = null
  completionStatus.value = null

  syncRouteQuery()
  await load(true)
  filtersOpen.value = false

  await nextTick()
  suppressAutoReload.value = false
}

function handleLibraryIdUpdate(value: number | null) {
  libraryId.value = value
}

function handleCompletionStatusUpdate(value: CompletionStatus | null) {
  completionStatus.value = value
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
  filtersOpen.value = activeFilterCount.value > 0

  await load(true)
  initialLoadComplete.value = true

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !loading.value) {
        void load()
      }
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

watch(seriesCardWidth, (value) => {
  const normalized = clamp(value, SERIES_CARD_WIDTH_MIN, SERIES_CARD_WIDTH_MAX)
  if (normalized !== value) {
    seriesCardWidth.value = normalized
    return
  }
  storage.set(SERIES_CARD_WIDTH_STORAGE_KEY, normalized)
})

watch(seriesGridGap, (value) => {
  const normalized = clamp(value, SERIES_GRID_GAP_MIN, SERIES_GRID_GAP_MAX)
  if (normalized !== value) {
    seriesGridGap.value = normalized
    return
  }
  storage.set(SERIES_GRID_GAP_STORAGE_KEY, normalized)
})
</script>

<template>
  <section class="flex h-full flex-col">
    <ViewHeader
      title="Series"
      icon="Library"
      :total="total"
      :view-mode="viewMode"
      :show-selection="false"
      :show-view-mode-toggle="false"
      :mobile-display-in-menu="false"
      :allowed-view-modes="['grid']"
      v-model:coverSize="seriesCardWidth"
      v-model:gridGap="seriesGridGap"
      :cover-size-min="SERIES_CARD_WIDTH_MIN"
      :cover-size-max="SERIES_CARD_WIDTH_MAX"
      :cover-size-step="20"
      :grid-gap-min="SERIES_GRID_GAP_MIN"
      :grid-gap-max="SERIES_GRID_GAP_MAX"
    >
      <template #toolbar>
        <div class="hidden lg:flex h-8 w-64 items-center rounded-md border border-input bg-background px-2.5">
          <Search :size="13" class="mr-1.5 shrink-0 text-muted-foreground/85" />
          <input
            v-model="q"
            type="search"
            placeholder="Search series or author"
            class="series-search-input h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/85"
          />
          <button v-if="q.trim()" class="ml-1 text-muted-foreground/85 transition-colors hover:text-foreground" @click="clearSearchQuery">
            <X :size="12" />
          </button>
        </div>

        <div class="hidden lg:block h-5 w-px shrink-0 bg-border" />

        <div class="hidden sm:flex items-center gap-1">
          <Popover>
            <PopoverTrigger as-child>
              <button
                class="flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors"
                :class="
                  !isDefaultSort
                    ? 'border-primary text-primary bg-primary/10'
                    : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
                "
              >
                <ArrowUpDown :size="13" />
                <span class="hidden lg:inline">{{ sortSummary }}</span>
                <span class="lg:hidden">Sort</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" class="w-56 p-2">
              <div class="mb-2 px-1 text-xs font-medium text-muted-foreground">Sort by</div>
              <div class="flex flex-col gap-0.5">
                <button
                  v-for="field in ['name', 'bookCount', 'lastAddedAt', 'readProgress'] as const"
                  :key="field"
                  class="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                  :class="sort === field ? 'text-foreground font-medium' : 'text-muted-foreground'"
                  @click="setSortField(field)"
                >
                  {{ SORT_LABELS[field] }}
                  <span v-if="sort === field" class="text-xs text-primary">{{ order === 'asc' ? '↑' : '↓' }}</span>
                </button>
              </div>
              <div class="my-2 border-t border-border" />
              <div class="flex gap-1">
                <button
                  v-for="dir in ['asc', 'desc'] as const"
                  :key="dir"
                  class="flex-1 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                  :class="order === dir ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'"
                  @click="setSortOrder(dir)"
                >
                  {{ dir === 'asc' ? 'Ascending' : 'Descending' }}
                </button>
              </div>
            </PopoverContent>
          </Popover>
          <button
            v-if="!isDefaultSort"
            class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-destructive hover:bg-muted"
            @click="resetSort"
          >
            <X :size="13" />
          </button>
        </div>

        <div class="hidden sm:block h-5 w-px shrink-0 bg-border" />

        <button
          class="hidden sm:flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors"
          :class="
            activeFilterCount > 0
              ? 'border-primary text-primary bg-primary/10'
              : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
          "
          @click="toggleFiltersOpen"
        >
          <Filter :size="13" />
          <span>Filters</span>
          <span v-if="activeFilterCount > 0" class="text-xs font-semibold">({{ activeFilterCount }})</span>
        </button>

        <button
          v-if="activeFilterCount > 0 || !isDefaultSort"
          class="hidden sm:flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-destructive"
          @click="clearFilters"
        >
          <X :size="13" />
          Clear
        </button>

        <button
          class="sm:hidden relative flex h-8 w-8 items-center justify-center rounded-md border transition-colors"
          :class="
            mobileControlsExpanded
              ? 'border-primary text-primary bg-primary/10'
              : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          @click="toggleMobileControls"
        >
          <SlidersHorizontal :size="14" />
          <span
            v-if="mobileControlsBadgeCount > 0"
            class="absolute -right-1 -top-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
          >
            {{ mobileControlsBadgeCount }}
          </span>
        </button>
      </template>
    </ViewHeader>

    <!-- Mobile controls -->
    <section v-if="mobileControlsExpanded" class="mb-3 space-y-2 rounded-lg border border-border/70 bg-card/70 p-2 sm:hidden">
      <div class="flex items-center gap-1 rounded-md border border-input bg-background px-2.5">
        <Search :size="13" class="shrink-0 text-muted-foreground/85" />
        <input
          ref="mobileSearchInput"
          v-model="q"
          type="search"
          placeholder="Search series or author"
          class="mobile-search-input h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/85"
        />
        <button v-if="q.trim()" class="text-muted-foreground/85 hover:text-foreground" @click="clearSearchQuery">
          <X :size="12" />
        </button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div class="relative min-w-0 flex-1">
          <select
            :value="sort"
            class="h-8 w-full appearance-none rounded-md border border-input bg-background px-2.5 pr-8 text-sm text-foreground outline-none transition-colors focus:border-primary/60"
            @change="onMobileSortChange"
          >
            <option v-for="field in ['name', 'bookCount', 'lastAddedAt', 'readProgress'] as const" :key="field" :value="field">
              {{ SORT_LABELS[field] }}
            </option>
          </select>
          <ArrowUpDown :size="13" class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/85" />
        </div>

        <button
          class="flex h-8 items-center rounded-md border px-2.5 text-sm transition-colors"
          :class="
            order === 'asc'
              ? 'border-primary text-primary bg-primary/10'
              : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
          "
          @click="setSortOrder(order === 'asc' ? 'desc' : 'asc')"
        >
          {{ order === 'asc' ? 'Asc' : 'Desc' }}
        </button>

        <button
          v-if="activeFilterCount > 0 || !isDefaultSort"
          class="h-8 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-destructive"
          @click="clearFilters"
        >
          Clear
        </button>
      </div>

      <SeriesFilters
        :library-id="libraryId"
        :libraries="libraries"
        :completion-status="completionStatus"
        :active-count="activeFilterCount"
        embedded
        @update:library-id="handleLibraryIdUpdate"
        @update:completion-status="handleCompletionStatusUpdate"
        @clear="clearFilters"
      />
    </section>

    <main class="flex-1 min-h-0 overflow-y-auto pr-2">
      <!-- Desktop filters panel -->
      <SeriesFilters
        v-if="filtersOpen && !mobileControlsExpanded"
        :library-id="libraryId"
        :libraries="libraries"
        :completion-status="completionStatus"
        :active-count="activeFilterCount"
        closable
        @update:library-id="handleLibraryIdUpdate"
        @update:completion-status="handleCompletionStatusUpdate"
        @clear="clearFilters"
        @close="closeFiltersPanel"
      />

      <!-- Grid -->
      <div
        class="series-grid grid"
        :style="{
          '--series-card-width': `${seriesCardWidth}px`,
          gap: `${seriesGridGap}px`,
        }"
      >
        <template v-if="!initialLoadComplete">
          <div v-for="n in INITIAL_SKELETON_COUNT" :key="n" class="overflow-hidden rounded-lg border border-border/60 bg-card">
            <div class="animate-pulse bg-muted/80" style="aspect-ratio: 11 / 8" />
            <div class="space-y-2 px-4 py-3">
              <div class="h-4 w-2/3 rounded bg-muted/80" />
              <div class="h-3 w-1/2 rounded bg-muted/70" />
            </div>
            <div class="h-1.5 w-full animate-pulse bg-muted/80" />
          </div>
        </template>
        <template v-else>
          <SeriesCard v-for="series in items" :key="series.name" :series="series" @open="openSeries" />
        </template>
      </div>

      <!-- Empty state -->
      <div v-if="initialLoadComplete && items.length === 0 && !loading" class="mt-12 text-center text-sm text-muted-foreground">
        <p v-if="activeFilterCount > 0">No series match your filters.</p>
        <p v-else>No series found in your libraries.</p>
      </div>

      <!-- Error state -->
      <div v-if="error" class="mt-8 text-center text-sm text-destructive">{{ error }}</div>

      <!-- Infinite scroll sentinel -->
      <div ref="sentinel" class="h-px" />
    </main>
  </section>
</template>

<style scoped>
.series-search-input::-webkit-search-decoration,
.series-search-input::-webkit-search-cancel-button,
.series-search-input::-webkit-search-results-button,
.series-search-input::-webkit-search-results-decoration,
.mobile-search-input::-webkit-search-decoration,
.mobile-search-input::-webkit-search-cancel-button,
.mobile-search-input::-webkit-search-results-button,
.mobile-search-input::-webkit-search-results-decoration {
  -webkit-appearance: none;
  appearance: none;
}

.series-search-input::-ms-clear,
.series-search-input::-ms-reveal,
.mobile-search-input::-ms-clear,
.mobile-search-input::-ms-reveal {
  display: none;
  width: 0;
  height: 0;
}

.series-grid {
  grid-template-columns: repeat(auto-fill, minmax(var(--series-card-width), 1fr));
}

@media (max-width: 639px) {
  .series-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
