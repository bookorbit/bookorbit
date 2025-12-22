<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import BookCoverCard from '@/features/book/components/BookCoverCard.vue'
import AppHeader from '@/components/AppHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { useBooks } from '@/features/book/composables/useBooks'

const coverSize = ref(150)
const gridGap = ref(16)
const viewMode = ref<'grid' | 'list'>('grid')
const libraryId = ref<number | null>(null)

async function loadLibrary() {
  const res = await fetch('/api/libraries')
  if (!res.ok) return
  const libs: { id: number }[] = await res.json()
  if (libs.length > 0) libraryId.value = libs[0]!.id
}

const { books, total, loading, error, search, hasMore, load, onSearch } = useBooks(libraryId)

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(async () => {
  await loadLibrary()
  load()
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !loading.value) load()
    },
    { rootMargin: '300px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})

onUnmounted(() => observer?.disconnect())

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(onSearch, 300)
})
</script>

<template>
  <SidebarProvider>
    <AppSidebar />

    <SidebarInset class="flex flex-col min-h-screen">
      <AppHeader
        title="Library"
        :total="total"
        :loaded="books.length"
        v-model:search="search"
        v-model:coverSize="coverSize"
        v-model:gridGap="gridGap"
        v-model:viewMode="viewMode"
      />

      <main class="flex-1 overflow-y-auto px-4 py-4">
        <div v-if="error" class="text-sm text-destructive mb-4">{{ error }}</div>

        <!-- Grid view -->
        <div
          v-if="viewMode === 'grid'"
          class="grid"
          :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`, gap: `${gridGap}px` }"
        >
          <BookCoverCard v-for="book in books" :key="book.id" :book="book" />
        </div>

        <!-- List view -->
        <div v-else class="flex flex-col divide-y divide-border">
          <div
            v-for="book in books"
            :key="book.id"
            class="flex items-center gap-3 py-2.5 px-1 hover:bg-muted/50 rounded-md transition-colors cursor-pointer"
          >
            <img :src="`/api/books/${book.id}/cover`" class="h-12 w-9 object-cover rounded shrink-0 bg-muted" :alt="book.title ?? ''" />
            <div class="flex flex-col min-w-0">
              <span class="text-sm font-medium text-foreground truncate">{{ book.title ?? '—' }}</span>
              <span v-if="book.authors.length" class="text-xs text-muted-foreground truncate">{{ book.authors.join(', ') }}</span>
            </div>
          </div>
        </div>

        <div ref="sentinel" class="h-8 mt-4 flex items-center justify-center">
          <span v-if="loading" class="text-xs text-muted-foreground">Loading…</span>
          <span v-else-if="!hasMore && books.length > 0" class="text-xs text-muted-foreground"> All {{ total.toLocaleString() }} books loaded </span>
        </div>
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
