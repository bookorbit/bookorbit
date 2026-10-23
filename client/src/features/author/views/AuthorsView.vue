<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { useRoute, useRouter } from 'vue-router'
import { CheckCheck, RefreshCcw, Trash2, X } from '@lucide/vue'
import { toast } from 'vue-sonner'

import SelectionActionBar from '@/components/SelectionActionBar.vue'
import BrowseHeader from '@/components/browse-header/BrowseHeader.vue'
import BrowseSearchField from '@/components/browse-header/BrowseSearchField.vue'
import BrowseSortControl from '@/components/browse-header/BrowseSortControl.vue'
import BrowseInlineGroup from '@/components/browse-header/BrowseInlineGroup.vue'
import BrowseLibraryPicker from '@/components/browse-header/BrowseLibraryPicker.vue'
import BrowseViewControls from '@/components/browse-header/BrowseViewControls.vue'
import { barDivider, segmentItem, segmentTrack } from '@/components/browse-header/browse-header'
import ViewHeaderDisplayControls from '@/components/view-header/ViewHeaderDisplayControls.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useScrollRestoreOnActivate } from '@/features/book/composables/useScrollRestoreOnActivate'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryPermissions } from '@/features/library/composables/useLibraryPermissions'
import JumpRail from '@/features/book/components/JumpRail.vue'
import { bulkRefreshAuthorsMetadata, deleteAuthors, refreshAuthorMetadata } from '../api/author'
import AuthorConfirmDialog from '../components/AuthorConfirmDialog.vue'
import AuthorIndexRow from '../components/AuthorIndexRow.vue'
import AuthorTile from '../components/AuthorTile.vue'
import { useAuthorJumpRail } from '../composables/useAuthorJumpRail'
import { useAuthorSelection } from '../composables/useAuthorSelection'
import { useAuthorsList } from '../composables/useAuthorsList'
import { useRefreshingAuthors } from '../composables/useRefreshingAuthors'
import { authorLetterKey, isLetterSort } from '../lib/author-identity'
import { RECENTLY_ADDED_DAYS, type AuthorListSort, type AuthorQuickFilter, type AuthorSummary, type SortDirection } from '../types/author'
import IgnoreCacheCheckbox from '@/features/metadata-cache/components/IgnoreCacheCheckbox.vue'
import { showCacheFallbackToast } from '@/features/metadata-cache/lib/cache-feedback'
import { splitMetadataCacheUsage, usageFallbackProviders, type IgnoreCacheOptions } from '@/features/metadata-cache/lib/metadata-cache'
import { metadataProviderLabel } from '@/features/book/lib/metadata-refresh-feedback'
import type { BookViewMode } from '@/composables/useDisplaySettings'
import type { TableDensity } from '@bookorbit/types'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const mainRef = ref<HTMLElement | null>(null)
useScrollRestoreOnActivate(mainRef)
const { gridGap, viewMode, authorCoverSize, authorCoverShape, authorRowDensity, authorCoverFallback, showJumpRails } = useDisplaySettings()
const { libraries, fetchLibraries } = useLibraries()
const { hasPermissionInAnyLibrary } = useLibraryPermissions()
const { isDemoRestrictedAccount, isSuperuser } = usePermissions()
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
const confirmingBulkRefresh = ref(false)
const bulkRefreshIgnoreCache = ref(false)
const bulkRefreshConfirmButton = ref<HTMLButtonElement | null>(null)

const pendingDeleteIds = ref<number[]>([])
const deleteDialogOpen = ref(false)

const canRefreshMetadata = computed(() => hasPermissionInAnyLibrary('library_edit_metadata', 'editor') && !isDemoRestrictedAccount.value)
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
const AUTHOR_SORT_FIELDS: AuthorListSort[] = ['name', 'sortName', 'bookCount', 'lastAddedAt', 'lastEnrichedAt']
const AUTHOR_QUICK_FILTERS: AuthorQuickFilter[] = ['all', 'noPortrait', 'multipleBooks', 'recentlyAdded', 'noSortName']

