<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FolderOpen, Pencil } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import BookCoverCard from '@/features/book/components/BookCoverCard.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import AppHeader from '@/components/AppHeader.vue'
import ViewHeader from '@/components/ViewHeader.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import EditCollectionDialog from '@/features/collection/components/EditCollectionDialog.vue'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import { SidebarInset } from '@/components/ui/sidebar'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { useCollections } from '@/features/collection/composables/useCollections'
import { useCollectionBooks } from '@/features/collection/composables/useCollectionBooks'
import { useBookSelection } from '@/features/book/composables/useBookSelection'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { useRefreshingBooks } from '@/features/book/composables/useRefreshingBooks'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import type { BookCard } from '@projectx/types'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const backgroundClass = computed(() => BACKGROUND_OPTIONS.find((b) => b.id === themeStore.background)?.cssClass ?? '')
const { coverSize, gridGap, viewMode } = useDisplaySettings()

const collectionId = computed(() => Number(route.params.id))
const { collections, fetchCollections, removeBooksFromCollection } = useCollections()
const collection = computed(() => collections.value.find((c) => c.id === collectionId.value))

const { items: books, total, loading, hasMore, load } = useCollectionBooks(collectionId)

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
const editCollectionOpen = ref(false)
let removingInProgress = false
let deletingInProgress = false
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
const quickViewBookId = ref<number | null>(null)
const quickViewOpen = ref(false)

async function handleRemoveFromCollection() {
  if (removingInProgress || !collectionId.value || selectedIds.value.size === 0) return
  removingInProgress = true
  try {
    const ids = [...selectedIds.value]
    await removeBooksFromCollection(collectionId.value, ids)
    load(true)
    exitSelectionMode()
    toast.success(`Removed ${ids.length} book${ids.length === 1 ? '' : 's'} from collection`)
  } catch {
    toast.error('Failed to remove books from collection')
  } finally {
    removingInProgress = false
  }
}

async function handleDeleteSelected() {
  if (deletingInProgress || selectedIds.value.size === 0) return
  deletingInProgress = true
  try {
    const ids = [...selectedIds.value]
    const res = await api('/api/v1/books', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookIds: ids }),
    })
    if (!res.ok) throw new Error('Failed to delete books')
    load(true)
    exitSelectionMode()
    toast.success(`Deleted ${ids.length} book${ids.length === 1 ? '' : 's'}`)
  } catch {
    toast.error('Failed to delete books')
  } finally {
    deletingInProgress = false
  }
}

function handleBookAction(book: BookCard, action: 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'delete') {
  if (action === 'quick-view') {
    quickViewBookId.value = book.id
    quickViewOpen.value = true
  }
}

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(async () => {
  await fetchCollections()
  if (!collection.value) {
    router.push({ name: 'home' })
    return
  }
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

watch(collectionId, () => load(true))
watch(
  loading,
  (isLoading) => {
    if (!isLoading && sentinel.value) {
      const rect = sentinel.value.getBoundingClientRect()
      if (rect.top < window.innerHeight + 300) load()
    }
  },
  { flush: 'post' },
)
</script>

<template>
  <BookQuickView
    :book-id="quickViewBookId"
    :open="quickViewOpen"
    @update:open="quickViewOpen = $event"
    @action="quickViewBookId !== null && handleBookAction({ id: quickViewBookId } as BookCard, $event)"
  />

  <SelectionActionBar
    :visible="selectionMode"
    :count="selectedCount"
    :in-collection="true"
    @send="sendBookOpen = true"
    @export="handleExport"
    @add-to-collection="addToCollectionOpen = true"
    @remove-from-collection="handleRemoveFromCollection"
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

  <EditCollectionDialog v-if="collection" :open="editCollectionOpen" :collection="collection" @close="editCollectionOpen = false" />
  <SendBookDialog :open="sendBookOpen" :book-ids="[...selectedIds]" @update:open="sendBookOpen = $event" @sent="exitSelectionMode" />

  <SidebarInset class="flex flex-col h-screen glow-wrapper">
    <AppHeader />
    <ViewHeader
      :title="collection?.name ?? 'Collection'"
      :icon="collection?.icon || 'FolderOpen'"
      :total="total"
      :loaded="books.length"
      v-model:coverSize="coverSize"
      v-model:gridGap="gridGap"
      v-model:viewMode="viewMode"
      :selection-mode="selectionMode"
      @toggle-selection="toggleSelectionMode"
    >
      <template #toolbar>
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              v-if="collection"
              class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              @click="editCollectionOpen = true"
            >
              <Pencil :size="14" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Edit collection</TooltipContent>
        </Tooltip>
      </template>
    </ViewHeader>

    <main class="flex-1 overflow-y-auto px-4 py-4" :class="backgroundClass">
      <div v-if="!loading && books.length === 0" class="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
          <FolderOpen :size="28" class="text-muted-foreground/50" />
        </div>
        <p class="text-sm font-medium text-foreground">No books in this collection</p>
        <p class="text-xs text-muted-foreground">Select books from your library and add them here.</p>
      </div>

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
          @action="handleBookAction(book, $event)"
          @select="handleSelect(book.id, $event)"
        />
      </div>

      <div v-show="viewMode === 'list' && books.length > 0" class="flex flex-col divide-y divide-border">
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
</template>
