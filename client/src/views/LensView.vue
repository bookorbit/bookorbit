<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Settings2, Trash2, ChevronDown, ChevronUp, ArrowUpDown } from 'lucide-vue-next'
import BookCoverCard from '@/features/book/components/BookCoverCard.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import AppHeader from '@/components/AppHeader.vue'
import ViewHeader from '@/components/ViewHeader.vue'
import LensEditorPanel from '@/features/lens/components/LensEditorPanel.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import { SidebarInset } from '@/components/ui/sidebar'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { useLens } from '@/features/lens/composables/useLens'
import { useLenses } from '@/features/lens/composables/useLenses'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useBookSelection } from '@/features/book/composables/useBookSelection'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { useRefreshingBooks } from '@/features/book/composables/useRefreshingBooks'
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import FilterSummary from '@/features/book/components/FilterSummary.vue'
import { SORT_FIELD_LABELS } from '@/features/book/lib/filter-labels'
import type { BookCard, GroupRule, SortField } from '@projectx/types'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const backgroundClass = computed(() => BACKGROUND_OPTIONS.find((b) => b.id === themeStore.background)?.cssClass ?? '')
const { coverSize, gridGap, viewMode, lensFilterExpanded } = useDisplaySettings()

const lensId = computed(() => Number(route.params.id))

const { items: books, total, loading, hasMore, load } = useLens(lensId)
const { lenses, fetchLenses, deleteLens } = useLenses()

const lens = computed(() => lenses.value.find((l) => l.id === lensId.value))

const sortChip = computed(() => {
  const specs = lens.value?.defaultSort
  if (!specs?.length) return null
  return specs.map((s) => `${SORT_FIELD_LABELS[s.field as SortField] ?? s.field} ${s.dir === 'asc' ? '↑' : '↓'}`).join(', ')
})

const filterExpanded = lensFilterExpanded

const { selectionMode, selectedIds, selectedCount, enterSelectionMode, exitSelectionMode, toggleBook, rangeSelectTo, isSelected } = useBookSelection()

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
const { bumpVersion } = useCoverVersions()
const { markRefreshing, clearRefreshing } = useRefreshingBooks()

async function handleBulkRefreshMetadata() {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  markRefreshing(ids)
  const res = await api('/api/v1/books/bulk-refresh-metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookIds: ids }),
  })
  if (!res.ok) {
    clearRefreshing(ids)
    toast.error('Failed to refresh metadata')
    return
  }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let processed = 0
  let failed = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value, { stream: true }).split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const data = JSON.parse(line.slice(6))
          if (data.bookId !== undefined) { bumpVersion(data.bookId); clearRefreshing([data.bookId]) }
          if (data.done) { processed = data.processed; failed = data.failed }
        } catch { /* ignore malformed line */ }
      }
    }
  } finally {
    clearRefreshing(ids)
  }
  if (failed > 0) {
    toast.warning(`Refreshed ${processed} book${processed === 1 ? '' : 's'}, ${failed} failed`)
  } else {
    toast.success(`Refreshed metadata for ${processed} book${processed === 1 ? '' : 's'}`)
  }
}

async function handleBulkReExtractCover() {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  markRefreshing(ids)
  const res = await api('/api/v1/books/bulk-re-extract-cover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookIds: ids }),
  })
  if (!res.ok) {
    clearRefreshing(ids)
    toast.error('Failed to re-extract covers')
    return
  }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let processed = 0
  let updated = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      for (const line of decoder.decode(value, { stream: true }).split('\n')) {
        if (!line.startsWith('data: ')) continue
        try {
          const data = JSON.parse(line.slice(6))
          if (data.bookId !== undefined) { bumpVersion(data.bookId); clearRefreshing([data.bookId]) }
          if (data.done) { processed = data.processed; updated = data.updated }
        } catch { /* ignore malformed line */ }
      }
    }
  } finally {
    clearRefreshing(ids)
  }
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
  load(true)
  exitSelectionMode()
  toast.success(`Deleted ${ids.length} book${ids.length === 1 ? '' : 's'}`)
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
}

const editorOpen = ref(false)
const confirmDelete = ref(false)
const deleting = ref(false)

async function handleDelete() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    return
  }
  deleting.value = true
  try {
    await deleteLens(lensId.value)
    router.push({ name: 'home' })
  } finally {
    deleting.value = false
    confirmDelete.value = false
  }
}

function openEditor() {
  editorOpen.value = true
  confirmDelete.value = false
}

function onSaved() {
  load(true)
}

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function checkSentinel() {
  if (!hasMore.value || loading.value) return
  const el = sentinel.value
  if (!el) return
  if (el.getBoundingClientRect().top < window.innerHeight + 300) load()
}

onMounted(async () => {
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !loading.value) load()
    },
    { rootMargin: '300px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)

  await fetchLenses()
  if (!lens.value) {
    router.push({ name: 'home' })
    return
  }
  load(true)
})

onUnmounted(() => observer?.disconnect())

