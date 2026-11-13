<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { Search, Shapes, Tags } from '@lucide/vue'
import type { TaxonomyIndexSort, TaxonomyKind } from '@bookorbit/types'

import BrowseHeader from '@/components/browse-header/BrowseHeader.vue'
import BrowseLibraryPicker from '@/components/browse-header/BrowseLibraryPicker.vue'
import BrowseSearchField from '@/components/browse-header/BrowseSearchField.vue'
import BrowseSortControl from '@/components/browse-header/BrowseSortControl.vue'
import { barDivider } from '@/components/browse-header/browse-header'
import { useScrollRestoreOnActivate } from '@/features/book/composables/useScrollRestoreOnActivate'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { formatNumber } from '@/i18n/formatters'
import { storage } from '@/services/storage'
import type { SortDirection } from '../api/taxonomy'
import TaxonomyCloud from '../components/TaxonomyCloud.vue'
import TaxonomyIndexTable from '../components/TaxonomyIndexTable.vue'
import TaxonomyKindSwitch from '../components/TaxonomyKindSwitch.vue'
import TaxonomyViewToggle from '../components/TaxonomyViewToggle.vue'
import { useTaxonomyList } from '../composables/useTaxonomyList'
import { groupByLetter, taxonomyRouteNames, type TaxonomyViewMode } from '../lib/taxonomy-text'

/** `/genres` and `/tags`: every name with books the reader can see, as a table or a cloud. */
const props = defineProps<{ kind: TaxonomyKind }>()

const { t } = useI18n()
const router = useRouter()
const route = useRoute()

const mainRef = ref<HTMLElement | null>(null)
useScrollRestoreOnActivate(mainRef)

const { libraries, fetchLibraries } = useLibraries()
const { items, totals, top, loading, error, hasMore, q, sort, order, libraryId, load, loadTop } = useTaxonomyList(props.kind)

const VIEW_MODE_KEY = 'bookorbit:taxonomyIndexView'
const SORT_FIELDS: TaxonomyIndexSort[] = ['bookCount', 'name', 'readProgress', 'lastAddedAt']
/** The table leads with the biggest names; the cloud reads best alphabetically. */
const DEFAULT_SORT: Record<TaxonomyViewMode, { sort: TaxonomyIndexSort; order: SortDirection }> = {
  list: { sort: 'bookCount', order: 'desc' },
  cloud: { sort: 'name', order: 'asc' },
}
const SEARCH_DEBOUNCE_MS = 250

const viewMode = ref<TaxonomyViewMode>(storage.get<string>(VIEW_MODE_KEY, 'list') === 'cloud' ? 'cloud' : 'list')
const hydrating = ref(true)
const initialLoadComplete = ref(false)
/** The search the loaded rows answer, so highlighting and grouping never run ahead of the request. */
const appliedQuery = ref('')
const sentinel = ref<HTMLElement | null>(null)

let observer: IntersectionObserver | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null

const routeNames = taxonomyRouteNames(props.kind)
const isTag = props.kind === 'tag'

const title = computed(() => (isTag ? t('taxonomy.index.tagsTitle') : t('taxonomy.index.genresTitle')))
const kindTotal = computed(() => totals.value[props.kind])
const countFact = computed(() =>
  isTag ? t('taxonomy.index.tagCount', { count: kindTotal.value }) : t('taxonomy.index.genreCount', { count: kindTotal.value }),
)
const foldedCount = computed(() => formatNumber(kindTotal.value))

const sortLabels = computed<Record<TaxonomyIndexSort, string>>(() => ({
  bookCount: t('taxonomy.index.sort.bookCount'),
  name: t('taxonomy.index.sort.name'),
  readProgress: t('taxonomy.index.sort.readProgress'),
  lastAddedAt: t('taxonomy.index.sort.lastAddedAt'),
  libraryCount: t('taxonomy.index.sort.libraryCount'),
}))

const isDefaultSort = computed(() => sort.value === DEFAULT_SORT[viewMode.value].sort && order.value === DEFAULT_SORT[viewMode.value].order)
const grouped = computed(() => sort.value === 'name' && !appliedQuery.value)
const groups = computed(() => groupByLetter(items.value, grouped.value))
const cloudTop = computed(() => (viewMode.value === 'cloud' && grouped.value ? top.value : []))
const showSkeleton = computed(() => !initialLoadComplete.value && items.value.length === 0)

const libraryOptions = computed(() => libraries.value.map(({ id, name, bookCount }) => ({ id, name, bookCount })))

function parseSort(value: unknown): TaxonomyIndexSort | null {
  return SORT_FIELDS.includes(value as TaxonomyIndexSort) ? (value as TaxonomyIndexSort) : null
}

