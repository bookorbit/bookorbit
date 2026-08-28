<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { useRoute, useRouter } from 'vue-router'
import { ArrowUpDown, CheckCheck, RefreshCcw, Trash2, X } from '@lucide/vue'
import { toast } from 'vue-sonner'

import SelectionActionBar from '@/components/SelectionActionBar.vue'
import ViewHeader from '@/components/ViewHeader.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useScrollRestoreOnActivate } from '@/features/book/composables/useScrollRestoreOnActivate'
import { useLibraries } from '@/features/library/composables/useLibraries'
import JumpRail from '@/features/book/components/JumpRail.vue'
import { bulkRefreshAuthorsMetadata, deleteAuthors, refreshAuthorMetadata } from '../api/author'
import AuthorConfirmDialog from '../components/AuthorConfirmDialog.vue'
import AuthorFilterChips from '../components/AuthorFilterChips.vue'
import AuthorIndexRow from '../components/AuthorIndexRow.vue'
import AuthorTile from '../components/AuthorTile.vue'
import { useAuthorJumpRail } from '../composables/useAuthorJumpRail'
import { useAuthorSelection } from '../composables/useAuthorSelection'
import { useAuthorsList } from '../composables/useAuthorsList'
import { useRefreshingAuthors } from '../composables/useRefreshingAuthors'
import { authorLetterKey, isLetterSort } from '../lib/author-identity'
import { RECENTLY_ADDED_DAYS, type AuthorListSort, type AuthorQuickFilter, type AuthorSummary, type SortDirection } from '../types/author'
import type { BookViewMode } from '@/composables/useDisplaySettings'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const mainRef = ref<HTMLElement | null>(null)
useScrollRestoreOnActivate(mainRef)
const { gridGap, viewMode, authorCoverSize, authorCoverShape, authorRowDensity, authorCoverFallback, showJumpRails } = useDisplaySettings()
const { libraries, fetchLibraries } = useLibraries()
const { hasPermission, isDemoRestrictedAccount, isSuperuser } = usePermissions()
const list = useAuthorsList()
const { items, total, loading, error, hasMore, q, sort, order, libraryId, hasPhoto, hasSortName, addedWithinDays, minBookCount, load } = list
const { markRefreshing, clearRefreshing, isRefreshing } = useRefreshingAuthors()
const { selectionMode, selectedIds, selectedCount, enterSelectionMode, exitSelectionMode, toggleAuthor, rangeSelectTo, selectAll, isSelected } =
  useAuthorSelection()

const hydrating = ref(true)
const suppressAutoReload = ref(false)
const initialLoadComplete = ref(false)
const INITIAL_SKELETON_COUNT = 24

const sentinel = ref<HTMLElement | null>(null)
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

/** The page offers exactly the two views the design has; `table` is not one of them. */
const authorViewMode = computed<BookViewMode>({
  get: () => (viewMode.value === 'table' ? 'grid' : viewMode.value),
  set: (next) => {
    viewMode.value = next === 'table' ? 'grid' : next
  },
})
const isGallery = computed(() => authorViewMode.value === 'grid')

const sortLabels = computed<Record<AuthorListSort, string>>(() => ({
  name: t('author.list.sort.name'),
  sortName: t('author.list.sort.sortName'),
  bookCount: t('author.list.sort.bookCount'),
  lastAddedAt: t('author.list.sort.recentAdditions'),
  lastEnrichedAt: t('author.list.sort.lastEnriched'),
}))

const isDefaultSort = computed(() => sort.value === 'name' && order.value === 'asc')
const sortSummary = computed(() => `${sortLabels.value[sort.value]} ${order.value === 'asc' ? '↑' : '↓'}`)

/* ── quick filters ──────────────────────────────────────────────────────────
   Chips are mutually exclusive, so the filter refs are always derived from one
   value rather than drifting apart. The library filter is orthogonal to them. */
