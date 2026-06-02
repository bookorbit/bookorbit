<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, Pencil, RotateCcw, SlidersHorizontal } from 'lucide-vue-next'
import { toast } from 'vue-sonner'

import type { BookCard, BookDetail, SortSpec } from '@bookorbit/types'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import BookListRow from '@/features/book/components/BookListRow.vue'
import VirtualBookTable from '@/features/book/components/VirtualBookTable.vue'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useEffectiveViewMode } from '@/composables/useEffectiveViewMode'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookNavigation } from '@/features/book/composables/useBookNavigation'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { usePageTitle } from '@/composables/usePageTitle'
import { useSafeHtml } from '@/features/book/composables/useSafeHtml'
import { api } from '@/lib/api'
import EntityNotFound from '@/components/EntityNotFound.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import SeriesCompletionBar from '../components/SeriesCompletionBar.vue'
import SeriesGapBanner from '../components/SeriesGapBanner.vue'
import { fetchSeriesBooks } from '../api/series'
import { useSeriesDetail } from '../composables/useSeriesDetail'
import { useCoverStack, MAX_VISIBLE as MAX_STACK_VISIBLE } from '../composables/useCoverStack'
import { centeredBottomScaleTransform, resolveSquareCoverScale, shouldPersistCoverRatio } from '../lib/cover-scale'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ColumnId } from '@/features/book/composables/useTableColumns'

const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()
const { setBookContext } = useBookNavigation()
const { coverUrl } = useCoverVersions()

const { portraitCoverSize, gridGap } = useDisplaySettings()
const { effectiveViewMode } = useEffectiveViewMode()
const { libraries, fetchLibraries } = useLibraries()

