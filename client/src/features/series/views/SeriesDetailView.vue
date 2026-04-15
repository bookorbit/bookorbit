<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, Pencil } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

import type { BookCard } from '@projectx/types'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookNavigation } from '@/features/book/composables/useBookNavigation'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { usePageTitle } from '@/composables/usePageTitle'
import EntityNotFound from '@/components/EntityNotFound.vue'
import SeriesCompletionBar from '../components/SeriesCompletionBar.vue'
import SeriesGapBanner from '../components/SeriesGapBanner.vue'
import { useSeriesDetail } from '../composables/useSeriesDetail'

const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()
const { setBookContext } = useBookNavigation()

const { portraitCoverSize, gridGap, viewMode } = useDisplaySettings()
const { libraries, fetchLibraries } = useLibraries()

const seriesName = computed(() => {
  const raw = route.params.seriesName
  return typeof raw === 'string' ? raw : ''
})

const {
  seriesInfo,
  items: books,
  total,
  loading: loadingBooks,
  error: booksError,
  notFound,
  hasMore,
  sort,
  order,
  libraryId,
  load: loadBooks,
} = useSeriesDetail(seriesName)

const pageTitle = computed(() => {
  if (seriesInfo.value?.name) return `Series · ${seriesInfo.value.name}`
  return seriesName.value || 'Series'
})
usePageTitle(pageTitle)

const sentinel = ref<HTMLElement | null>(null)
const openingSeriesEditor = ref(false)
let observer: IntersectionObserver | null = null

const canEditMetadata = computed(() => hasPermission('library_edit_metadata'))

function handleBookAction(book: BookCard, action: string) {
  if (action === 'quick-view') {
    void router.push({ name: 'book-detail', params: { bookId: book.id } })
  }
}

function goBack() {
  if (window.history.length > 1 && route.query.from) {
    void router.push(route.query.from as string)
    return
  }
  void router.push({ name: 'series' })
}

function onLibraryFilterChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  libraryId.value = value ? Number(value) : null
}

async function editSeriesMetadata() {
  if (!canEditMetadata.value || openingSeriesEditor.value || loadingBooks.value) return

  if (books.value.length === 0) {
    toast.error('This series has no books to edit.')
    return
  }

  openingSeriesEditor.value = true
  try {
    while (hasMore.value) {
      const beforeCount = books.value.length
      await loadBooks()
      if (booksError.value || books.value.length === beforeCount) break
    }

    if (booksError.value || hasMore.value) {
      toast.error(booksError.value ?? 'Failed to load the full series for editing.')
      return
    }

    const ids = books.value.map((book) => book.id)
    if (ids.length === 0) {
      toast.error('This series has no books to edit.')
      return
    }

    setBookContext(ids, ids.length)
    await router.push({ name: 'book-detail', params: { bookId: ids[0] }, query: { tab: 'edit' } })
  } finally {
    openingSeriesEditor.value = false
  }
}

onMounted(async () => {
  await fetchLibraries()
  await loadBooks(true)

  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting && !loadingBooks.value) {
        void loadBooks()
      }
    },
    { rootMargin: '280px' },
  )

  await nextTick()
  if (sentinel.value) observer.observe(sentinel.value)
})

onUnmounted(() => {
  observer?.disconnect()
})

watch(
  [books, total],
  ([newBooks, newTotal]) => {
    setBookContext(
      newBooks.map((book) => book.id),
      newTotal,
    )
  },
  { immediate: true },
)

watch([sort, order, libraryId], () => {
  void loadBooks(true)
})

watch(seriesName, () => {
  void loadBooks(true)
})

watch(
  loadingBooks,
  (isLoading) => {
    if (!isLoading && sentinel.value) {
      if (sentinel.value.getBoundingClientRect().top < window.innerHeight + 250) {
        void loadBooks()
      }
    }
  },
  { flush: 'post' },
)
</script>

<template>
  <main class="flex-1 overflow-y-auto p-4 md:p-6">
    <div class="mb-4">
      <button class="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground" @click="goBack">
        <ChevronLeft :size="16" />
        Back
      </button>
    </div>

    <div v-if="notFound">
      <EntityNotFound entity="Series" />
    </div>

    <template v-else>
      <div v-if="booksError" class="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        {{ booksError }}
      </div>

      <!-- Series header -->
      <div v-if="seriesInfo" class="mb-4 rounded-xl border border-border/70 bg-card/60 p-4">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div class="min-w-0">
            <h1 class="text-xl font-bold text-foreground">{{ seriesInfo.name }}</h1>
            <div class="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>{{ seriesInfo.bookCount }} {{ seriesInfo.bookCount === 1 ? 'book' : 'books' }}</span>
              <span v-if="seriesInfo.authors.length > 0">by {{ seriesInfo.authors.join(', ') }}</span>
            </div>
          </div>

          <button
            v-if="canEditMetadata && books.length > 0"
            class="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-sm transition-colors hover:bg-muted disabled:opacity-40 sm:px-3 md:w-auto"
            :disabled="openingSeriesEditor || loadingBooks"
            @click="editSeriesMetadata"
          >
            <Pencil :size="14" />
            {{ openingSeriesEditor ? 'Preparing editor...' : 'Edit Series Metadata' }}
          </button>
        </div>
        <SeriesCompletionBar :read-count="seriesInfo.readCount" :total-count="seriesInfo.bookCount" class="mt-3 max-w-xs" />
        <SeriesGapBanner v-if="seriesInfo.possibleGaps.length > 0" :gaps="seriesInfo.possibleGaps" class="mt-3" />
      </div>

      <!-- Loading state -->
      <div v-if="loadingBooks && !seriesInfo" class="mb-4 rounded-xl border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground">
        Loading series...
      </div>

      <!-- Books section -->
      <section v-if="seriesInfo" class="rounded-xl border border-border/70 bg-card/60 p-3">
        <div class="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h2 class="text-sm font-semibold text-foreground">Books</h2>
          <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <select
              v-model="sort"
              class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60 sm:w-auto"
            >
              <option value="seriesIndex">Series Order</option>
              <option value="title">Title</option>
              <option value="addedAt">Recently Added</option>
            </select>

            <select
              v-model="order"
              class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60 sm:w-auto"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>

            <select
              :value="libraryId ?? ''"
              class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60 sm:w-auto"
              @change="onLibraryFilterChange"
            >
              <option value="">All Libraries</option>
              <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }}</option>
            </select>
          </div>
        </div>

        <div v-if="!loadingBooks && books.length === 0" class="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p class="text-sm font-medium text-foreground">No books found in this series</p>
          <p class="text-xs text-muted-foreground">Try selecting another library.</p>
        </div>

        <VirtualBookGrid
          v-if="viewMode === 'grid' && books.length > 0"
          :books="books"
          :cover-size="portraitCoverSize"
          :grid-gap="gridGap"
          @action="handleBookAction"
        />

        <div v-if="viewMode === 'list' && books.length > 0" class="flex flex-col divide-y divide-border">
          <BookListRow v-for="book in books" :key="book.id" :book="book" @action="handleBookAction(book, $event)" />
        </div>

        <div ref="sentinel" class="mt-4 flex h-8 items-center justify-center">
          <span v-if="loadingBooks" class="text-xs text-muted-foreground">Loading...</span>
          <span v-else-if="!hasMore && books.length > 0" class="text-xs text-muted-foreground"> All {{ total.toLocaleString() }} books loaded </span>
        </div>
      </section>
    </template>
  </main>
</template>