const quickFilter = computed<AuthorQuickFilter>(() => {
  if (hasPhoto.value === false) return 'noPortrait'
  if (minBookCount.value !== null && minBookCount.value >= 2) return 'multipleBooks'
  if (addedWithinDays.value !== null) return 'recentlyAdded'
  if (hasSortName.value === false) return 'noSortName'
  return 'all'
})

function applyQuickFilter(next: AuthorQuickFilter) {
  hasPhoto.value = next === 'noPortrait' ? false : null
  minBookCount.value = next === 'multipleBooks' ? 2 : null
  addedWithinDays.value = next === 'recentlyAdded' ? RECENTLY_ADDED_DAYS : null
  hasSortName.value = next === 'noSortName' ? false : null
}

const activeFilterCount = computed(() => {
  let count = 0
  if (q.value.trim()) count += 1
  if (libraryId.value !== null) count += 1
  if (quickFilter.value !== 'all') count += 1
  return count
})

const libraryOptions = computed(() => libraries.value.map((library) => ({ id: library.id, name: library.name })))

/**
 * A book cover under a person's name reads as a photograph of that person, so this
 * is off unless asked for. Even when it is on it stays off while filtering for
 * authors with no portrait, where filling every tile hides the very gap being
 * looked for.
 */
const coverFallback = computed(() => authorCoverFallback.value && quickFilter.value !== 'noPortrait')

/* ── sectioning ─────────────────────────────────────────────────────────────
   Only the two alphabetical sorts have letter sections, and each one is its own
   <section> so the sticky heading is bounded by it. Sharing a containing block
   stacks every heading at the top of the scroller instead of replacing it. */
const sectioned = computed(() => isLetterSort(sort.value))

const sections = computed(() => {
  if (!sectioned.value) return [{ letter: '', authors: items.value }]

  const groups: { letter: string; authors: AuthorSummary[] }[] = []
  for (const author of items.value) {
    const letter = authorLetterKey(author, sort.value)
    const current = groups[groups.length - 1]
    if (current && current.letter === letter) current.authors.push(author)
    else groups.push({ letter, authors: [author] })
  }
  return groups
})

const maxBookCount = computed(() => items.value.reduce((max, author) => Math.max(max, author.bookCount), 1))