function parseOrder(value: unknown): SortDirection | null {
  return value === 'asc' || value === 'desc' ? value : null
}

function parseLibraryId(value: unknown): number | null {
  const raw = typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(raw) && raw > 0 ? raw : null
}

function syncRouteQuery() {
  const defaults = DEFAULT_SORT[viewMode.value]
  void router.replace({
    name: routeNames.index,
    query: {
      q: q.value.trim() || undefined,
      sort: sort.value !== defaults.sort ? sort.value : undefined,
      order: sort.value !== defaults.sort || order.value !== defaults.order ? order.value : undefined,
      libraryId: libraryId.value ? String(libraryId.value) : undefined,
    },
  })
}

async function reload() {
  appliedQuery.value = q.value.trim()
  await load(true)
}

function refreshTop() {
  if (viewMode.value === 'cloud') void loadTop()
}

function openItem(id: number) {
  void router.push({
    name: routeNames.detail,
    params: { id },
    query: libraryId.value ? { libraryId: String(libraryId.value) } : undefined,
  })
}

function selectKind(kind: TaxonomyKind) {
  void router.push({
    name: taxonomyRouteNames(kind).index,
    query: libraryId.value ? { libraryId: String(libraryId.value) } : undefined,
  })
}

function setSortField(field: TaxonomyIndexSort) {
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
  sort.value = DEFAULT_SORT[viewMode.value].sort
  order.value = DEFAULT_SORT[viewMode.value].order
}

function setViewMode(mode: TaxonomyViewMode) {
  viewMode.value = mode
  storage.set(VIEW_MODE_KEY, mode)
  if (mode === 'cloud' && sort.value === 'bookCount') {
    sort.value = 'name'
    order.value = 'asc'
  }
  refreshTop()
}

function setSearch(value: string) {
  q.value = value
}

function setLibraryId(value: number | null) {
  libraryId.value = value
}

function clearSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  if (!q.value) return
  q.value = ''
}

function loadIfSentinelVisible() {
  if (loading.value || !hasMore.value || !sentinel.value) return
  if (sentinel.value.getBoundingClientRect().top < window.innerHeight + 250) void load()
}

onMounted(async () => {
  const defaults = DEFAULT_SORT[viewMode.value]
  q.value = typeof route.query.q === 'string' ? route.query.q : ''
  sort.value = parseSort(route.query.sort) ?? defaults.sort
  order.value = parseOrder(route.query.order) ?? (sort.value === defaults.sort ? defaults.order : sort.value === 'name' ? 'asc' : 'desc')
  libraryId.value = parseLibraryId(route.query.libraryId)

  void fetchLibraries()
  // Let the watchers see the restored state while hydrating, so it does not load twice.
  await nextTick()
  hydrating.value = false

  refreshTop()
  await reload()
  initialLoadComplete.value = true

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !loading.value) void load()
    },
    { root: mainRef.value, rootMargin: '280px' },
  )
  await nextTick()
  if (sentinel.value) observer.observe(sentinel.value)
})

onUnmounted(() => {
  observer?.disconnect()
  if (searchTimer) clearTimeout(searchTimer)
})

watch([sort, order], () => {
  if (hydrating.value) return
  syncRouteQuery()
  void reload()
})

watch(libraryId, () => {
  if (hydrating.value) return
  syncRouteQuery()
  refreshTop()
  void reload()
})

watch(q, () => {
  if (hydrating.value) return
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    syncRouteQuery()
    void reload()
  }, SEARCH_DEBOUNCE_MS)
})

watch(
  loading,
  (isLoading) => {
    if (!isLoading) loadIfSentinelVisible()
  },
  { flush: 'post' },
)

defineOptions({ name: 'TaxonomyIndexView' })
</script>