const seriesId = computed(() => {
  const raw = route.params.seriesId
  const value = typeof raw === 'string' ? Number(raw) : NaN
  return Number.isInteger(value) && value > 0 ? value : null
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
} = useSeriesDetail(seriesId)

const pageTitle = computed(() => {
  if (seriesInfo.value?.name) return `Series · ${seriesInfo.value.name}`
  return seriesId.value != null ? `Series #${seriesId.value}` : 'Series'
})
usePageTitle(pageTitle)

const sentinel = ref<HTMLElement | null>(null)
const openingSeriesEditor = ref(false)
const loadingLeadBook = ref(false)
const leadBookError = ref<string | null>(null)
const leadDescriptionExpanded = ref(false)
const leadGenresExpanded = ref(false)
const leadCoverBookIds = ref<number[]>([])
const failedLeadCovers = ref(new Set<number>())
const leadCoverRatios = ref(new Map<number, number>())
const leadBook = ref<{
  id: number
  title: string | null
  seriesIndex: number | null
  publishedYear: number | null
  language: string | null
  rating: number | null
  genres: string[]
  description: string | null
} | null>(null)
let observer: IntersectionObserver | null = null
let leadBookRequestToken = 0

const canEditMetadata = computed(() => hasPermission('library_edit_metadata'))
const safeLeadDescription = useSafeHtml(() => leadBook.value?.description)
const visibleSeriesAuthors = computed(() => (seriesInfo.value?.authors ?? []).slice(0, 5))
const hiddenSeriesAuthorsCount = computed(() => Math.max(0, (seriesInfo.value?.authors.length ?? 0) - visibleSeriesAuthors.value.length))
const addToCollectionOpen = ref(false)
const addToCollectionBookId = ref<number | null>(null)
const leadFallbackStyle = computed(() => {
  const name = seriesInfo.value?.name ?? pageTitle.value
  return bookCoverStyle(name || 'Series')
})
const leadInitial = computed(() => (seriesInfo.value?.name ?? 'Series').trim().charAt(0).toUpperCase() || '?')
const activeCoverIds = computed(() => leadCoverBookIds.value.filter((id) => !failedLeadCovers.value.has(id)))
const { visibleCovers: visibleLeadCoverBookIds, baseStyles: leadCoverStyles } = useCoverStack(activeCoverIds)
const displayedLeadGenres = computed(() => {
  const genres = leadBook.value?.genres ?? []
  if (leadGenresExpanded.value || genres.length <= 8) return genres
  return genres.slice(0, 8)
})
const hiddenLeadGenres = computed(() => {
  const totalGenres = leadBook.value?.genres.length ?? 0
  return Math.max(0, totalGenres - displayedLeadGenres.value.length)
})
const SERIES_AUDIOBOOK_COVER_SCALE = 1.25
const seriesBooksCoverSize = computed(() => Math.max(125, portraitCoverSize.value - 20))
const leadMetaItems = computed(() => {
  if (!leadBook.value) return []
  const items: string[] = []
  if (leadBook.value.publishedYear != null) items.push(String(leadBook.value.publishedYear))
  if (leadBook.value.language) items.push(leadBook.value.language.toUpperCase())
  if (leadBook.value.rating != null) items.push(`${leadBook.value.rating.toFixed(1)}★`)
  return items
})

type BookActionType = 'quick-view' | 'add-to-collection' | 'delete'

function handleBookAction(book: BookCard, action: BookActionType) {
  if (action === 'quick-view') {
    addToCollectionOpen.value = false
    addToCollectionBookId.value = null
    void router.push({ name: 'book-detail', params: { bookId: book.id } })
    return
  }

  if (action === 'add-to-collection') {
    addToCollectionBookId.value = book.id
    addToCollectionOpen.value = true
    return
  }
}

function handleAddToCollectionOpenChange(open: boolean) {
  addToCollectionOpen.value = open
  if (!open) addToCollectionBookId.value = null
}

function handleTableBookUpdate(updated: BookCard) {
  const idx = books.value.findIndex((b) => b.id === updated.id)
  if (idx !== -1) books.value = books.value.map((b, i) => (i === idx ? updated : b))
}

const tableSort = ref<SortSpec[]>([{ field: 'seriesIndex', dir: 'asc' }])
const tableRef = ref<InstanceType<typeof VirtualBookTable> | null>(null)

function handleResetColumns() {
  tableRef.value?.resetLayout()
}

function handleToggleColumn(id: ColumnId) {
  tableRef.value?.toggleColumn(id)
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

function handleLeadCoverError(bookId: number) {
  failedLeadCovers.value = new Set([...failedLeadCovers.value, bookId])
  if (leadCoverRatios.value.has(bookId)) {
    const nextRatios = new Map(leadCoverRatios.value)
    nextRatios.delete(bookId)
    leadCoverRatios.value = nextRatios
  }
}

function handleLeadCoverLoad(bookId: number, ratio: number | null) {
  const prev = leadCoverRatios.value.get(bookId)
  if (!shouldPersistCoverRatio(prev, ratio)) return
  leadCoverRatios.value = new Map(leadCoverRatios.value).set(bookId, ratio)
}

const scaledLeadCoverStyles = computed(() =>
  leadCoverStyles.value.map((base, index) => {
    const bookId = visibleLeadCoverBookIds.value[index]
    const ratio = bookId == null ? null : (leadCoverRatios.value.get(bookId) ?? null)
    const squareScale = resolveSquareCoverScale(ratio, SERIES_AUDIOBOOK_COVER_SCALE)
    const squareTransform = centeredBottomScaleTransform(squareScale)
    if (!squareTransform) return base
    return {
      ...base,
      ...squareTransform,
    }
  }),
)

async function loadLeadBookPreview(preserveCurrent = false) {
  const token = ++leadBookRequestToken
  if (seriesId.value == null) {
    leadBook.value = null
    leadBookError.value = null
    loadingLeadBook.value = false
    leadCoverBookIds.value = []
    leadCoverRatios.value = new Map<number, number>()
    return
  }

  loadingLeadBook.value = true
  leadBookError.value = null
  if (!preserveCurrent) {
    leadBook.value = null
    leadCoverBookIds.value = []
    failedLeadCovers.value = new Set<number>()
    leadCoverRatios.value = new Map<number, number>()
  }
  leadDescriptionExpanded.value = false
  leadGenresExpanded.value = false

  try {
    const firstPage = await fetchSeriesBooks(seriesId.value, {
      page: 0,
      size: MAX_STACK_VISIBLE,
      sort: 'seriesIndex',
      order: 'asc',
      libraryId: libraryId.value,
    })

    if (token !== leadBookRequestToken) return
    leadCoverBookIds.value = firstPage.items
      .filter((book) => book.hasCover)
      .map((book) => book.id)
      .slice(0, MAX_STACK_VISIBLE)
    const firstBook = firstPage.items[0]

    if (!firstBook) {
      leadBook.value = null
      return
    }

    const baseLeadBook = {
      id: firstBook.id,
      title: firstBook.title,
      seriesIndex: firstBook.seriesIndex,
      publishedYear: firstBook.publishedYear,
      language: firstBook.language,
      rating: firstBook.rating,
      genres: firstBook.genres,
      description: null,
    }
    leadBook.value = baseLeadBook

    const detailResponse = await api(`/api/v1/books/${firstBook.id}`)
    if (token !== leadBookRequestToken) return

    if (!detailResponse.ok) return

    const detail = (await detailResponse.json()) as BookDetail
    leadBook.value = {
      id: firstBook.id,
      title: detail.title ?? firstBook.title,
      seriesIndex: firstBook.seriesIndex,
      publishedYear: detail.publishedYear ?? firstBook.publishedYear,
      language: detail.language ?? firstBook.language,
      rating: detail.rating ?? firstBook.rating,
      genres: detail.genres.length > 0 ? detail.genres : firstBook.genres,
      description: detail.description,
    }
  } catch (err) {
    if (token !== leadBookRequestToken) return
    leadBookError.value = err instanceof Error ? err.message : 'Failed to load lead book details'
  } finally {
    if (token === leadBookRequestToken) loadingLeadBook.value = false
  }
}

function toggleLeadGenresExpanded() {
  leadGenresExpanded.value = !leadGenresExpanded.value
}

function toggleLeadDescriptionExpanded() {
  leadDescriptionExpanded.value = !leadDescriptionExpanded.value
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
  await loadBooks({ reset: true })

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
  void loadBooks({ reset: true, keepPreviousData: true })
})

watch(seriesId, () => {
  void loadBooks({ reset: true })
})

watch(
  [seriesId, libraryId],
  ([nextSeriesId], [prevSeriesId]) => {
    void loadLeadBookPreview(nextSeriesId === prevSeriesId)
  },
  { immediate: true },
)

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
  <main class="flex-1 overflow-y-auto py-2">
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
      <div v-if="seriesInfo" class="mb-4 rounded-lg border border-border/70 bg-card/60 p-4">
        <div class="flex flex-col gap-4 md:flex-row md:items-start">
          <div class="mx-auto w-full max-w-[360px] md:mx-0 md:w-[340px] md:shrink-0 lg:w-[360px]">
            <div
              class="relative isolate overflow-hidden rounded-lg border border-border/60 bg-linear-to-b from-white/[0.035] via-background/5 to-black/[0.07]"
              style="aspect-ratio: 11 / 8"
            >
              <div class="pointer-events-none absolute -right-8 -top-12 h-36 w-36 rounded-full bg-primary/10 blur-3xl" />
              <div class="pointer-events-none absolute -bottom-12 -left-10 h-32 w-32 rounded-full bg-primary/8 blur-3xl" />
              <div class="absolute inset-x-[21%] bottom-[5%] h-4 rounded-full bg-black/10 blur-2xl opacity-38" />

              <div
                v-for="(bookId, i) in visibleLeadCoverBookIds"
                :key="bookId"
                class="absolute overflow-hidden rounded-lg"
                :style="scaledLeadCoverStyles[i] ?? {}"
              >
                <BookCoverArtwork
                  :src="coverUrl(bookId)"
                  :has-cover="true"
                  :title="seriesInfo.name"
                  :seed="`${seriesInfo.name}-${bookId}`"
                  alt=""
                  frame-aspect-ratio="2/3"
                  loading="lazy"
                  decoding="async"
                  :spine="false"
                  @load="handleLeadCoverLoad(bookId, $event)"
                  @error="handleLeadCoverError(bookId)"
                />
              </div>

              <div
                v-if="visibleLeadCoverBookIds.length === 0"
                class="absolute inset-x-[28.5%] bottom-[5.5%] top-[5.5%] flex select-none items-center justify-center rounded-[14px] text-4xl font-bold shadow-[0_12px_28px_-18px_rgba(15,23,42,0.7)]"
                :style="{ background: leadFallbackStyle.background, color: leadFallbackStyle.color }"
              >
                {{ leadInitial }}
              </div>
            </div>
          </div>

          <div class="min-w-0 flex-1 md:border-l md:border-border/60 md:pl-6">
            <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div class="min-w-0">
                <h1 class="text-xl font-bold text-foreground">{{ seriesInfo.name }}</h1>
                <div class="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                  <span>{{ seriesInfo.bookCount }} {{ seriesInfo.bookCount === 1 ? 'book' : 'books' }}</span>
                  <span v-if="visibleSeriesAuthors.length > 0">
                    by {{ visibleSeriesAuthors.join(', ') }}
                    <span v-if="hiddenSeriesAuthorsCount > 0"> +{{ hiddenSeriesAuthorsCount }} more</span>
                  </span>
                </div>
              </div>

              <button
                v-if="canEditMetadata && books.length > 0"
                class="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-sm transition-colors hover:bg-muted disabled:opacity-40 sm:px-3 md:w-auto"
                :disabled="openingSeriesEditor || loadingBooks"
                @click="editSeriesMetadata"
              >
                <Pencil :size="14" />
                {{ openingSeriesEditor ? 'Preparing editor...' : 'Edit Metadata' }}
              </button>
            </div>

            <SeriesCompletionBar :read-count="seriesInfo.readCount" :total-count="seriesInfo.bookCount" class="mt-3 max-w-xs" />
            <SeriesGapBanner v-if="seriesInfo.possibleGaps.length > 0" :gaps="seriesInfo.possibleGaps" class="mt-3" />

            <div class="mt-4 border-t border-border/60 pt-4">
              <div class="mb-2">
                <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/90">First in Series</p>
                <p v-if="leadBook" class="mt-1 text-base font-semibold leading-tight text-foreground">
                  {{ leadBook.title ?? 'Untitled' }}
                  <span v-if="leadBook.seriesIndex != null" class="text-muted-foreground">#{{ leadBook.seriesIndex }}</span>
                </p>
                <p v-if="leadMetaItems.length > 0" class="mt-1 text-[11px] text-muted-foreground">
                  {{ leadMetaItems.join(' • ') }}
                </p>
              </div>

              <div v-if="loadingLeadBook && !leadBook" class="text-sm text-muted-foreground">Loading first book preview...</div>
              <div v-else-if="leadBookError" class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {{ leadBookError }}
              </div>
              <div v-else-if="leadBook" class="space-y-3">
                <div v-if="leadBook.genres.length" class="flex flex-wrap items-center gap-1.5">
                  <span
                    v-for="(genre, index) in displayedLeadGenres"
                    :key="`${genre}-${index}`"
                    class="rounded-full border border-primary/40 px-2.5 py-0.5 text-xs text-primary/85"
                  >
                    {{ genre }}
                  </span>
                  <button
                    v-if="hiddenLeadGenres > 0"
                    type="button"
                    class="whitespace-nowrap text-xs font-medium text-foreground/75 transition-colors hover:text-foreground"
                    @click="toggleLeadGenresExpanded"
                  >
                    {{ leadGenresExpanded ? 'Show less' : `+${hiddenLeadGenres} more` }}
                  </button>
                </div>

                <div>
                  <p class="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Synopsis</p>
                  <div v-if="leadBook.description">
                    <div
                      class="text-sm leading-relaxed text-foreground/85"
                      :class="leadDescriptionExpanded ? '' : 'line-clamp-3'"
                      v-html="safeLeadDescription"
                    />
                    <button
                      type="button"
                      class="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                      @click="toggleLeadDescriptionExpanded"
                    >
                      {{ leadDescriptionExpanded ? 'Show less' : 'Show more' }}
                    </button>
                  </div>
                  <p v-else class="text-sm italic text-muted-foreground">No description available.</p>
                </div>
                <p v-if="loadingLeadBook" class="text-xs text-muted-foreground">Updating preview...</p>
              </div>
              <div v-else class="text-sm text-muted-foreground">No books available to preview.</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading state -->
      <div v-if="loadingBooks && !seriesInfo" class="mb-4 rounded-lg border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground">
        Loading series...
      </div>

      <!-- Books section -->
      <section v-if="seriesInfo" class="rounded-lg border border-border/70 bg-card/60 p-3">
        <div
          class="sticky top-0 z-20 -mx-3 mb-3 border-b border-border/60 bg-card/92 px-3 pb-3 pt-1 backdrop-blur supports-backdrop-filter:bg-card/78"
        >
          <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
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

              <Popover v-if="effectiveViewMode === 'table'">
                <PopoverTrigger as-child>
                  <button
                    class="flex h-8 w-full items-center gap-1.5 rounded-md border border-input px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:w-auto"
                  >
                    <SlidersHorizontal :size="13" />
                    Columns
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" class="w-52 p-3">
                  <template v-if="tableRef">
                    <div class="mb-2 flex items-center justify-between">
                      <span class="text-xs font-semibold uppercase tracking-wide text-foreground">Columns</span>
                      <button class="text-xs text-muted-foreground hover:text-foreground" @click="handleResetColumns">
                        <RotateCcw :size="11" class="mr-0.5 inline" />Reset
                      </button>
                    </div>
                    <div class="space-y-1">
                      <label
                        v-for="col in tableRef.allColumns.filter((c) => c.pinned === null)"
                        :key="col.id"
                        class="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent"
                      >
                        <input type="checkbox" :checked="col.visible" class="accent-primary" @change="handleToggleColumn(col.id)" />
                        {{ col.header || col.id }}
                      </label>
                    </div>
                  </template>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        <div v-if="!loadingBooks && books.length === 0" class="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p class="text-sm font-medium text-foreground">No books found in this series</p>
          <p class="text-xs text-muted-foreground">Try selecting another library.</p>
        </div>

        <VirtualBookGrid
          v-if="effectiveViewMode === 'grid' && books.length > 0"
          :books="books"
          :cover-size="seriesBooksCoverSize"
          :grid-gap="gridGap"
          :audio-cover-scale="SERIES_AUDIOBOOK_COVER_SCALE"
          :virtualized="false"
          @action="handleBookAction"
          @update:book="handleTableBookUpdate"
        />

        <div v-if="effectiveViewMode === 'list' && books.length > 0" class="flex flex-col divide-y divide-border">
          <BookListRow v-for="book in books" :key="book.id" :book="book" @action="handleBookAction(book, $event)" />
        </div>

        <!-- Table view -->
        <VirtualBookTable
          v-if="effectiveViewMode === 'table'"
          ref="tableRef"
          :books="books"
          :sort="tableSort"
          view-type="series"
          @update:sort="tableSort = $event"
          @action="handleBookAction"
          @update:book="handleTableBookUpdate"
        />

        <div ref="sentinel" class="mt-4 flex h-8 items-center justify-center">
          <span v-if="loadingBooks" class="text-xs text-muted-foreground">Loading...</span>
          <span v-else-if="!hasMore && books.length > 0" class="text-xs text-muted-foreground"> All {{ total.toLocaleString() }} books loaded </span>
        </div>
      </section>
    </template>
  </main>

  <AddToCollectionSheet
    :open="addToCollectionOpen"
    :book-ids="addToCollectionBookId ? [addToCollectionBookId] : []"
    @update:open="handleAddToCollectionOpenChange"
  />
</template>
