<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { FolderOpen, Pencil } from 'lucide-vue-next'
import BookCoverCard from '@/features/book/components/BookCoverCard.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import AppHeader from '@/components/AppHeader.vue'
import ViewHeader from '@/components/ViewHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import EditCollectionDialog from '@/features/collection/components/EditCollectionDialog.vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { toast } from 'vue-sonner'
import { useCollections } from '@/features/collection/composables/useCollections'
import { useCollectionBooks } from '@/features/collection/composables/useCollectionBooks'
import { useBookSelection } from '@/features/book/composables/useBookSelection'
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

const { selectionMode, selectedIds, selectedCount, enterSelectionMode, exitSelectionMode, toggleBook, isSelected } = useBookSelection()

function toggleSelectionMode() {
  if (selectionMode.value) exitSelectionMode()
  else enterSelectionMode()
}

const addToCollectionOpen = ref(false)
const editCollectionOpen = ref(false)
let removingInProgress = false
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
watch(loading, (isLoading) => {
  if (!isLoading && sentinel.value) {
    const rect = sentinel.value.getBoundingClientRect()
    if (rect.top < window.innerHeight + 300) load()
  }
})
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
    @add-to-collection="addToCollectionOpen = true"
    @remove-from-collection="handleRemoveFromCollection"
    @delete="() => {}"
    @exit="exitSelectionMode"
  />

  <AddToCollectionSheet
    :open="addToCollectionOpen"
    :book-ids="[...selectedIds]"
    @update:open="addToCollectionOpen = $event"
    @done="exitSelectionMode"
  />

  <EditCollectionDialog v-if="collection" :open="editCollectionOpen" :collection="collection" @close="editCollectionOpen = false" />

  <SidebarProvider>
    <AppSidebar />

    <SidebarInset class="flex flex-col min-h-screen glow-wrapper">
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
          <button
            v-if="collection"
            class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title="Edit collection"
            @click="editCollectionOpen = true"
          >
            <Pencil :size="14" />
          </button>
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
          v-if="viewMode === 'grid' && books.length > 0"
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
            @select="toggleBook(book.id)"
          />
        </div>

        <div v-else-if="viewMode === 'list' && books.length > 0" class="flex flex-col divide-y divide-border">
          <BookListRow
            v-for="book in books"
            :key="book.id"
            :book="book"
            :selection-mode="selectionMode"
            :selected="isSelected(book.id)"
            @action="handleBookAction(book, $event)"
            @select="toggleBook(book.id)"
          />
        </div>

        <div ref="sentinel" class="h-8 mt-4 flex items-center justify-center">
          <span v-if="loading" class="text-xs text-muted-foreground">Loading...</span>
          <span v-else-if="!hasMore && books.length > 0" class="text-xs text-muted-foreground">All {{ total.toLocaleString() }} books loaded</span>
        </div>
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
