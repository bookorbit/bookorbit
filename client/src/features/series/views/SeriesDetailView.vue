<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { useRoute, useRouter } from 'vue-router'
import { ChevronLeft, Pencil } from '@lucide/vue'
import { toast } from 'vue-sonner'

import type { BookCard, BookDetail } from '@bookorbit/types'
import VirtualBookGrid from '@/features/book/components/VirtualBookGrid.vue'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { useScrollRestoreOnActivate } from '@/features/book/composables/useScrollRestoreOnActivate'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useBookNavigation } from '@/features/book/composables/useBookNavigation'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { usePageTitle } from '@/composables/usePageTitle'
import { useSafeHtml } from '@/features/book/composables/useSafeHtml'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { api } from '@/lib/api'
import EntityNotFound from '@/components/EntityNotFound.vue'
import AddToCollectionSheet from '@/features/collection/components/AddToCollectionSheet.vue'
import BookQuickView from '@/features/book/components/BookQuickView.vue'
import DeleteBookDialog from '@/features/book/components/DeleteBookDialog.vue'
import { useDeleteBook } from '@/features/book/composables/useDeleteBook'
import SeriesCompletionBar from '../components/SeriesCompletionBar.vue'
import SeriesGapBanner from '../components/SeriesGapBanner.vue'
import { fetchSeriesBooks } from '../api/series'
import { groupSeriesBooksByMedia } from '../composables/useSeriesBookMediaGroups'
import { useSeriesDetail } from '../composables/useSeriesDetail'
import { useCoverStack, MAX_VISIBLE as MAX_STACK_VISIBLE } from '../composables/useCoverStack'
import {
  PORTRAIT_STACK_FRAME_ASPECT_RATIO,
  centeredBottomScaleTransform,
  resolveCoverStackAspectRatio,
  resolveCoverStackDisplayMode,
  resolveCoverStackFrameAspectRatio,
  resolveSquareCoverScale,
  shouldPersistCoverRatio,
} from '../lib/cover-scale'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const mainRef = ref<HTMLElement | null>(null)
useScrollRestoreOnActivate(mainRef)
const { hasPermission } = usePermissions()
const { setBookContext } = useBookNavigation()
const { coverUrl } = useCoverVersions()

const { portraitCoverSize, gridGap } = useDisplaySettings()
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
  if (seriesInfo.value?.name) return t('series.detail.pageTitleNamed', { name: seriesInfo.value.name })
  return seriesId.value != null ? t('series.detail.pageTitleWithId', { id: seriesId.value }) : t('series.detail.pageTitle')
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
const GROUP_BY_MEDIA_STORAGE_KEY = 'bookorbit:series-detail:group-by-media'
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

function loadGroupByMediaPreference(): boolean {
  try {
    const stored = localStorage.getItem(GROUP_BY_MEDIA_STORAGE_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch {
    return false
  }

  return false
}

function saveGroupByMediaPreference(value: boolean) {
  try {
    localStorage.setItem(GROUP_BY_MEDIA_STORAGE_KEY, String(value))
  } catch {
    return
  }
}

const groupByMedia = ref(loadGroupByMediaPreference())
const nonEmptyMediaGroups = computed(() => groupSeriesBooksByMedia(books.value).filter((group) => group.books.length > 0))
const quickViewBookId = ref<number | null>(null)
const quickViewOpen = ref(false)

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
    addToCollectionOpen.value = false
    addToCollectionBookId.value = null
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
    return
  }
}

function handleAddToCollectionOpenChange(open: boolean) {
  addToCollectionOpen.value = open
  if (!open) addToCollectionBookId.value = null
}

function handleBookUpdate(updated: BookCard) {
  const idx = books.value.findIndex((b) => b.id === updated.id)
  if (idx !== -1) books.value = books.value.map((b, i) => (i === idx ? updated : b))
}

