<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FolderOpen, Pencil } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import ViewHeader from '@/components/ViewHeader.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import EditCollectionDialog from '@/features/collection/components/EditCollectionDialog.vue'
import SendBookDialog from '@/features/email/components/SendBookDialog.vue'
import DeleteBookDialog from '@/features/book/components/DeleteBookDialog.vue'
import { toast } from 'vue-sonner'
import { useCollections } from '@/features/collection/composables/useCollections'
import { useCollectionBooks } from '@/features/collection/composables/useCollectionBooks'
import { useBookNavigation } from '@/features/book/composables/useBookNavigation'
import { useBookSelection } from '@/features/book/composables/useBookSelection'
import { useDeleteBook } from '@/features/book/composables/useDeleteBook'
import { useBookBulkActions } from '@/features/book/composables/useBookBulkActions'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { usePageTitle } from '@/composables/usePageTitle'
import type { BookCard } from '@projectx/types'

const route = useRoute()
const router = useRouter()
const { coverSize, gridGap, viewMode } = useDisplaySettings()

const collectionId = computed(() => Number(route.params.id))
const { collections, fetchCollections, removeBooksFromCollection } = useCollections()
const collection = computed(() => collections.value.find((c) => c.id === collectionId.value))
const pageTitle = computed(() => {
  if (collection.value?.name) return `Collection · ${collection.value.name}`
  return Number.isFinite(collectionId.value) ? `Collection #${collectionId.value}` : 'Collection'
})
usePageTitle(pageTitle)

const { items: books, total, loading, hasMore, load } = useCollectionBooks(collectionId)
const { setBookContext, registerLoadMore } = useBookNavigation()
watch(
  [books, total],
  ([newBooks, newTotal]) => {
    setBookContext(
      newBooks.map((b) => b.id),
      newTotal,
    )
  },
  { immediate: true },
)

onMounted(() => {
  registerLoadMore(async () => {
    await load()
  })
})
onUnmounted(() => {
  registerLoadMore(null)
})

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
const {
  pendingId: deleteBookId,
  deleting: deletingBook,
  promptDelete,
  cancelDelete,
  confirmDelete,
} = useDeleteBook((id) => {
  books.value = books.value.filter((b) => b.id !== id)
})
const { handleBulkRefreshMetadata, handleBulkReExtractCover, handleExport, handleDeleteSelected } = useBookBulkActions(selectedIds, (ids) => {
  const deleted = new Set(ids)
  books.value = books.value.filter((b) => !deleted.has(b.id))
  exitSelectionMode()
})

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

function handleEditSelected() {
  const ids = [...selectedIds.value]
  if (ids.length === 0) return
  setBookContext(ids, ids.length)
  router.push({ name: 'book-edit', params: { bookId: ids[0] } })
  exitSelectionMode()
}

function handleBookAction(book: BookCard, action: 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'delete') {
  if (action === 'quick-view') {
    quickViewBookId.value = book.id
    quickViewOpen.value = true
    return
  }
  if (action === 'delete') {
    promptDelete(book.id)
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
      if (entries[0]?.isIntersecting && !loading.value && hasMore.value) load()
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
    if (!isLoading && hasMore.value && sentinel.value) {
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
    @edit="handleEditSelected"
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
  <DeleteBookDialog :open="deleteBookId !== null" :deleting="deletingBook" @confirm="confirmDelete" @cancel="cancelDelete" />

  <section class="flex min-h-full flex-col">
    <ViewHeader
      :title="collection?.name ?? 'Collection'"
      :icon="collection?.icon || 'FolderOpen'"
      :total="total"
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

    <main class="flex-1 min-h-0">
      <div v-if="!loading && books.length === 0" class="flex flex-col items-center justify-center py-24 gap-3 text-center">
        <div class="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
          <FolderOpen :size="28" class="text-muted-foreground/70" />
        </div>
        <p class="text-sm font-medium text-foreground">No books in this collection</p>
        <p class="text-xs text-muted-foreground">Select books from your library and add them here.</p>
      </div>

      <VirtualBookGrid
        v-if="viewMode === 'grid' && books.length > 0"
        :books="books"
        :cover-size="coverSize"
        :grid-gap="gridGap"
        :selection-mode="selectionMode"
        :is-selected="isSelected"
        @action="handleBookAction"
        @select="handleSelect"
      />

      <div v-if="viewMode === 'list' && books.length > 0" class="flex flex-col divide-y divide-border">
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
  </section>
</template>
