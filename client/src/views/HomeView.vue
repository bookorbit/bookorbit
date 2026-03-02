<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowUpDown, Bookmark, BookmarkCheck, Filter, Telescope, X } from 'lucide-vue-next'
import BookCoverCard from '@/features/book/components/BookCoverCard.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import BookFilterBuilder from '@/features/book/components/BookFilterBuilder.vue'
import BookSortBuilder from '@/features/book/components/BookSortBuilder.vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import AppHeader from '@/components/AppHeader.vue'
import ViewHeader from '@/components/ViewHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import SaveAsLensDialog from '@/features/lens/components/SaveAsLensDialog.vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { useBookQuery, type BookCard } from '@/features/book/composables/useBookQuery'
import { useBookEvents } from '@/features/book/composables/useBookEvents'
import { useBookSelection } from '@/features/book/composables/useBookSelection'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useScanProgress } from '@/features/scanner/composables/useScanProgress'
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import { SORT_FIELD_LABELS } from '@/features/book/lib/filter-labels'
import type { GroupRule, SortSpec } from '@projectx/types'

const route = useRoute()
const themeStore = useThemeStore()
const backgroundClass = computed(() => BACKGROUND_OPTIONS.find((b) => b.id === themeStore.background)?.cssClass ?? '')
const { coverSize, gridGap, viewMode } = useDisplaySettings()
const { libraries } = useLibraries()

const libraryId = shallowRef<number | null>(route.params.id ? Number(route.params.id) : null)

const title = computed(() => libraries.value.find((l) => l.id === libraryId.value)?.name ?? 'Library')

const { items: books, total, loading, error, filter, sort, hasMore, load, clear } = useBookQuery(libraryId)

const FILTER_STORAGE_PREFIX = 'projectx:filter:library:'
function getFilterKey(id: number) {
  return `${FILTER_STORAGE_PREFIX}${id}`
}

const SORT_STORAGE_PREFIX = 'projectx:sort:library:'
function getSortKey(id: number) {
  return `${SORT_STORAGE_PREFIX}${id}`
}

const savedFilter = ref<GroupRule | undefined>(undefined)
const hasSavedFilter = computed(() => savedFilter.value !== undefined)
const isFilterSaved = computed(() => JSON.stringify(filter.value) === JSON.stringify(savedFilter.value))

watch(
  libraryId,
  (id) => {
    if (id !== null) {
      try {
        const raw = localStorage.getItem(getFilterKey(id))
        const saved: GroupRule | undefined = raw ? JSON.parse(raw) : undefined
        savedFilter.value = saved
        filter.value = saved
      } catch {
        savedFilter.value = undefined
      }
      try {
        const rawSort = localStorage.getItem(getSortKey(id))
        sort.value = rawSort ? JSON.parse(rawSort) : [{ field: 'title', dir: 'asc' }]
      } catch {
        sort.value = [{ field: 'title', dir: 'asc' }]
      }
    } else {
      savedFilter.value = undefined
    }
  },
  { immediate: true },
)

function saveFilter() {
  if (libraryId.value === null || !filter.value) return
  const snapshot: GroupRule = JSON.parse(JSON.stringify(filter.value))
  savedFilter.value = snapshot
  localStorage.setItem(getFilterKey(libraryId.value), JSON.stringify(snapshot))
}

function forgetSavedFilter() {
  if (libraryId.value === null) return
  savedFilter.value = undefined
  localStorage.removeItem(getFilterKey(libraryId.value))
}

const { subscribeLibrary } = useScanProgress()
watch(
  libraryId,
  (id) => {
    if (id !== null) subscribeLibrary(id)
  },
  { immediate: true },
)

