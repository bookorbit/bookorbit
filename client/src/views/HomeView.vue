<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import BookCoverCard from '@/features/book/components/BookCoverCard.vue'
import { useBooks } from '@/features/book/composables/useBooks'

const coverSize = ref(150)
const libraryId = ref<number | null>(null)

// Fetch the first available library
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
  <div class="flex flex-col h-screen bg-background">
    <!-- Header -->
    <header class="shrink-0 px-4 py-3 border-b border-border flex items-center gap-4">
      <h1 class="text-sm font-semibold text-foreground">Library</h1>
      <span class="text-xs text-muted-foreground"> {{ books.length.toLocaleString() }} / {{ total.toLocaleString() }} </span>

      <!-- Search -->
      <input
        v-model="search"
        placeholder="Search..."
        class="w-52 px-3 py-1.5 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />

      <!-- Cover size slider -->
      <div class="ml-auto flex items-center gap-2">
        <span class="text-xs text-muted-foreground">Cover</span>
        <input v-model.number="coverSize" type="range" min="80" max="280" step="10" class="w-24 accent-primary cursor-pointer" />
        <span class="text-xs text-muted-foreground w-8">{{ coverSize }}px</span>
      </div>
    </header>

    <!-- Grid -->
    <main class="flex-1 overflow-y-auto px-4 py-4">
      <div v-if="error" class="text-sm text-destructive mb-4">{{ error }}</div>

      <div class="grid gap-4" :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))` }">
        <BookCoverCard v-for="book in books" :key="book.id" :book="book" />
      </div>

      <!-- Infinite scroll sentinel -->
      <div ref="sentinel" class="h-8 mt-4 flex items-center justify-center">
        <span v-if="loading" class="text-xs text-muted-foreground">Loading...</span>
        <span v-else-if="!hasMore && books.length > 0" class="text-xs text-muted-foreground"> All {{ total.toLocaleString() }} books loaded </span>
      </div>
    </main>
  </div>
</template>