watch(
  loading,
  (isLoading) => {
    if (!isLoading) checkSentinel()
  },
  { flush: 'post' },
)
</script>

<template>
  <LensEditorPanel :open="editorOpen" :lens="lens" @close="editorOpen = false" @saved="onSaved" />

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
    @added="exitSelectionMode"
  />
  <SendBookDialog :open="sendBookOpen" :book-ids="[...selectedIds]" @update:open="sendBookOpen = $event" @sent="exitSelectionMode" />

  <SidebarInset class="flex flex-col h-screen glow-wrapper">
    <AppHeader />
    <ViewHeader
      :title="lens?.name ?? 'Lens'"
      :icon="lens?.icon ?? undefined"
      :total="total"
      :loaded="books.length"
      v-model:coverSize="coverSize"
      v-model:gridGap="gridGap"
      v-model:viewMode="viewMode"
      :selection-mode="selectionMode"
      @toggle-selection="toggleSelectionMode"
    >
      <template #actions>
        <button
          v-if="lens?.filter || sortChip"
          @click="filterExpanded = !filterExpanded"
          class="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          :title="filterExpanded ? 'Hide filter' : 'Show filter'"
        >
          <component :is="filterExpanded ? ChevronUp : ChevronDown" :size="13" />
          <span>Filter</span>
        </button>
        <button
          @click="openEditor"
          class="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-md border border-input text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Settings2 :size="13" />
          <span>Edit</span>
        </button>
        <button
          @click="handleDelete"
          :disabled="deleting"
          class="hidden md:flex items-center gap-1.5 h-8 px-3 rounded-md border text-sm transition-colors"
          :class="
            confirmDelete
              ? 'border-destructive text-destructive bg-destructive/10 hover:bg-destructive/20'
              : 'border-input text-muted-foreground hover:text-destructive hover:border-destructive'
          "
        >
          <Trash2 :size="13" />
          <span>{{ confirmDelete ? 'Confirm?' : 'Delete' }}</span>
        </button>
      </template>
    </ViewHeader>

    <main class="flex-1 overflow-y-auto px-4 py-4" :class="backgroundClass">
      <!-- Filter summary -->
      <div
        v-if="filterExpanded && (lens?.filter || sortChip)"
        class="flex flex-wrap items-center gap-2 mb-4 cursor-pointer"
        @click="editorOpen = true"
      >
        <FilterSummary v-if="lens?.filter" :node="lens.filter as GroupRule" />
        <span v-if="sortChip" class="inline-flex items-center text-xs rounded-md border border-border/60 overflow-hidden">
          <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground border-r border-border/60">
            <ArrowUpDown :size="10" class="shrink-0" />
            <span class="font-semibold">Sort</span>
          </span>
          <span class="px-2 py-0.5 bg-muted/40 text-foreground font-medium">{{ sortChip }}</span>
        </span>
      </div>

      <!-- Empty state: no rules configured -->
      <div v-if="!loading && !lens?.filter && books.length === 0" class="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
          <Settings2 :size="28" class="text-muted-foreground/50" />
        </div>
        <div class="flex flex-col gap-1">
          <p class="text-sm font-medium text-foreground">No rules configured</p>
          <p class="text-xs text-muted-foreground max-w-xs">
            Open the editor to define which books appear in this lens using filters and sort rules.
          </p>
        </div>
        <button
          @click="editorOpen = true"
          class="h-9 px-5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Configure Lens
        </button>
      </div>

      <!-- Empty state: rules set but no matches -->
      <div v-else-if="!loading && books.length === 0 && lens?.filter" class="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <p class="text-sm font-medium text-foreground">No books match this lens</p>
        <p class="text-xs text-muted-foreground">Try adjusting the filter rules.</p>
        <button @click="editorOpen = true" class="text-xs text-primary hover:underline">Edit Lens</button>
      </div>

      <!-- Grid view -->
      <div
        v-show="viewMode === 'grid' && books.length > 0"
        class="grid"
        :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`, gap: `${gridGap}px` }"
      >
        <BookCoverCard
          v-for="book in books"
          :key="book.id"
          :book="book"
          :selection-mode="selectionMode"
          :selected="isSelected(book.id)"
          @select="handleSelect(book.id, $event)"
        />
      </div>

      <!-- List view -->
      <div v-show="viewMode === 'list' && books.length > 0" class="flex flex-col divide-y divide-border">
        <BookListRow
          v-for="book in books"
          :key="book.id"
          :book="book"
          :selection-mode="selectionMode"
          :selected="isSelected(book.id)"
          @select="handleSelect(book.id, $event)"
          @action="handleBookAction(book, $event)"
        />
      </div>

      <div ref="sentinel" class="h-8 mt-4 flex items-center justify-center">
        <span v-if="loading" class="text-xs text-muted-foreground">Loading...</span>
        <span v-else-if="!hasMore && books.length > 0" class="text-xs text-muted-foreground"> All {{ total.toLocaleString() }} books loaded </span>
      </div>
    </main>
  </SidebarInset>
</template>
