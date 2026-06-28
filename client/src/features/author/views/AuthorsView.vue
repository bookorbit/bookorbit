<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpDown, CheckCheck, Filter, RefreshCcw, Search, SlidersHorizontal, Trash2, X } from '@lucide/vue'
import { toast } from 'vue-sonner'

import SelectionActionBar from '@/components/SelectionActionBar.vue'
import ViewHeader from '@/components/ViewHeader.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useScrollRestoreOnActivate } from '@/features/book/composables/useScrollRestoreOnActivate'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { bulkRefreshAuthorsMetadata, deleteAuthors, refreshAuthorMetadata } from '../api/author'
import AuthorCard from '../components/AuthorCard.vue'
import AuthorConfirmDialog from '../components/AuthorConfirmDialog.vue'
import AuthorFilters from '../components/AuthorFilters.vue'
import AuthorListRow from '../components/AuthorListRow.vue'
import { useAuthorSelection } from '../composables/useAuthorSelection'
import { useAuthorsList } from '../composables/useAuthorsList'
import { useRefreshingAuthors } from '../composables/useRefreshingAuthors'
import type { AuthorListSort, SortDirection } from '../types/author'
import type { BookViewMode } from '@/composables/useDisplaySettings'

const router = useRouter()
const route = useRoute()
const mainRef = ref<HTMLElement | null>(null)
useScrollRestoreOnActivate(mainRef)
const { gridGap, viewMode, authorCoverSize, authorCoverShape } = useDisplaySettings()
const { libraries, fetchLibraries } = useLibraries()
const { hasPermission, isDemoRestrictedAccount, isSuperuser } = usePermissions()
const { items, total, loading, error, hasMore, q, sort, order, libraryId, hasPhoto, minBookCount, load } = useAuthorsList()
const { markRefreshing, clearRefreshing, isRefreshing } = useRefreshingAuthors()
const { selectionMode, selectedIds, selectedCount, enterSelectionMode, exitSelectionMode, toggleAuthor, rangeSelectTo, selectAll, isSelected } =
  useAuthorSelection()

const hydrating = ref(true)
const suppressAutoReload = ref(false)
const filtersOpen = ref(false)
const mobileControlsExpanded = ref(false)
const initialLoadComplete = ref(false)
const INITIAL_SKELETON_COUNT = 18

const sentinel = ref<HTMLElement | null>(null)
const mobileSearchInput = ref<HTMLInputElement | null>(null)
let observer: IntersectionObserver | null = null
let searchTimer: ReturnType<typeof setTimeout> | null = null

const bulkRefreshing = ref(false)
const bulkDeleting = ref(false)
const deletingAuthorId = ref<number | null>(null)
const confirmingBulkDelete = ref(false)

const pendingDeleteIds = ref<number[]>([])
const deleteDialogOpen = ref(false)

const canRefreshMetadata = computed(() => hasPermission('library_edit_metadata') && !isDemoRestrictedAccount.value)
const canDeleteAuthors = computed(() => isSuperuser.value)
const authorViewMode = computed<BookViewMode>({
  get: () => (viewMode.value === 'table' ? 'grid' : viewMode.value),
  set: (next) => {
    viewMode.value = next === 'table' ? 'grid' : next
  },
})

const SORT_LABELS: Record<AuthorListSort, string> = {
  name: 'Name',
  sortName: 'Sort Name',
  bookCount: 'Book Count',
  lastAddedAt: 'Recent Additions',
  lastEnrichedAt: 'Last Enriched',
}

const isDefaultSort = computed(() => sort.value === 'name' && order.value === 'asc')

const sortSummary = computed(() => `${SORT_LABELS[sort.value]} ${order.value === 'asc' ? '↑' : '↓'}`)

const activeFilterCount = computed(() => {
  let count = 0
  if (q.value.trim()) count += 1
  if (libraryId.value !== null) count += 1
  if (hasPhoto.value !== null) count += 1
  if (minBookCount.value !== null) count += 1
  return count
})
const mobileControlsBadgeCount = computed(() => activeFilterCount.value + (!isDefaultSort.value ? 1 : 0))

const deleteDialogLoading = computed(() => {
  if (bulkDeleting.value) return true
  if (pendingDeleteIds.value.length !== 1) return false
  return deletingAuthorId.value === pendingDeleteIds.value[0]
})

const deleteDialogTitle = computed(() => {
  if (pendingDeleteIds.value.length > 1) return `Delete ${pendingDeleteIds.value.length} authors?`
  return 'Delete author?'
})