<template>
  <section class="flex h-full flex-col">
    <BrowseHeader
      :eyebrow="t('components.browseHeader.eyebrow.browse')"
      :title="title"
      :icon="isTag ? 'Tags' : 'Shapes'"
      :fallback-icon="isTag ? 'Tags' : 'Shapes'"
      :folded-count="foldedCount"
      :scroll-container="mainRef"
    >
      <template #facts>
        <span class="truncate">{{ countFact }}</span>
      </template>

      <template #bar>
        <BrowseSearchField
          :model-value="q"
          :placeholder="isTag ? t('taxonomy.index.searchTags') : t('taxonomy.index.searchGenres')"
          :active="q.trim().length > 0"
          @update:model-value="setSearch"
          @clear="clearSearch"
        />
        <span :class="barDivider" aria-hidden="true" />
        <BrowseSortControl
          :label="sortLabels[sort]"
          :direction="order"
          :changed="!isDefaultSort"
          popover-class="w-56 p-2"
          @toggle-direction="toggleSortDirection"
        >
          <div class="mb-2 px-1 text-xs font-medium text-muted-foreground">{{ t('taxonomy.index.sortBy') }}</div>
          <div class="flex flex-col gap-0.5">
            <button
              v-for="field in SORT_FIELDS"
              :key="field"
              type="button"
              class="flex items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted"
              :class="sort === field ? 'font-medium text-foreground' : 'text-muted-foreground'"
              :aria-pressed="sort === field"
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
              class="w-full rounded-md px-2 py-1.5 text-start text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
              @click="resetSort"
            >
              {{ t('common.resetSortAria') }}
            </button>
          </template>
        </BrowseSortControl>
        <span :class="barDivider" aria-hidden="true" />
        <TaxonomyKindSwitch :kind="kind" :totals="totals" @select="selectKind" />
        <BrowseLibraryPicker
          v-if="libraryOptions.length > 1"
          hide-on-phone
          show-counts
          :menu-label="t('taxonomy.index.countBooksIn')"
          :libraries="libraryOptions"
          :model-value="libraryId"
          @update:model-value="setLibraryId"
        />
        <span :class="barDivider" class="hidden md:block" aria-hidden="true" />
        <TaxonomyViewToggle :model-value="viewMode" @update:model-value="setViewMode" />
      </template>
    </BrowseHeader>

    <main ref="mainRef" class="taxonomy-index-main min-h-0 flex-1 overflow-x-hidden overflow-y-auto pe-2">
      <div v-if="showSkeleton" class="overflow-hidden rounded-xl border border-border bg-card" aria-hidden="true">
        <div v-for="n in 12" :key="n" class="flex h-[54px] items-center gap-3.5 border-b border-border px-3.5 last:border-b-0">
          <div class="flex w-[88px] shrink-0">
            <div class="h-[39px] w-[26px] animate-pulse rounded-[2px] bg-muted" />
          </div>
          <div class="min-w-0 flex-1 space-y-2">
            <div class="h-3 w-1/4 rounded-xs bg-muted" />
            <div class="h-2.5 w-1/6 rounded-xs bg-muted" />
          </div>
          <div class="h-3 w-10 rounded-xs bg-muted" />
        </div>
      </div>

      <template v-else-if="items.length > 0">
        <TaxonomyIndexTable
          v-if="viewMode === 'list'"
          :kind="kind"
          :groups="groups"
          :sort="sort"
          :order="order"
          :query="appliedQuery"
          @open="openItem"
          @sort="setSortField"
        />
        <TaxonomyCloud v-else :kind="kind" :groups="groups" :top="cloudTop" :query="appliedQuery" :library-id="libraryId" />
      </template>

      <div
        v-else-if="initialLoadComplete && !loading && !error"
        class="grid place-items-center gap-2 px-4 py-16 text-center text-[13px] text-muted-foreground"
      >
        <template v-if="appliedQuery">
          <Search :size="22" aria-hidden="true" />
          <p class="text-[15px] font-semibold text-foreground">
            {{ isTag ? t('taxonomy.index.noTagMatch', { query: appliedQuery }) : t('taxonomy.index.noGenreMatch', { query: appliedQuery }) }}
          </p>
          <p>{{ t('taxonomy.index.noMatchHint') }}</p>
          <button
            type="button"
            class="h-[30px] rounded-lg border border-border bg-card px-3 text-[13px] text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            @click="clearSearch"
          >
            {{ t('taxonomy.index.clearSearch') }}
          </button>
        </template>
        <template v-else>
          <component :is="isTag ? Tags : Shapes" :size="22" aria-hidden="true" />
          <p class="text-[15px] font-semibold text-foreground">{{ isTag ? t('taxonomy.index.noTags') : t('taxonomy.index.noGenres') }}</p>
          <p class="max-w-sm">{{ isTag ? t('taxonomy.index.noTagsHint') : t('taxonomy.index.noGenresHint') }}</p>
        </template>
      </div>

      <p v-if="error" role="alert" class="mt-8 text-center text-sm text-destructive">{{ t('taxonomy.index.loadError') }}</p>

      <div ref="sentinel" class="h-px" />
    </main>
  </section>
</template>

<style scoped>
/* Where the table goes edge to edge, the scroller widens to the shell's edges and pads its content
   back in, so the table's bleed is not clipped by the scroller's own overflow. */
@media (max-width: 768px) {
  .taxonomy-index-main {
    margin-inline: calc(var(--shell-content-gutter) * -1) calc(var(--shell-gap) * -1);
    padding-inline: var(--shell-content-gutter) var(--shell-gap);
  }
}
</style>