/**
 * The stored tile size and gap govern wherever they fit, but both are capped against
 * the page's own width so a phone never drops to two enormous tiles with a 28px
 * trench between them. The cqw units resolve against the page container, which
 * already excludes the rail gutter; above roughly 700px of content neither cap binds
 * and the sliders are honoured exactly.
 */
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(min(${authorCoverSize.value}px, 30cqw), 1fr))`,
  gap: `min(${gridGap.value}px, 4cqw)`,
}))

const showSkeleton = computed(() => !initialLoadComplete.value && loading.value)
const showEmpty = computed(() => initialLoadComplete.value && !loading.value && items.value.length === 0)

/* ── jump rail ────────────────────────────────────────────────────────────── */
const rail = useAuthorJumpRail({
  enabled: showJumpRails,
  sort,
  order,
  total,
  filterParams: list.filterParams,
  loadThrough: list.loadThrough,
  scroller: mainRef,
})

const deleteDialogLoading = computed(() => {
  if (bulkDeleting.value) return true
  if (pendingDeleteIds.value.length !== 1) return false
  return deletingAuthorId.value === pendingDeleteIds.value[0]
})

const deleteDialogTitle = computed(() => {
  if (pendingDeleteIds.value.length > 1) return t('author.list.deleteDialog.titleMany', { count: pendingDeleteIds.value.length })
  return t('author.list.deleteDialog.titleOne')
})

const deleteDialogDescription = computed(() =>
  pendingDeleteIds.value.length > 1 ? t('author.list.deleteDialog.descriptionMany') : t('author.list.deleteDialog.descriptionOne'),
)

function showRefreshResultToast(updated: { imageUrl?: string | null }) {
  if (!updated.imageUrl) {
    toast.warning(t('author.list.toast.refreshedNoImage'))
    return
  }
  toast.success(t('author.list.toast.refreshed'))
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

function parseQuickFilter(value: unknown): AuthorQuickFilter {
  return value === 'noPortrait' || value === 'multipleBooks' || value === 'recentlyAdded' || value === 'noSortName' ? value : 'all'
}

function syncRouteQuery() {
  void router.replace({
    name: 'authors',
    query: {
      q: q.value.trim() || undefined,
      sort: sort.value !== 'name' ? sort.value : undefined,
      order: order.value !== 'asc' ? order.value : undefined,
      libraryId: libraryId.value ? String(libraryId.value) : undefined,
      filter: quickFilter.value !== 'all' ? quickFilter.value : undefined,
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

function handleSearchUpdate(value: string) {
  q.value = value
}

function handleQuickFilterUpdate(value: AuthorQuickFilter) {
  applyQuickFilter(value)
}

function handleLibraryUpdate(value: number | null) {
  libraryId.value = value
}

function handleAuthorSelect(authorId: number, event: MouseEvent) {
  if (!selectionMode.value) enterSelectionMode()

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
  applyQuickFilter('all')

  syncRouteQuery()
  await load(true)

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
          next[index] = { ...current, imageUrl: event.imageUrl ?? null }
          items.value = next
        }
      }
      clearRefreshing([event.authorId])
    })

    if (result.failed > 0) {
      toast.warning(t('author.list.toast.bulkRefreshPartial', { updated: result.updated, failed: result.failed }))
    } else {
      toast.success(t('author.list.toast.bulkRefreshSuccess', { updated: result.updated }))
    }
  } catch (actionError) {
    toast.error(actionError instanceof Error ? actionError.message : t('author.list.toast.bulkRefreshFailed'))
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
    toast.error(actionError instanceof Error ? actionError.message : t('author.list.toast.refreshFailed'))
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

function startBulkDeleteConfirm() {
  confirmingBulkDelete.value = true
}

function cancelBulkDeleteConfirm() {
  confirmingBulkDelete.value = false
}

async function confirmDeleteAuthors() {
  const ids = [...pendingDeleteIds.value]
  if (!canDeleteAuthors.value || ids.length === 0) return

  const singleAuthorId: number | null = ids.length === 1 ? (ids[0] ?? null) : null
  deleteDialogOpen.value = false

  if (singleAuthorId !== null) deletingAuthorId.value = singleAuthorId
  else bulkDeleting.value = true

  try {
    const result = await deleteAuthors({ authorIds: ids })
    await load(true)
    if (ids.length > 1) exitSelectionMode()

    toast.success(t('author.list.toast.deleteSuccess', { count: result.deletedAuthorIds.length, books: result.affectedBookCount }))
  } catch (actionError) {
    toast.error(actionError instanceof Error ? actionError.message : t('author.list.toast.deleteFailed'))
  } finally {
    if (singleAuthorId !== null) deletingAuthorId.value = null
    else bulkDeleting.value = false
    pendingDeleteIds.value = []
  }
}

function loadIfSentinelVisible() {
  if (loading.value || !hasMore.value || !sentinel.value) return
  if (sentinel.value.getBoundingClientRect().top < window.innerHeight + 250) void load()
}

function handleScroll() {
  rail.syncActiveKey()
}

onMounted(async () => {
  q.value = typeof route.query.q === 'string' ? route.query.q : ''
  sort.value = parseSort(route.query.sort)
  order.value = parseOrder(route.query.order)
  libraryId.value = parseLibraryId(route.query.libraryId)
  applyQuickFilter(parseQuickFilter(route.query.filter))

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
  rail.syncActiveKey()
})

onUnmounted(() => {
  observer?.disconnect()
  if (searchTimer) clearTimeout(searchTimer)
})

watch([sort, order, libraryId, hasPhoto, hasSortName, addedWithinDays, minBookCount], () => {
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
    if (!isLoading) {
      loadIfSentinelVisible()
      rail.syncActiveKey()
    }
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
    <section class="flex min-h-0 flex-1 flex-col">
      <ViewHeader
        :title="t('author.list.title')"
        icon="Users"
        fallback-icon="Users"
        :total="total"
        searchable
        :search-query="q"
        :search-placeholder="t('author.list.searchPlaceholder')"
        v-model:coverSize="authorCoverSize"
        v-model:gridGap="gridGap"
        v-model:viewMode="authorViewMode"
        v-model:coverShape="authorCoverShape"
        v-model:rowDensity="authorRowDensity"
        v-model:coverFallback="authorCoverFallback"
        show-cover-fallback-toggle
        v-model:showJumpRails="showJumpRails"
        show-jump-rail-toggle
        :jump-rail-modes="['grid', 'list']"
        :allowed-view-modes="['grid', 'list']"
        :cover-size-min="72"
        :cover-size-max="220"
        :cover-size-step="4"
        :selection-mode="selectionMode"
        @update:search-query="handleSearchUpdate"
        @toggle-selection="toggleSelectionMode"
      >
        <template #toolbar>
          <Popover>
            <PopoverTrigger as-child>
              <button
                class="hidden h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors md:flex"
                :class="
                  !isDefaultSort
                    ? 'border-primary/55 bg-primary/10 text-primary'
                    : 'border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
                "
              >
                <ArrowUpDown :size="13" />
                <span class="hidden lg:inline">{{ sortSummary }}</span>
                <span class="lg:hidden">{{ t('author.list.sortButton') }}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" class="w-56 p-2">
              <div class="mb-2 px-1 text-xs font-medium text-muted-foreground">{{ t('author.list.sortBy') }}</div>
              <div class="flex flex-col gap-0.5">
                <button
                  v-for="field in ['name', 'sortName', 'bookCount', 'lastAddedAt', 'lastEnrichedAt'] as const"
                  :key="field"
                  class="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                  :class="sort === field ? 'font-medium text-foreground' : 'text-muted-foreground'"
                  @click="setSortField(field)"
                >
                  {{ sortLabels[field] }}
                  <span v-if="sort === field" class="text-xs text-primary">{{ order === 'asc' ? '↑' : '↓' }}</span>
                </button>
              </div>
              <div class="my-2 border-t border-border" />
              <div class="flex gap-1">
                <button
                  v-for="dir in ['asc', 'desc'] as const"
                  :key="dir"
                  class="flex-1 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted"
                  :class="order === dir ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'"
                  @click="setSortOrder(dir)"
                >
                  {{ dir === 'asc' ? t('author.list.ascending') : t('author.list.descending') }}
                </button>
              </div>
            </PopoverContent>
          </Popover>

          <button
            v-if="!isDefaultSort"
            class="hidden size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-destructive md:flex"
            :aria-label="t('common.resetSortAria')"
            @click="resetSort"
          >
            <X :size="13" />
          </button>
        </template>
      </ViewHeader>

      <AuthorFilterChips
        class="mb-2"
        :quick-filter="quickFilter"
        :libraries="libraryOptions"
        :library-id="libraryId"
        @update:quick-filter="handleQuickFilterUpdate"
        @update:library-id="handleLibraryUpdate"
      />

      <!-- The selection bar floats over the bottom of the scroller, so the list is
           padded while it is up. Without this the last rows sit under the bar and
           cannot be selected - in the one mode whose whole purpose is selecting. -->
      <main
        ref="mainRef"
        class="@container/page min-h-0 flex-1 overflow-y-auto transition-[padding] duration-200"
        :class="[rail.gutterReserved.value ? 'pr-10' : 'pr-2', selectionMode ? 'pb-24' : '']"
        @scroll.passive="handleScroll"
      >
        <div v-if="error" class="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          {{ error }}
        </div>

        <!-- Skeleton only before the first page ever lands. A filter, a sort or a
             search keystroke refetches constantly, and swapping rows for a skeleton
             on each one is a flicker, not a loading state. -->
        <div v-if="showSkeleton" class="pt-1" aria-hidden="true">
          <div v-if="isGallery" class="grid" :style="gridStyle">
            <div v-for="index in INITIAL_SKELETON_COUNT" :key="`author-skeleton-${index}`" class="flex flex-col gap-1.5">
              <div
                class="aspect-square w-full animate-pulse bg-muted/60"
                :class="authorCoverShape === 'circle' ? 'rounded-full' : 'rounded-[10px]'"
              />
              <div class="h-3 w-3/4 animate-pulse rounded bg-muted/50" />
            </div>
          </div>
          <div v-else class="flex flex-col gap-1">
            <div v-for="index in INITIAL_SKELETON_COUNT" :key="`author-skeleton-row-${index}`" class="flex items-center gap-3 px-2 py-1">
              <div class="size-[30px] shrink-0 animate-pulse rounded-lg bg-muted/60" />
              <div class="h-3 w-40 max-w-[45%] animate-pulse rounded bg-muted/50" />
            </div>
          </div>
        </div>

        <div v-else-if="showEmpty" class="flex flex-col items-center justify-center gap-2 py-24 text-center">
          <p class="text-sm font-medium text-foreground">{{ t('author.list.empty.title') }}</p>
          <p class="max-w-[34ch] text-xs text-muted-foreground">{{ t('author.list.empty.hint') }}</p>
          <button
            v-if="activeFilterCount > 0"
            class="mt-1 h-8 rounded-lg border border-input px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="clearFilters"
          >
            {{ t('author.list.clear') }}
          </button>
        </div>

        <template v-else>
          <section v-for="section in sections" :key="section.letter || 'all'" class="mt-3 first:mt-0">
            <h2
              v-if="sectioned && section.letter"
              :data-letter="section.letter"
              class="sticky top-0 z-10 mb-1 flex h-7 items-center gap-2.5 bg-linear-to-b from-background from-65% to-transparent"
            >
              <span class="min-w-[0.9rem] font-serif text-[15px] font-semibold leading-none text-foreground">{{ section.letter }}</span>
              <span class="h-px flex-1 bg-border" />
              <span class="text-[10.5px] font-bold tabular-nums text-muted-foreground">{{ formatNumber(section.authors.length) }}</span>
            </h2>

            <div v-if="isGallery" class="grid" :style="gridStyle">
              <AuthorTile
                v-for="author in section.authors"
                :key="author.id"
                :author="author"
                :shape="authorCoverShape"
                :cover-fallback="coverFallback"
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

            <!-- Column-major: an index is read down a column, so multi-column rows use
                 CSS columns. A grid would run A, B, C, D across the first row. -->
            <div v-else class="[column-gap:0.875rem] @[40rem]/page:columns-2 @[68rem]/page:columns-3 @[94rem]/page:columns-4">
              <AuthorIndexRow
                v-for="author in section.authors"
                :key="author.id"
                class="[break-inside:avoid]"
                :author="author"
                :density="authorRowDensity"
                :cover-fallback="coverFallback"
                :max-book-count="maxBookCount"
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
          </section>
        </template>

        <div ref="sentinel" class="mt-4 flex h-8 items-center justify-center">
          <span v-if="loading && initialLoadComplete" class="text-xs text-muted-foreground">{{ t('common.loading') }}</span>
          <span v-else-if="initialLoadComplete && !hasMore && items.length > 0" class="text-xs text-muted-foreground">
            {{ t('author.list.allLoaded', { total: formatNumber(total) }) }}
          </span>
        </div>
      </main>
    </section>

    <JumpRail
      :visible="rail.visible.value"
      :buckets="rail.buckets.value"
      kind="letter"
      field="author"
      :template="rail.template.value"
      :active-key="rail.activeKey.value"
      :viewport="mainRef"
      @jump="rail.handleJump"
      @after-leave="rail.releaseGutter"
    />

    <SelectionActionBar :visible="selectionMode" :count="selectedCount" @exit="exitSelectionMode">
      <template #content>
        <template v-if="!confirmingBulkDelete">
          <span class="whitespace-nowrap rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-primary">
            {{ selectedCount }}
          </span>

          <div class="mx-1 h-5 w-px shrink-0 bg-border" />

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                :disabled="selectedCount === 0"
                :aria-label="t('author.list.selection.selectVisible')"
                class="flex size-9 items-center justify-center rounded-full transition-colors"
                :class="
                  selectedCount > 0 ? 'text-foreground hover:bg-primary hover:text-primary-foreground' : 'cursor-not-allowed text-muted-foreground'
                "
                @click="selectAllVisible"
              >
                <CheckCheck :size="17" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{{ t('author.list.selection.selectVisible') }}</TooltipContent>
          </Tooltip>

          <Tooltip v-if="canRefreshMetadata">
            <TooltipTrigger as-child>
              <button
                :disabled="selectedCount === 0 || bulkRefreshing"
                :aria-label="t('author.list.selection.refreshMetadata')"
                class="flex size-9 items-center justify-center rounded-full transition-colors"
                :class="selectedCount > 0 ? 'text-foreground hover:bg-muted' : 'cursor-not-allowed text-muted-foreground'"
                @click="refreshSelectedAuthorsMetadata"
              >
                <RefreshCcw :size="17" :class="bulkRefreshing ? 'animate-spin' : ''" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {{ bulkRefreshing ? t('author.list.selection.refreshingMetadata') : t('author.list.selection.refreshMetadata') }}
            </TooltipContent>
          </Tooltip>

          <Tooltip v-if="canDeleteAuthors">
            <TooltipTrigger as-child>
              <button
                :disabled="selectedCount === 0 || bulkDeleting"
                :aria-label="t('author.list.selection.deleteSelected')"
                class="flex size-9 items-center justify-center rounded-full transition-colors"
                :class="
                  selectedCount > 0
                    ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground'
                    : 'cursor-not-allowed text-muted-foreground'
                "
                @click="startBulkDeleteConfirm"
              >
                <Trash2 :size="17" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {{ bulkDeleting ? t('author.list.selection.deleting') : t('author.list.selection.deleteSelected') }}
            </TooltipContent>
          </Tooltip>

          <div class="mx-1 h-5 w-px shrink-0 bg-border" />

          <Tooltip>
            <TooltipTrigger as-child>
              <button
                :aria-label="t('author.list.selection.exitSelection')"
                class="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                @click="exitSelectionMode"
              >
                <X :size="17" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{{ t('author.list.selection.exitSelection') }}</TooltipContent>
          </Tooltip>
        </template>

        <template v-else>
          <span class="whitespace-nowrap px-3 text-sm font-semibold text-destructive">
            {{ t('author.list.selection.confirmDeleteCount', { count: selectedCount }) }}
          </span>

          <div class="mx-1 h-5 w-px shrink-0 bg-border" />

          <button
            class="h-8 rounded-full px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground"
            :disabled="bulkDeleting"
            @click="confirmDeleteSelectedFromPopover"
          >
            {{ bulkDeleting ? t('author.list.selection.deleting') : t('common.delete') }}
          </button>

          <button
            class="h-8 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :disabled="bulkDeleting"
            @click="cancelBulkDeleteConfirm"
          >
            {{ t('common.cancel') }}
          </button>
        </template>
      </template>
    </SelectionActionBar>

    <AuthorConfirmDialog
      :open="deleteDialogOpen"
      :title="deleteDialogTitle"
      :description="deleteDialogDescription"
      :confirm-label="t('common.delete')"
      :loading="deleteDialogLoading"
      destructive
      @confirm="confirmDeleteAuthors"
      @cancel="cancelDeleteAuthors"
    />
  </div>
</template>
