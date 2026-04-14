<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue'
import { Aperture, BookMarked, ChevronLeft, ChevronRight, RefreshCw, Shuffle, Sparkles } from 'lucide-vue-next'

import type { BookCard, ScrollerType } from '@projectx/types'
import BookCoverCard from '@/features/book/components/BookCoverCard.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import DeleteBookDialog from '@/features/book/components/DeleteBookDialog.vue'
import { useDashboardScroller } from '../composables/useDashboardScroller'
import { useDeleteBook } from '@/features/book/composables/useDeleteBook'

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<{
  type: ScrollerType
  title: string
  limit?: number
  lensId?: number
}>()

const attrs = useAttrs()

const { books, loading, error, refresh } = useDashboardScroller(props.type, props.limit, props.lensId)

const scrollEl = ref<HTMLElement | null>(null)

function scrollBy(delta: number) {
  scrollEl.value?.scrollBy({ left: delta, behavior: 'smooth' })
}

const typeIcon = computed(() => {
  if (props.type === 'continue-reading') return BookMarked
  if (props.type === 'recently-added') return Sparkles
  if (props.type === 'lens') return Aperture
  return Shuffle
})

const SKELETONS = Array.from({ length: 8 })

type BookActionType = 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'delete'

const quickViewBookId = ref<number | null>(null)
const quickViewOpen = ref(false)

const addToCollectionOpen = ref(false)
const addToCollectionBookId = ref<number | null>(null)

const {
  pendingId: deleteBookId,
  deleting: deletingBook,
  promptDelete,
  cancelDelete,
  confirmDelete,
} = useDeleteBook((id) => {
  books.value = books.value.filter((b) => b.id !== id)
})

function handleBookAction(book: BookCard, action: BookActionType) {
  if (action === 'quick-view') {
    quickViewBookId.value = book.id
    quickViewOpen.value = true
    return
  }
  if (action === 'add-to-collection') {
    addToCollectionBookId.value = book.id
    addToCollectionOpen.value = true
    return
  }
  if (action === 'delete') {
    promptDelete(book.id)
  }
}
</script>

<template>
  <section v-bind="attrs" class="group/scroller overflow-hidden rounded-2xl border border-primary/40 bg-card/30 shadow-sm backdrop-blur-[1px]">
    <!-- Header -->
    <div class="mb-2 flex items-center justify-between px-5 pt-4">
      <div class="flex items-center gap-2.5">
        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50">
          <component :is="typeIcon" :size="14" class="text-foreground" />
        </div>
        <h2 class="text-[15px] font-bold tracking-tight">{{ title }}</h2>
        <span
          v-if="!loading && !error && books.length > 0"
          class="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground"
        >
          {{ books.length }}
        </span>
      </div>
      <div class="flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/scroller:opacity-100">
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="scrollBy(-560)"
        >
          <ChevronLeft :size="16" />
        </button>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="scrollBy(560)"
        >
          <ChevronRight :size="16" />
        </button>
      </div>
    </div>

    <!-- Skeleton -->
    <div v-if="loading" class="flex gap-3 overflow-hidden px-5 pb-5">
      <div v-for="(_, n) in SKELETONS" :key="n" class="w-[120px] shrink-0">
        <div class="w-full animate-pulse rounded-lg bg-muted" style="aspect-ratio: 2/3" />
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex items-center gap-2.5 px-5 pb-4 pt-1 text-sm text-muted-foreground">
      <span>Failed to load.</span>
      <button class="flex items-center gap-1.5 text-xs text-primary hover:underline" @click="refresh">
        <RefreshCw :size="12" />
        Retry
      </button>
    </div>

    <!-- Empty -->
    <div v-else-if="books.length === 0" class="flex flex-col items-center justify-center py-10 gap-3 text-center animate-fade-up">
      <div class="h-12 w-12 rounded-full bg-muted flex items-center justify-center animate-scale-in">
        <component :is="typeIcon" :size="20" class="text-muted-foreground/60" />
      </div>
      <p class="text-sm text-muted-foreground">
        <template v-if="type === 'continue-reading'">No books in progress yet. Start reading one to see it here.</template>
        <template v-else-if="type === 'recently-added'">No books in your library yet.</template>
        <template v-else-if="type === 'lens'">No books match this lens.</template>
        <template v-else>No books found.</template>
      </p>
    </div>

    <!-- Books row -->
    <div v-else ref="scrollEl" class="flex gap-5 overflow-x-auto px-5 pb-5 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div
        v-for="(book, index) in books"
        :key="book.id"
        class="w-[120px] shrink-0"
        style="animation: dashboardFadeUp 0.35s ease both"
        :style="{ animationDelay: `${index * 35}ms` }"
      >
        <BookCoverCard :book="book" @action="handleBookAction(book, $event)" />
      </div>
    </div>
  </section>

  <BookQuickView :book-id="quickViewBookId" :open="quickViewOpen" @update:open="quickViewOpen = $event" />

  <AddToCollectionSheet
    :open="addToCollectionOpen"
    :book-ids="addToCollectionBookId ? [addToCollectionBookId] : []"
    @update:open="addToCollectionOpen = $event"
  />

  <DeleteBookDialog :open="deleteBookId !== null" :deleting="deletingBook" @confirm="confirmDelete" @cancel="cancelDelete" />
</template>

<style scoped>
@keyframes dashboardFadeUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