const { onBookMissing, onBookRestored, onBookMoved } = useBookEvents()
onBookMissing((bookIds) => {
  const missing = new Set(bookIds)
  for (const book of books.value) {
    if (missing.has(book.id)) book.status = 'missing'
  }
})
onBookRestored((bookIds) => {
  const restored = new Set(bookIds)
  for (const book of books.value) {
    if (restored.has(book.id)) book.status = 'present'
  }
})
onBookMoved((bookIds) => {
  const moved = new Set(bookIds)
  for (const book of books.value) {
    if (moved.has(book.id)) book.status = 'present'
  }
})

const filterOpen = ref(false)

function saveSort() {
  if (libraryId.value === null) return
  localStorage.setItem(getSortKey(libraryId.value), JSON.stringify(sort.value))
}

const isDefaultSort = computed(() => sort.value.length === 1 && sort.value[0]?.field === 'title' && sort.value[0]?.dir === 'asc')

const sortSummary = computed(() => sort.value.map((s) => `${SORT_FIELD_LABELS[s.field]} ${s.dir === 'asc' ? '↑' : '↓'}`).join(', '))

const sortModel = computed({
  get: () => sort.value,
  set: (v: SortSpec[]) => {
    sort.value = v.length > 0 ? v : [{ field: 'title', dir: 'asc' }]
    saveSort()
    load(true)
  },
})

function resetSort() {
  sort.value = [{ field: 'title', dir: 'asc' }]
  if (libraryId.value !== null) localStorage.removeItem(getSortKey(libraryId.value))
  load(true)
}

const activeFilterCount = computed(() => filter.value?.rules?.length ?? 0)

function clearFilters() {
  filter.value = undefined
}

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function loadIfSentinelVisible() {
  if (!hasMore.value || loading.value) return
  const el = sentinel.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.top < window.innerHeight + 300) load()
}

onMounted(() => {
  load(true)

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !loading.value) load()
    },
    { rootMargin: '300px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})

onUnmounted(() => observer?.disconnect())

watch(libraryId, (newId) => {
  if (newId === null) clear()
})

watch(filter, () => load(true), { deep: true })

watch(
  loading,
  (isLoading) => {
    if (!isLoading) loadIfSentinelVisible()
  },
  { flush: 'post' },
)

const { selectionMode, selectedIds, selectedCount, enterSelectionMode, exitSelectionMode, toggleBook, rangeSelectTo, isSelected } = useBookSelection()
const { bumpVersion } = useCoverVersions()

function handleSelect(id: number, event: MouseEvent) {
  if (event.shiftKey)
    rangeSelectTo(
      id,
      books.value.map((b) => b.id),
    )
  else toggleBook(id)
}

function toggleSelectionMode() {
  if (selectionMode.value) exitSelectionMode()
  else enterSelectionMode()
}

const addToCollectionOpen = ref(false)
const sendBookOpen = ref(false)
const saveAsLensOpen = ref(false)

async function handleDeleteSelected() {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  const res = await api('/api/v1/books', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookIds: ids }),
  })
  if (!res.ok) {
    toast.error('Failed to delete books')
    return
  }
  const deleted = new Set(ids)
  books.value = books.value.filter((b) => !deleted.has(b.id))
  exitSelectionMode()
  toast.success(`Deleted ${ids.length} book${ids.length === 1 ? '' : 's'}`)
}

async function handleBulkRefreshMetadata() {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  const toastId = toast.loading(`Refreshing metadata for ${ids.length} book${ids.length === 1 ? '' : 's'}...`)
  const res = await api('/api/v1/books/bulk-refresh-metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookIds: ids }),
  })
  toast.dismiss(toastId)
  if (!res.ok) {
    toast.error('Failed to refresh metadata')
    return
  }
  const { processed, failed } = await res.json()
  ids.forEach((id) => bumpVersion(id))
  if (failed > 0) {
    toast.warning(`Refreshed ${processed} book${processed === 1 ? '' : 's'}, ${failed} failed`)
  } else {
    toast.success(`Refreshed metadata for ${processed} book${processed === 1 ? '' : 's'}`)
  }
}