const quickFilterLabels = computed<Record<AuthorQuickFilter, string>>(() => ({
  all: t('author.filters.chips.all'),
  noPortrait: t('author.filters.chips.noPortrait'),
  multipleBooks: t('author.filters.chips.multipleBooks'),
  recentlyAdded: t('author.filters.chips.recentlyAdded'),
  noSortName: t('author.filters.chips.noSortName'),
}))

const foldedCount = computed(() => formatNumber(total.value))

function toggleSortDirection() {
  order.value = order.value === 'asc' ? 'desc' : 'asc'
}

function handleCoverSizeUpdate(value: number) {
  authorCoverSize.value = value
}

function handleGridGapUpdate(value: number) {
  gridGap.value = value
}

function handleShowJumpRailsUpdate(value: boolean) {
  showJumpRails.value = value
}

function handleCoverShapeUpdate(value: 'square' | 'circle') {
  authorCoverShape.value = value
}

function handleRowDensityUpdate(value: TableDensity) {
  authorRowDensity.value = value
}

function handleCoverFallbackUpdate(value: boolean) {
  authorCoverFallback.value = value
}

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

async function startBulkRefreshConfirm() {
  if (selectedCount.value === 0 || bulkRefreshing.value || !canRefreshMetadata.value) return
  bulkRefreshIgnoreCache.value = false
  confirmingBulkRefresh.value = true
  // The button that opened this is replaced by the confirmation, so focus would otherwise fall back to the page.
  await nextTick()
  bulkRefreshConfirmButton.value?.focus()
}

function cancelBulkRefreshConfirm() {
  confirmingBulkRefresh.value = false
}

function confirmBulkRefresh() {
  const ignoreCache = bulkRefreshIgnoreCache.value
  confirmingBulkRefresh.value = false
  void refreshSelectedAuthorsMetadata({ ignoreCache })
}

async function refreshSelectedAuthorsMetadata(options: IgnoreCacheOptions = {}) {
  const ids = [...selectedIds.value]
  if (ids.length === 0 || bulkRefreshing.value || !canRefreshMetadata.value) return

  bulkRefreshing.value = true
  markRefreshing(ids)
  try {
    const result = await bulkRefreshAuthorsMetadata(
      ids,
      (event) => {
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
      },
      { ignoreCache: options.ignoreCache === true },
    )

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
    const { value: updated, usage } = splitMetadataCacheUsage(await refreshAuthorMetadata(authorId))
    const index = items.value.findIndex((item) => item.id === authorId)
    if (index !== -1) {
      const next = [...items.value]
      const current = next[index]
      if (!current) return
      next[index] = { ...current, ...updated }
      items.value = next
    }
    showRefreshResultToast(updated)
    showCacheFallbackToast(usageFallbackProviders(usage), metadataProviderLabel)
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
    if (!mode || count === 0) {
      confirmingBulkDelete.value = false
      confirmingBulkRefresh.value = false
    }
  },
  { flush: 'post' },
)

defineOptions({ name: 'AuthorsView' })
</script>

