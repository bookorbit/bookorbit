<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Search, X } from 'lucide-vue-next'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import BookCoverCard from '@/features/book/components/BookCoverCard.vue'
import AppHeader from '@/components/AppHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import SettingsDrawer from '@/features/settings/SettingsDrawer.vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { useBooks } from '@/features/book/composables/useBooks'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const backgroundClass = computed(() => BACKGROUND_OPTIONS.find((b) => b.id === themeStore.background)?.cssClass ?? '')
const { coverSize, gridGap, viewMode } = useDisplaySettings()
const { libraries, fetchLibraries } = useLibraries()

const libraryId = computed<number | null>(() => {
  const id = route.params.id
  return id ? Number(id) : null
})

const title = computed(() => libraries.value.find((l) => l.id === libraryId.value)?.name ?? 'Library')

const { books, total, loading, error, search, hasMore, load, onSearch } = useBooks(libraryId)

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

function loadIfSentinelVisible() {
  if (!hasMore.value || loading.value) return
  const el = sentinel.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  if (rect.top < window.innerHeight + 300) load()
}

onMounted(async () => {
  await fetchLibraries()

  if (!libraryId.value && libraries.value.length > 0) {
    router.replace({ name: 'library', params: { id: libraries.value[0]!.id } })
  } else {
    load()
  }

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !loading.value) load()
    },
    { rootMargin: '300px' },
  )
  if (sentinel.value) observer.observe(sentinel.value)
})

onUnmounted(() => observer?.disconnect())

watch(libraryId, (newId, oldId) => {
  if (newId !== null && newId !== oldId) {
    search.value = ''
    load(true)
  }
})

watch(loading, (isLoading) => {
  if (!isLoading) loadIfSentinelVisible()
})

let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(onSearch, 300)
})
</script>

<template>
  <SettingsDrawer />
  <SidebarProvider>
    <AppSidebar />

    <SidebarInset class="flex flex-col min-h-screen glow-wrapper">
      <AppHeader
        :title="title"
        :total="total"
        :loaded="books.length"
        v-model:coverSize="coverSize"
        v-model:gridGap="gridGap"
        v-model:viewMode="viewMode"
      />

      <main class="flex-1 overflow-y-auto px-4 py-4" :class="backgroundClass">
        <div v-if="error" class="text-sm text-destructive mb-4">{{ error }}</div>

        <!-- Library filter -->
        <div class="relative mb-4 max-w-xs">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" :size="13" />
          <input
            v-model="search"
            placeholder="Filter library..."
            class="w-full h-8 pl-8 pr-7 text-sm rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-shadow"
          />
          <button v-if="search" @click="search = ''" class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X :size="13" />
          </button>
        </div>

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
            <BookCoverImage :book-id="book.id" type="cover" class="h-12 w-9 object-cover rounded shrink-0 bg-muted" :alt="book.title ?? ''" />
            <div class="flex flex-col min-w-0">
              <span class="text-sm font-medium text-foreground truncate">{{ book.title ?? '-' }}</span>
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