const deleteDialogDescription = computed(() => {
  if (pendingDeleteIds.value.length > 1) {
    return 'This removes selected authors from the catalog and unlinks them from associated books. This action cannot be undone.'
  }
  return 'This removes the author from the catalog and unlinks it from associated books. This action cannot be undone.'
})

function showRefreshResultToast(updated: { imageUrl?: string | null }) {
  if (!updated.imageUrl) {
    toast.warning('Metadata refreshed, but no author image was found.')
    return
  }
  toast.success('Author metadata refreshed')
}

function parseSort(value: unknown): AuthorListSort {
  return value === 'sortName' || value === 'bookCount' || value === 'lastAddedAt' || value === 'lastEnrichedAt' || value === 'name' ? value : 'name'
}

function parseOrder(value: unknown): SortDirection {
  return value === 'desc' || value === 'asc' ? value : 'asc'
}

function parseLibraryId(value: unknown): number | null {
  const raw = typeof value === 'string' ? Number(value) : NaN
  return Number.isInteger(raw) && raw > 0 ? raw : null
}

function parseHasPhoto(value: unknown): boolean | null {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function parseMinBookCount(value: unknown): number | null {
  const raw = typeof value === 'string' ? parseInt(value, 10) : NaN
  return Number.isInteger(raw) && raw >= 1 ? raw : null
}

function syncRouteQuery() {
  void router.replace({
    name: 'authors',
    query: {
      q: q.value.trim() || undefined,
      sort: sort.value !== 'name' ? sort.value : undefined,
      order: order.value !== 'asc' ? order.value : undefined,
      libraryId: libraryId.value ? String(libraryId.value) : undefined,
      hasPhoto: hasPhoto.value !== null ? String(hasPhoto.value) : undefined,
      minBookCount: minBookCount.value !== null ? String(minBookCount.value) : undefined,
    },
  })
}

function openAuthor(authorId: number) {
  void router.push({ name: 'author-detail', params: { id: authorId }, query: { from: route.fullPath } })
}

function setSortField(field: AuthorListSort) {
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

function clearSearchQuery() {
  q.value = ''
}

function onMobileSortChange(event: Event) {
  const value = parseSort((event.target as HTMLSelectElement).value)
  setSortField(value)
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

function handleAuthorSelect(authorId: number, event: MouseEvent) {
  if (!selectionMode.value) {
    enterSelectionMode()
  }

  if (event.shiftKey) {
    rangeSelectTo(
      authorId,
      items.value.map((item) => item.id),
    )
    return
  }
  toggleAuthor(authorId)
}

function toggleSelectionMode() {
  if (selectionMode.value) exitSelectionMode()
  else enterSelectionMode()
}

function selectAllVisible() {
  selectAll(items.value.map((item) => item.id))
}

async function clearFilters() {
  if (selectionMode.value) exitSelectionMode()
  if (searchTimer) clearTimeout(searchTimer)

  suppressAutoReload.value = true
  q.value = ''
  sort.value = 'name'
  order.value = 'asc'
  libraryId.value = null
  hasPhoto.value = null
  minBookCount.value = null

  syncRouteQuery()
  await load(true)
  filtersOpen.value = false

  await nextTick()
  suppressAutoReload.value = false
}

async function refreshSelectedAuthorsMetadata() {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || bulkRefreshing.value || !canRefreshMetadata.value) return

  bulkRefreshing.value = true
  markRefreshing(ids)
  try {
    const result = await bulkRefreshAuthorsMetadata(ids, (event) => {
      if (event.imageUpdated) {
        const index = items.value.findIndex((item) => item.id === event.authorId)
        if (index !== -1) {
          const next = [...items.value]
          const current = next[index]
          if (!current) return
          next[index] = {
            ...current,
            imageUrl: event.imageUrl ?? null,
          }
          items.value = next
        }
      }
      clearRefreshing([event.authorId])
    })

    if (result.failed > 0) {
      toast.warning(`Refreshed ${result.updated} author(s), ${result.failed} failed`)
    } else {
      toast.success(`Refreshed metadata for ${result.updated} author(s)`)
    }
  } catch (actionError) {
    toast.error(actionError instanceof Error ? actionError.message : 'Failed to refresh selected authors')
  } finally {
    clearRefreshing(ids)
    bulkRefreshing.value = false
  }
}

async function refreshSingleAuthorMetadata(authorId: number) {
  if (!canRefreshMetadata.value || isRefreshing(authorId)) return

  markRefreshing([authorId])
  try {
    const updated = await refreshAuthorMetadata(authorId)
    const index = items.value.findIndex((item) => item.id === authorId)
    if (index !== -1) {
      const next = [...items.value]
      const current = next[index]
      if (!current) return
      next[index] = { ...current, ...updated }
      items.value = next
    }
    showRefreshResultToast(updated)
  } catch (actionError) {
    toast.error(actionError instanceof Error ? actionError.message : 'Failed to refresh author metadata')
  } finally {
    clearRefreshing([authorId])
  }
}

function promptDeleteSingleAuthor(authorId: number) {
  if (!canDeleteAuthors.value || deletingAuthorId.value === authorId) return
  pendingDeleteIds.value = [authorId]
  deleteDialogOpen.value = true
}

function confirmDeleteSelectedFromPopover() {
  if (!canDeleteAuthors.value || selectedCount.value === 0 || bulkDeleting.value) return
  pendingDeleteIds.value = [...selectedIds.value]
  confirmingBulkDelete.value = false
  void confirmDeleteAuthors()
}

function cancelDeleteAuthors() {
  if (deleteDialogLoading.value) return
  deleteDialogOpen.value = false
  pendingDeleteIds.value = []
}

async function confirmDeleteAuthors() {
  const ids = [...pendingDeleteIds.value]
  if (!canDeleteAuthors.value || ids.length === 0) return

  const singleAuthorId: number | null = ids.length === 1 ? (ids[0] ?? null) : null
  deleteDialogOpen.value = false

  if (singleAuthorId !== null) {
    deletingAuthorId.value = singleAuthorId
  } else {
    bulkDeleting.value = true
  }

  try {
    const result = await deleteAuthors({ authorIds: ids })
    await load(true)
    if (ids.length > 1) exitSelectionMode()

    const noun = result.deletedAuthorIds.length === 1 ? 'author' : 'authors'
    toast.success(`Deleted ${result.deletedAuthorIds.length} ${noun}; affected ${result.affectedBookCount} books`)
  } catch (actionError) {
    toast.error(actionError instanceof Error ? actionError.message : 'Failed to delete author(s)')
  } finally {
    if (singleAuthorId !== null) {
      deletingAuthorId.value = null
    } else {
      bulkDeleting.value = false
    }
    pendingDeleteIds.value = []
  }
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
  hasPhoto.value = parseHasPhoto(route.query.hasPhoto)
  minBookCount.value = parseMinBookCount(route.query.minBookCount)

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

watch([sort, order, libraryId, hasPhoto, minBookCount], () => {
  if (hydrating.value || suppressAutoReload.value) return
  if (selectionMode.value) exitSelectionMode()
  syncRouteQuery()
  void load(true)
})

watch(q, () => {
  if (hydrating.value || suppressAutoReload.value) return
  if (selectionMode.value) exitSelectionMode()
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

watch(
  [selectionMode, selectedCount],
  ([mode, count]) => {
    if (!mode || count === 0) confirmingBulkDelete.value = false
  },
  { flush: 'post' },
)

defineOptions({ name: 'AuthorsView' })
</script>

<template>
  <div class="flex h-full flex-col">
    <section class="flex flex-1 flex-col min-h-0">
      <ViewHeader
        title="Authors"
        icon="Users"
        fallback-icon="Users"
        :total="total"
        v-model:coverSize="authorCoverSize"
        v-model:gridGap="gridGap"
        v-model:viewMode="authorViewMode"
        v-model:coverShape="authorCoverShape"
        :allowed-view-modes="['grid', 'list']"
        :selection-mode="selectionMode"
        @toggle-selection="toggleSelectionMode"
      >
        <template #toolbar>
          <div class="hidden lg:flex h-8 w-64 items-center rounded-md border border-input bg-background px-2.5">
            <Search :size="13" class="mr-1.5 shrink-0 text-muted-foreground/85" />
            <input
              v-model="q"
              type="search"
              placeholder="Search authors"
              class="author-search-input h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/85"
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
                    v-for="field in ['name', 'sortName', 'bookCount', 'lastAddedAt', 'lastEnrichedAt'] as const"
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
            @click="toggleFiltersOpen"
            class="hidden sm:flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm transition-colors"
            :class="
              activeFilterCount > 0
                ? 'border-primary text-primary bg-primary/10'
                : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
            "
          >
            <Filter :size="13" />
            <span>Filters</span>
            <span v-if="activeFilterCount > 0" class="text-xs font-semibold">({{ activeFilterCount }})</span>
          </button>

          <button
            v-if="activeFilterCount > 0 || !isDefaultSort"
            @click="clearFilters"
            class="hidden sm:flex h-8 items-center gap-1 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:text-destructive"
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

      <section v-if="mobileControlsExpanded" class="mb-3 space-y-2 rounded-lg border border-border/70 bg-card/70 p-2 sm:hidden">
        <div class="flex items-center gap-1 rounded-md border border-input bg-background px-2.5">
          <Search :size="13" class="shrink-0 text-muted-foreground/85" />
          <input
            ref="mobileSearchInput"
            v-model="q"
            type="search"
            placeholder="Search authors"
            class="mobile-search-input h-9 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/85"
          />
          <button v-if="q.trim()" class="text-muted-foreground/85 transition-colors hover:text-foreground" @click="clearSearchQuery">
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
              <option v-for="field in ['name', 'sortName', 'bookCount', 'lastAddedAt', 'lastEnrichedAt'] as const" :key="field" :value="field">
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

        <AuthorFilters
          v-model:library-id="libraryId"
          v-model:has-photo="hasPhoto"
          v-model:min-book-count="minBookCount"
          :active-count="activeFilterCount"
          embedded
          :libraries="libraries.map((library) => ({ id: library.id, name: library.name }))"
          @clear="clearFilters"
        />
      </section>

      <!-- Desktop filters panel rendered outside <main> so it stays anchored when the list is scrolled -->
      <div v-if="filtersOpen && !mobileControlsExpanded" class="pr-2">
        <AuthorFilters
          v-model:library-id="libraryId"
          v-model:has-photo="hasPhoto"
          v-model:min-book-count="minBookCount"
          :active-count="activeFilterCount"
          closable
          :libraries="libraries.map((library) => ({ id: library.id, name: library.name }))"
          @clear="clearFilters"
          @close="closeFiltersPanel"
        />
      </div>

      <main ref="mainRef" class="flex-1 min-h-0 overflow-y-auto pr-2">
        <div v-if="error" class="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {{ error }}
        </div>

        <div
          v-if="!initialLoadComplete && loading"
          class="grid"
          :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${authorCoverSize}px, 1fr))`, gap: `${gridGap}px` }"
        >
          <div
            v-for="index in INITIAL_SKELETON_COUNT"
            :key="`author-skeleton-${index}`"
            class="w-full animate-pulse bg-muted/50"
            :class="authorCoverShape === 'circle' ? 'rounded-full aspect-square' : 'rounded-sm aspect-[2/3]'"
          />
        </div>

        <div v-if="!loading && items.length === 0" class="flex flex-col items-center justify-center gap-2 py-24 text-center">
          <p class="text-sm font-medium text-foreground">No authors found</p>
          <p class="text-xs text-muted-foreground">Try changing search text, sort, or library filter.</p>
        </div>

        <div
          v-show="authorViewMode === 'grid' && items.length > 0"
          class="grid"
          :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${authorCoverSize}px, 1fr))`, gap: `${gridGap}px` }"
        >
          <AuthorCard
            v-for="author in items"
            :key="author.id"
            :author="author"
            :shape="authorCoverShape"
            :selection-mode="selectionMode"
            :selected="isSelected(author.id)"
            :can-refresh="canRefreshMetadata"
            :can-delete="canDeleteAuthors"
            :refreshing="isRefreshing(author.id)"
            :deleting="deletingAuthorId === author.id"
            @open="openAuthor"
            @select="handleAuthorSelect(author.id, $event)"
            @refresh="refreshSingleAuthorMetadata"
            @delete="promptDeleteSingleAuthor"
          />
        </div>

        <div v-show="authorViewMode === 'list' && items.length > 0" class="flex flex-col divide-y divide-border">
          <AuthorListRow
            v-for="author in items"
            :key="author.id"
            :author="author"
            :selection-mode="selectionMode"
            :selected="isSelected(author.id)"
            :refreshing="isRefreshing(author.id)"
            @open="openAuthor"
            @select="handleAuthorSelect(author.id, $event)"
          />
        </div>

        <div ref="sentinel" class="mt-4 flex h-8 items-center justify-center">
          <span v-if="loading" class="text-xs text-muted-foreground">Loading...</span>
          <span v-else-if="initialLoadComplete && !hasMore && items.length > 0" class="text-xs text-muted-foreground">
            All {{ total.toLocaleString() }} authors loaded
          </span>
        </div>
      </main>
    </section>

    <SelectionActionBar :visible="selectionMode" :count="selectedCount" @exit="exitSelectionMode">
      <template #content>
        <template v-if="!confirmingBulkDelete">
          <span class="px-2.5 py-0.5 text-sm font-semibold tabular-nums whitespace-nowrap rounded-full bg-primary/10 text-primary">{{
            selectedCount
          }}</span>

          <div class="w-px h-5 bg-border mx-1 shrink-0" />

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                :disabled="selectedCount === 0"
                class="h-9 w-9 flex items-center justify-center rounded-full transition-colors"
                :class="
                  selectedCount > 0 ? 'text-foreground hover:bg-primary hover:text-primary-foreground' : 'text-muted-foreground/60 cursor-not-allowed'
                "
                @click="selectAllVisible"
              >
                <CheckCheck :size="17" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Select visible</TooltipContent>
          </Tooltip>

          <Tooltip v-if="canRefreshMetadata">
            <TooltipTrigger as-child>
              <button
                :disabled="selectedCount === 0 || bulkRefreshing"
                class="h-9 w-9 flex items-center justify-center rounded-full transition-colors"
                :class="selectedCount > 0 ? 'text-foreground hover:bg-muted' : 'text-muted-foreground/60 cursor-not-allowed'"
                @click="refreshSelectedAuthorsMetadata"
              >
                <RefreshCcw :size="17" :class="bulkRefreshing ? 'animate-spin' : ''" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{{ bulkRefreshing ? 'Refreshing metadata...' : 'Refresh metadata' }}</TooltipContent>
          </Tooltip>

          <Tooltip v-if="canDeleteAuthors">
            <TooltipTrigger as-child>
              <button
                :disabled="selectedCount === 0 || bulkDeleting"
                class="h-9 w-9 flex items-center justify-center rounded-full transition-colors"
                :class="
                  selectedCount > 0
                    ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground'
                    : 'text-muted-foreground/60 cursor-not-allowed'
                "
                @click="confirmingBulkDelete = true"
              >
                <Trash2 :size="17" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{{ bulkDeleting ? 'Deleting...' : 'Delete selected' }}</TooltipContent>
          </Tooltip>

          <div class="w-px h-5 bg-border mx-1 shrink-0" />

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="h-9 w-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                @click="exitSelectionMode"
              >
                <X :size="17" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Exit selection</TooltipContent>
          </Tooltip>
        </template>

        <template v-else>
          <span class="px-3 text-sm font-semibold text-destructive whitespace-nowrap"
            >Delete {{ selectedCount }} author{{ selectedCount === 1 ? '' : 's' }}?</span
          >

          <div class="w-px h-5 bg-border mx-1 shrink-0" />

          <button
            class="h-8 px-3 rounded-full text-sm font-medium text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
            :disabled="bulkDeleting"
            @click="confirmDeleteSelectedFromPopover"
          >
            {{ bulkDeleting ? 'Deleting...' : 'Delete' }}
          </button>

          <button
            class="h-8 px-3 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            :disabled="bulkDeleting"
            @click="confirmingBulkDelete = false"
          >
            Cancel
          </button>
        </template>
      </template>
    </SelectionActionBar>

    <AuthorConfirmDialog
      :open="deleteDialogOpen"
      :title="deleteDialogTitle"
      :description="deleteDialogDescription"
      confirm-label="Delete"
      :loading="deleteDialogLoading"
      destructive
      @confirm="confirmDeleteAuthors"
      @cancel="cancelDeleteAuthors"
    />
  </div>
</template>

<style scoped>
.author-search-input::-webkit-search-decoration,
.author-search-input::-webkit-search-cancel-button,
.author-search-input::-webkit-search-results-button,
.author-search-input::-webkit-search-results-decoration,
.mobile-search-input::-webkit-search-decoration,
.mobile-search-input::-webkit-search-cancel-button,
.mobile-search-input::-webkit-search-results-button,
.mobile-search-input::-webkit-search-results-decoration {
  -webkit-appearance: none;
  appearance: none;
}

.author-search-input::-ms-clear,
.author-search-input::-ms-reveal,
.mobile-search-input::-ms-clear,
.mobile-search-input::-ms-reveal {
  display: none;
  width: 0;
  height: 0;
}
</style>
