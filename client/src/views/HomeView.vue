<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDownAZ, ArrowUpAZ, Filter, X } from 'lucide-vue-next'
import BookCoverCard from '@/features/book/components/BookCoverCard.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import BookFilterBuilder from '@/features/book/components/BookFilterBuilder.vue'
import AppHeader from '@/components/AppHeader.vue'
import ViewHeader from '@/components/ViewHeader.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar'
import { useBookQuery, type BookCard } from '@/features/book/composables/useBookQuery'
import { useBookEvents } from '@/features/book/composables/useBookEvents'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { BACKGROUND_OPTIONS, useThemeStore } from '@/stores/theme'
import type { SortField } from '@projectx/types'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const backgroundClass = computed(() => BACKGROUND_OPTIONS.find((b) => b.id === themeStore.background)?.cssClass ?? '')
const { coverSize, gridGap, viewMode } = useDisplaySettings()
const { libraries, fetchLibraries } = useLibraries()

const libraryId = shallowRef<number | null>(route.params.id ? Number(route.params.id) : null)

const title = computed(() => libraries.value.find((l) => l.id === libraryId.value)?.name ?? 'Library')

const { items: books, total, loading, error, filter, sort, hasMore, load, clear } = useBookQuery(libraryId)

const { onBookMissing } = useBookEvents()
onBookMissing((bookIds) => {
  const missing = new Set(bookIds)
  for (const book of books.value) {
    if (missing.has(book.id)) book.status = 'missing'
  }
})

const filterOpen = ref(false)

const SORT_FIELD_LABELS: Record<SortField, string> = {
  title: 'Title',
  addedAt: 'Date Added',
  publishedYear: 'Published Year',
  pageCount: 'Page Count',
  seriesIndex: 'Series Index',
}

const sortField = computed({
  get: () => sort.value[0]?.field ?? 'title',
  set: (field: SortField) => {
    sort.value = [{ field, dir: sort.value[0]?.dir ?? 'asc' }]
    load(true)
  },
})

const sortDir = computed(() => sort.value[0]?.dir ?? 'asc')

function toggleSortDir() {
  sort.value = [{ field: sortField.value, dir: sortDir.value === 'asc' ? 'desc' : 'asc' }]
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

onMounted(async () => {
  await fetchLibraries()

  if (!libraryId.value && libraries.value.length > 0) {
    router.replace({ name: 'library', params: { id: libraries.value[0]!.id } })
  } else {
    load(true)
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

watch(libraryId, (newId) => {
  if (newId === null) clear()
})

watch(filter, () => load(true), { deep: true })

watch(loading, (isLoading) => {
  if (!isLoading) loadIfSentinelVisible()
})

type BookActionType = 'quick-view' | 'edit-metadata' | 'add-to-collection' | 'delete'

const quickViewBookId = ref<number | null>(null)
const quickViewOpen = ref(false)

function handleBookAction(book: BookCard, action: BookActionType) {
  if (action === 'quick-view') {
    quickViewBookId.value = book.id
    quickViewOpen.value = true
    return
  }
  // TODO: implement remaining actions
}
</script>

<template>
  <SidebarProvider>
    <AppSidebar />

    <SidebarInset class="flex flex-col min-h-screen glow-wrapper">
      <AppHeader />
      <ViewHeader
        :title="title"
        :total="total"
        :loaded="books.length"
        v-model:coverSize="coverSize"
        v-model:gridGap="gridGap"
        v-model:viewMode="viewMode"
      >
        <template #toolbar>
          <div class="flex items-center gap-1">
            <span class="text-xs text-muted-foreground hidden lg:block">Sort:</span>
            <select
              :value="sortField"
              @change="sortField = ($event.target as HTMLSelectElement).value as SortField"
              class="h-8 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option v-for="(label, field) in SORT_FIELD_LABELS" :key="field" :value="field">{{ label }}</option>
            </select>
            <button
              @click="toggleSortDir"
              class="h-8 w-8 flex items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              :title="sortDir === 'asc' ? 'Ascending' : 'Descending'"
            >
              <ArrowDownAZ v-if="sortDir === 'asc'" :size="15" />
              <ArrowUpAZ v-else :size="15" />
            </button>
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
          <button
            v-if="activeFilterCount > 0"
            @click="clearFilters"
            class="flex items-center gap-1 h-8 px-2 rounded-md text-sm text-muted-foreground hover:text-destructive transition-colors"
            title="Clear all filters"
          >
            <X :size="13" />
            Clear
          </button>
        </template>
      </ViewHeader>

      <main class="flex-1 overflow-y-auto px-4 py-4" :class="backgroundClass">
        <div v-if="error" class="text-sm text-destructive mb-4">{{ error }}</div>

        <!-- Filter builder panel -->
        <div v-if="filterOpen" class="mb-4 p-3 rounded-md border border-border bg-card">
          <BookFilterBuilder v-model="filter" />
        </div>

        <!-- Grid view -->
        <div
          v-if="viewMode === 'grid'"
          class="grid"
          :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`, gap: `${gridGap}px` }"
        >
          <BookCoverCard v-for="book in books" :key="book.id" :book="book" @action="handleBookAction(book, $event)" />
        </div>

        <!-- List view -->
        <div v-else class="flex flex-col divide-y divide-border">
          <BookListRow v-for="book in books" :key="book.id" :book="book" @action="handleBookAction(book, $event)" />
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
</template>