async function handleBulkReExtractCover() {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  const toastId = toast.loading(`Re-extracting covers for ${ids.length} book${ids.length === 1 ? '' : 's'}...`)
  const res = await api('/api/v1/books/bulk-re-extract-cover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookIds: ids }),
  })
  toast.dismiss(toastId)
  if (!res.ok) {
    toast.error('Failed to re-extract covers')
    return
  }
  const { processed, updated } = await res.json()
  ids.forEach((id) => bumpVersion(id))
  toast.success(`Re-extracted ${updated} of ${processed} cover${processed === 1 ? '' : 's'}`)
}

async function handleExport(allFormats: boolean) {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  const toastId = toast.loading(`Preparing ${ids.length} book${ids.length === 1 ? '' : 's'} for download...`)
  const res = await api('/api/v1/books/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookIds: ids, allFormats }),
  })
  toast.dismiss(toastId)
  if (!res.ok) {
    toast.error('Export failed')
    return
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'books.zip'
  a.click()
  URL.revokeObjectURL(url)
}

type BookActionType = 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'delete'

const quickViewBookId = ref<number | null>(null)
const quickViewOpen = ref(false)

function handleBookAction(book: BookCard, action: BookActionType) {
  if (action === 'quick-view') {
    quickViewBookId.value = book.id
    quickViewOpen.value = true
    return
  }
  if (action === 'add-to-collection') {
    if (!selectionMode.value) {
      enterSelectionMode()
      toggleBook(book.id)
    }
    addToCollectionOpen.value = true
    return
  }
  // TODO: implement remaining actions
}
</script>