<template>
  <div class="flex h-full flex-col">
    <section class="flex min-h-0 flex-1 flex-col">
      <BrowseHeader
        :eyebrow="t('components.browseHeader.eyebrow.browse')"
        :title="t('author.list.title')"
        icon="Users"
        fallback-icon="Users"
        :folded-count="foldedCount"
        :scroll-container="mainRef"
      >
        <template #facts>
          <span class="truncate">{{ t('components.browseHeader.facts.authors', { count: total }) }}</span>
        </template>

        <template #bar>
          <BrowseSearchField
            :model-value="q"
            :placeholder="t('author.list.searchPlaceholder')"
            :active="activeFilterCount > 0"
            @update:model-value="handleSearchUpdate"
            @clear="clearFilters"
          />
          <span :class="barDivider" aria-hidden="true" />
          <BrowseSortControl
            :label="sortLabels[sort]"
            :direction="order"
            :changed="!isDefaultSort"
            popover-class="w-56 p-2"
            @toggle-direction="toggleSortDirection"
          >
            <div class="mb-2 px-1 text-xs font-medium text-muted-foreground">{{ t('author.list.sortBy') }}</div>
            <div class="flex flex-col gap-0.5">
              <button
                v-for="field in AUTHOR_SORT_FIELDS"
                :key="field"
                type="button"
                class="flex items-center justify-between rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-muted"
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
                class="w-full rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                @click="resetSort"
              >
                {{ t('common.resetSortAria') }}
              </button>
            </template>
          </BrowseSortControl>
          <span :class="barDivider" aria-hidden="true" />
          <BrowseInlineGroup
            :label="t('components.browseHeader.facets.show')"
            :value="quickFilter === 'all' ? null : quickFilterLabels[quickFilter]"
            :active="quickFilter !== 'all'"
            :show-label="false"
          >
            <div :class="segmentTrack" role="group" :aria-label="t('author.filters.chips.groupLabel')">
              <button
                v-for="chip in AUTHOR_QUICK_FILTERS"
                :key="chip"
                type="button"
                :class="segmentItem"
                :aria-pressed="quickFilter === chip"
                @click="handleQuickFilterUpdate(chip)"
              >
                {{ quickFilterLabels[chip] }}
              </button>
            </div>
          </BrowseInlineGroup>
          <BrowseLibraryPicker
            v-if="libraryOptions.length > 1"
            hide-on-phone
            :libraries="libraryOptions"
            :model-value="libraryId"
            @update:model-value="handleLibraryUpdate"
          />
          <span :class="barDivider" aria-hidden="true" />
          <BrowseViewControls
            v-model:view-mode="authorViewMode"
            :allowed-view-modes="['grid', 'list']"
            :selection-mode="selectionMode"
            @toggle-selection="toggleSelectionMode"
          >
            <template #display>
              <ViewHeaderDisplayControls
                :view-mode="authorViewMode"
                :cover-size="authorCoverSize"
                :grid-gap="gridGap"
                show-jump-rail-toggle
                :show-jump-rails="showJumpRails"
                :jump-rail-modes="['grid', 'list']"
                :cover-shape="authorCoverShape"
                :row-density="authorRowDensity"
                show-cover-fallback-toggle
                :cover-fallback="authorCoverFallback"
                :cover-size-min="72"
                :cover-size-max="220"
                :cover-size-step="4"
                @update:cover-size="handleCoverSizeUpdate"
                @update:grid-gap="handleGridGapUpdate"
                @update:show-jump-rails="handleShowJumpRailsUpdate"
                @update:cover-shape="handleCoverShapeUpdate"
                @update:row-density="handleRowDensityUpdate"
                @update:cover-fallback="handleCoverFallbackUpdate"
              />
            </template>
          </BrowseViewControls>
        </template>
      </BrowseHeader>

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
              <div class="h-3 w-3/4 animate-pulse rounded-xs bg-muted/50" />
            </div>
          </div>
          <div v-else class="flex flex-col gap-1">
            <div v-for="index in INITIAL_SKELETON_COUNT" :key="`author-skeleton-row-${index}`" class="flex items-center gap-3 px-2 py-1">
              <div class="size-[30px] shrink-0 animate-pulse rounded-lg bg-muted/60" />
              <div class="h-3 w-40 max-w-[45%] animate-pulse rounded-xs bg-muted/50" />
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
        <template v-if="confirmingBulkRefresh">
          <span class="whitespace-nowrap px-3 text-sm font-semibold text-foreground" data-testid="author-bulk-refresh-confirm">
            {{ t('author.list.selection.confirmRefreshCount', { count: selectedCount }) }}
          </span>

          <div class="mx-1 h-5 w-px shrink-0 bg-border" />

          <IgnoreCacheCheckbox v-model="bulkRefreshIgnoreCache" compact class="px-2" />

          <div class="mx-1 h-5 w-px shrink-0 bg-border" />

          <button
            ref="bulkRefreshConfirmButton"
            type="button"
            class="h-8 rounded-full px-3 text-sm font-medium text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
            data-testid="author-bulk-refresh-confirm-action"
            @click="confirmBulkRefresh"
          >
            {{ t('author.list.selection.refreshAction') }}
          </button>

          <button
            type="button"
            class="h-8 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="cancelBulkRefreshConfirm"
          >
            {{ t('common.cancel') }}
          </button>
        </template>

        <template v-else-if="!confirmingBulkDelete">
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
                data-testid="author-bulk-refresh"
                @click="startBulkRefreshConfirm"
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