function handleGroupByMediaUpdate(value: boolean) {
  groupByMedia.value = value
  saveGroupByMediaPreference(value)
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

function leadCoverRatioAt(index: number): number | null {
  const bookId = visibleLeadCoverBookIds.value[index]
  return bookId == null ? null : (leadCoverRatios.value.get(bookId) ?? null)
}

const leadCoverFrameAspectRatios = computed(() =>
  visibleLeadCoverBookIds.value.map((_, index) => resolveCoverStackFrameAspectRatio(leadCoverRatioAt(index))),
)
const leadCoverDisplayModes = computed(() => visibleLeadCoverBookIds.value.map((_, index) => resolveCoverStackDisplayMode(leadCoverRatioAt(index))))

const scaledLeadCoverStyles = computed(() =>
  leadCoverStyles.value.map((base, index) => {
    const ratio = leadCoverRatioAt(index)
    const squareScale = resolveSquareCoverScale(ratio, SERIES_AUDIOBOOK_COVER_SCALE)
    const squareTransform = centeredBottomScaleTransform(squareScale)
    const baseForRatio = {
      ...base,
      aspectRatio: resolveCoverStackAspectRatio(ratio),
    }
    if (!squareTransform) return baseForRatio
    return {
      ...baseForRatio,
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
    leadBookError.value = err instanceof Error ? err.message : t('series.detail.leadBookLoadError')
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
    toast.error(t('series.detail.noBooksToEdit'))
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
      toast.error(booksError.value ?? t('series.detail.loadFullSeriesError'))
      return
    }

    const ids = books.value.map((book) => book.id)
    if (ids.length === 0) {
      toast.error(t('series.detail.noBooksToEdit'))
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
    if (seriesId.value === null) return
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

watch(seriesId, (newSeriesId) => {
  if (newSeriesId !== null) {
    void loadBooks({ reset: true })
  }
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

defineOptions({ name: 'SeriesDetailView' })
</script>

<template>
  <div class="flex h-full flex-col">
    <main ref="mainRef" class="flex-1 min-h-0 overflow-y-auto py-2">
      <div class="mb-4">
        <button class="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground" @click="goBack">
          <ChevronLeft :size="16" />
          {{ t('common.back') }}
        </button>
      </div>

      <div v-if="notFound">
        <EntityNotFound :entity="t('series.detail.entityName')" />
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
                class="series-cover-stack-container relative isolate rounded-lg border border-border/60 bg-linear-to-b from-white/[0.035] via-background/5 to-black/[0.07]"
                style="aspect-ratio: 11 / 8; transform-style: preserve-3d; perspective: 1000px"
              >
                <!-- Contained background decorative effects -->
                <div class="absolute inset-0 overflow-hidden rounded-lg pointer-events-none z-0">
                  <div class="absolute -right-8 -top-12 h-36 w-36 rounded-full bg-primary/10 blur-3xl" />
                  <div class="absolute -bottom-12 -left-10 h-32 w-32 rounded-full bg-primary/8 blur-3xl" />
                  <div class="absolute inset-x-[21%] bottom-[5%] h-4 rounded-full bg-black/10 blur-2xl opacity-38" />
                </div>

                <div
                  v-for="(bookId, i) in visibleLeadCoverBookIds"
                  :key="bookId"
                  class="series-cover-stack-item absolute overflow-hidden rounded-lg"
                  :style="{
                    ...(scaledLeadCoverStyles[i] ?? {}),
                    '--offset': i - (visibleLeadCoverBookIds.length - 1) / 2,
                    '--abs-offset': Math.abs(i - (visibleLeadCoverBookIds.length - 1) / 2),
                  }"
                >
                  <BookCoverArtwork
                    :src="coverUrl(bookId)"
                    :has-cover="true"
                    :title="seriesInfo.name"
                    :seed="`${seriesInfo.name}-${bookId}`"
                    alt=""
                    :mode="leadCoverDisplayModes[i]"
                    :frame-aspect-ratio="leadCoverFrameAspectRatios[i] ?? PORTRAIT_STACK_FRAME_ASPECT_RATIO"
                    loading="lazy"
                    decoding="async"
                    :spine="true"
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
                    <span>{{ t('series.detail.bookCount', { count: seriesInfo.bookCount }, seriesInfo.bookCount) }}</span>
                    <span v-if="visibleSeriesAuthors.length > 0">
                      {{ t('series.detail.byAuthors', { authors: visibleSeriesAuthors.join(', ') }) }}
                      <span v-if="hiddenSeriesAuthorsCount > 0"> {{ t('series.detail.moreAuthors', { count: hiddenSeriesAuthorsCount }) }}</span>
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
                  {{ openingSeriesEditor ? t('series.detail.preparingEditor') : t('series.detail.editMetadata') }}
                </button>
              </div>

              <SeriesCompletionBar :read-count="seriesInfo.readCount" :total-count="seriesInfo.bookCount" class="mt-3 max-w-xs" />
              <SeriesGapBanner v-if="seriesInfo.possibleGaps.length > 0" :gaps="seriesInfo.possibleGaps" class="mt-3" />

              <div class="mt-4 border-t border-border/60 pt-4">
                <div class="mb-2">
                  <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/90">{{ t('series.detail.firstInSeries') }}</p>
                  <p v-if="leadBook" class="mt-1 text-base font-semibold leading-tight text-foreground">
                    {{ leadBook.title ?? t('series.detail.untitled') }}
                    <span v-if="leadBook.seriesIndex != null" class="text-muted-foreground">#{{ leadBook.seriesIndex }}</span>
                  </p>
                  <p v-if="leadMetaItems.length > 0" class="mt-1 text-[11px] text-muted-foreground">
                    {{ leadMetaItems.join(' • ') }}
                  </p>
                </div>

                <div v-if="loadingLeadBook && !leadBook" class="text-sm text-muted-foreground">{{ t('series.detail.loadingFirstBook') }}</div>
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
                      {{ leadGenresExpanded ? t('series.detail.showLess') : t('series.detail.moreGenres', { count: hiddenLeadGenres }) }}
                    </button>
                  </div>

                  <div>
                    <p class="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{{ t('series.detail.synopsis') }}</p>
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
                        {{ leadDescriptionExpanded ? t('series.detail.showLess') : t('series.detail.showMore') }}
                      </button>
                    </div>
                    <p v-else class="text-sm italic text-muted-foreground">{{ t('series.detail.noDescription') }}</p>
                  </div>
                  <p v-if="loadingLeadBook" class="text-xs text-muted-foreground">{{ t('series.detail.updatingPreview') }}</p>
                </div>
                <div v-else class="text-sm text-muted-foreground">{{ t('series.detail.noBooksToPreview') }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Loading state -->
        <div v-if="loadingBooks && !seriesInfo" class="mb-4 rounded-lg border border-border/70 bg-card/60 p-4 text-sm text-muted-foreground">
          {{ t('series.detail.loadingSeries') }}
        </div>

        <!-- Books section -->
        <section v-if="seriesInfo" class="rounded-lg border border-border/70 bg-card/60 p-3">
          <div
            class="sticky top-0 z-20 -mx-3 mb-3 border-b border-border/60 bg-card/92 px-3 pb-3 pt-1 backdrop-blur supports-backdrop-filter:bg-card/78"
          >
            <div class="flex flex-col gap-2 md:flex-row md:items-center" :class="groupByMedia ? 'md:justify-end' : 'md:justify-between'">
              <h2 v-if="!groupByMedia" data-testid="series-books-section-heading" class="text-sm font-semibold text-foreground">
                {{ t('series.detail.booksHeading') }}
              </h2>
              <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <select
                  v-model="sort"
                  class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60 sm:w-auto"
                >
                  <option value="seriesIndex">{{ t('series.detail.sort.seriesOrder') }}</option>
                  <option value="title">{{ t('series.detail.sort.title') }}</option>
                  <option value="addedAt">{{ t('series.detail.sort.recentlyAdded') }}</option>
                </select>

                <select
                  v-model="order"
                  class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60 sm:w-auto"
                >
                  <option value="asc">{{ t('series.detail.order.ascending') }}</option>
                  <option value="desc">{{ t('series.detail.order.descending') }}</option>
                </select>

                <select
                  :value="libraryId ?? ''"
                  class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm outline-none transition-colors focus:border-primary/60 sm:w-auto"
                  @change="onLibraryFilterChange"
                >
                  <option value="">{{ t('series.detail.allLibraries') }}</option>
                  <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }}</option>
                </select>

                <div class="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input px-2.5 text-sm sm:w-auto">
                  <span class="whitespace-nowrap text-muted-foreground">{{ t('series.detail.groupByMedia') }}</span>
                  <ToggleSwitch
                    :model-value="groupByMedia"
                    :aria-label="t('series.detail.groupByMedia')"
                    data-testid="series-group-by-media-toggle"
                    @update:model-value="handleGroupByMediaUpdate"
                  />
                </div>
              </div>
            </div>
          </div>

          <div v-if="!loadingBooks && books.length === 0" class="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p class="text-sm font-medium text-foreground">{{ t('series.detail.noBooksFound') }}</p>
            <p class="text-xs text-muted-foreground">{{ t('series.detail.trySelectingLibrary') }}</p>
          </div>

          <template v-if="books.length > 0">
            <div v-if="groupByMedia" class="space-y-7">
              <section v-for="group in nonEmptyMediaGroups" :key="group.key" class="space-y-3" :data-testid="`series-media-group-${group.key}`">
                <div class="flex items-center justify-between border-b border-border/60 pb-2">
                  <h3 class="text-sm font-semibold text-foreground">{{ group.label }}</h3>
                  <span class="text-xs text-muted-foreground">{{ formatNumber(group.books.length) }}</span>
                </div>
                <VirtualBookGrid
                  :books="group.books"
                  :cover-size="seriesBooksCoverSize"
                  :grid-gap="gridGap"
                  :audio-cover-scale="SERIES_AUDIOBOOK_COVER_SCALE"
                  :virtualized="false"
                  @action="handleBookAction"
                  @update:book="handleBookUpdate"
                />
              </section>
            </div>

            <VirtualBookGrid
              v-else
              :books="books"
              :cover-size="seriesBooksCoverSize"
              :grid-gap="gridGap"
              :audio-cover-scale="SERIES_AUDIOBOOK_COVER_SCALE"
              :virtualized="false"
              @action="handleBookAction"
              @update:book="handleBookUpdate"
            />
          </template>

          <div ref="sentinel" class="mt-4 flex h-8 items-center justify-center">
            <span v-if="loadingBooks" class="text-xs text-muted-foreground">{{ t('common.loading') }}</span>
            <span v-else-if="!hasMore && books.length > 0" class="text-xs text-muted-foreground">
              {{ t('series.detail.allBooksLoaded', { count: formatNumber(total) }) }}
            </span>
          </div>
        </section>
      </template>
    </main>

    <AddToCollectionSheet
      :open="addToCollectionOpen"
      :selection-payload="{ bookIds: addToCollectionBookId ? [addToCollectionBookId] : [] }"
      :selected-count="addToCollectionBookId ? 1 : 0"
      @update:open="handleAddToCollectionOpenChange"
    />

    <BookQuickView
      :book-id="quickViewBookId"
      :open="quickViewOpen"
      @update:open="quickViewOpen = $event"
      @action="quickViewBookId !== null && handleBookAction({ id: quickViewBookId } as BookCard, $event)"
    />

    <DeleteBookDialog :open="deleteBookId !== null" :deleting="deletingBook" @confirm="confirmDelete" @cancel="cancelDelete" />
  </div>
</template>

<style scoped>
.series-cover-stack-container {
  transition: padding 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.series-cover-stack-item {
  transition:
    transform 0.4s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.4s ease;
  transform: perspective(1000px) rotateY(calc(var(--offset) * -8deg)) translateZ(calc(var(--abs-offset) * -18px))
    scale(calc(1 - var(--abs-offset) * 0.035));
  transform-style: preserve-3d;
  will-change: transform, box-shadow;
}

.series-cover-stack-container:hover .series-cover-stack-item {
  transform: perspective(1000px) rotateY(calc(var(--offset) * -3deg)) translateX(calc(var(--offset) * 14px))
    translateZ(calc(var(--abs-offset) * -10px)) scale(calc(1 - var(--abs-offset) * 0.015));
}

.series-cover-stack-item:hover {
  transform: perspective(1000px) rotateY(0deg) translateY(-12px) translateZ(40px) scale(1.03) !important;
  z-index: 50 !important;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.4),
    0 10px 10px -5px rgba(0, 0, 0, 0.3) !important;
}
</style>