<template>
  <SidebarProvider>
    <AppSidebar />

    <SidebarInset class="flex flex-col h-screen glow-wrapper">
      <AppHeader />
      <ViewHeader
        :title="title"
        :total="total"
        :loaded="books.length"
        v-model:coverSize="coverSize"
        v-model:gridGap="gridGap"
        v-model:viewMode="viewMode"
        :selection-mode="selectionMode"
        @toggle-selection="toggleSelectionMode"
      >
        <template #toolbar>
          <div class="flex items-center gap-1">
            <Popover>
              <PopoverTrigger as-child>
                <button
                  class="flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm transition-colors"
                  :class="
                    !isDefaultSort
                      ? 'border-primary text-primary bg-primary/10'
                      : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
                  "
                >
                  <ArrowUpDown :size="13" />
                  <span class="hidden lg:inline">{{ sortSummary }}</span>
                  <span class="lg:hidden"
                    >Sort<template v-if="!isDefaultSort"> ({{ sort.length }})</template></span
                  >
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" class="w-80 p-3">
                <BookSortBuilder v-model="sortModel" />
              </PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  v-if="!isDefaultSort"
                  @click="resetSort"
                  class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <X :size="13" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Reset sort to default</TooltipContent>
            </Tooltip>
          </div>
          <div class="w-px h-5 bg-border shrink-0" />
          <button
            @click="filterOpen = !filterOpen"
            class="flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm transition-colors"
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
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                v-if="activeFilterCount > 0"
                @click="clearFilters"
                class="flex items-center gap-1 h-8 px-2 rounded-md text-sm text-muted-foreground hover:text-destructive transition-colors"
              >
                <X :size="13" />
                Clear
              </button>
            </TooltipTrigger>
            <TooltipContent>Clear all filters</TooltipContent>
          </Tooltip>
        </template>
      </ViewHeader>

      <main class="flex-1 overflow-y-auto px-4 py-4" :class="backgroundClass">
        <div v-if="error" class="text-sm text-destructive mb-4">{{ error }}</div>

        <!-- Filter builder panel -->
        <div v-if="filterOpen" class="mb-4 p-3 rounded-md border border-border bg-card">
          <div class="flex items-center justify-between mb-3">
            <span class="text-xs font-medium text-muted-foreground">Filter rules</span>
            <div class="flex items-center gap-1.5">
              <Tooltip>
                <TooltipTrigger as-child>
                  <button
                    v-if="activeFilterCount > 0"
                    @click="saveAsLensOpen = true"
                    class="flex items-center gap-1.5 h-7 px-3 rounded-md border border-input text-xs font-medium text-muted-foreground bg-background hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <Telescope :size="13" />
                    Save as Lens
                  </button>
                </TooltipTrigger>
                <TooltipContent>Save this filter as a named lens</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <button
                    v-if="activeFilterCount > 0"
                    @click="saveFilter"
                    class="flex items-center gap-1.5 h-7 px-3 rounded-md border text-xs font-medium transition-colors"
                    :class="
                      isFilterSaved
                        ? 'border-primary/40 text-primary bg-primary/8'
                        : 'border-input text-muted-foreground bg-background hover:text-foreground hover:bg-muted'
                    "
                  >
                    <BookmarkCheck v-if="isFilterSaved" :size="13" />
                    <Bookmark v-else :size="13" />
                    {{ isFilterSaved ? 'Saved' : 'Save filter' }}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{ isFilterSaved ? 'Filter saved' : 'Save filter for this library' }}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger as-child>
                  <button
                    v-if="hasSavedFilter"
                    @click="forgetSavedFilter"
                    class="h-6 w-6 flex items-center justify-center rounded text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <X :size="11" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Remove saved filter</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <BookFilterBuilder v-model="filter" />
        </div>

        <!-- Grid view -->
        <div
          v-show="viewMode === 'grid'"
          class="grid"
          :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`, gap: `${gridGap}px` }"
        >
          <BookCoverCard
            v-for="book in books"
            :key="book.id"
            :book="book"
            :selection-mode="selectionMode"
            :selected="isSelected(book.id)"
            @action="handleBookAction(book, $event)"
            @select="handleSelect(book.id, $event)"
          />
        </div>

        <!-- List view -->
        <div v-show="viewMode === 'list'" class="flex flex-col divide-y divide-border">
          <BookListRow
            v-for="book in books"
            :key="book.id"
            :book="book"
            :selection-mode="selectionMode"
            :selected="isSelected(book.id)"
            @action="handleBookAction(book, $event)"
            @select="handleSelect(book.id, $event)"
          />
        </div>

        <div ref="sentinel" class="h-8 mt-4 flex items-center justify-center">
          <span v-if="loading" class="text-xs text-muted-foreground">Loading...</span>
          <span v-else-if="!hasMore && books.length > 0" class="text-xs text-muted-foreground">All {{ total.toLocaleString() }} books loaded</span>
        </div>
      </main>
    </SidebarInset>
  </SidebarProvider>

  <BookQuickView
    :book-id="quickViewBookId"
    :open="quickViewOpen"
    @update:open="quickViewOpen = $event"
    @action="quickViewBookId !== null && handleBookAction({ id: quickViewBookId } as BookCard, $event)"
  />

  <SelectionActionBar
    :visible="selectionMode"
    :count="selectedCount"
    @send="sendBookOpen = true"
    @export="handleExport"
    @add-to-collection="addToCollectionOpen = true"
    @refresh-metadata="handleBulkRefreshMetadata"
    @re-extract-cover="handleBulkReExtractCover"
    @delete="handleDeleteSelected"
    @exit="exitSelectionMode"
  />

  <AddToCollectionSheet
    :open="addToCollectionOpen"
    :book-ids="[...selectedIds]"
    @update:open="addToCollectionOpen = $event"
    @done="exitSelectionMode"
  />

  <SendBookDialog :open="sendBookOpen" :book-ids="[...selectedIds]" @update:open="sendBookOpen = $event" @sent="exitSelectionMode" />

  <SaveAsLensDialog :open="saveAsLensOpen" :filter="filter" :sort="sort" @close="saveAsLensOpen = false" />
</template>
