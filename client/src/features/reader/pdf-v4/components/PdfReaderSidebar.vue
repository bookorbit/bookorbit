<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { BookOpen, ChevronLeft, ChevronRight, FileText, LoaderCircle, Search, X } from '@lucide/vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { MatchFlag, type SearchResult } from '@embedpdf/models'
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/vue'
import { useBookmarkCapability } from '@embedpdf/plugin-bookmark/vue'
import { useScroll } from '@embedpdf/plugin-scroll/vue'
import { useSearch } from '@embedpdf/plugin-search/vue'
import { ThumbImg, ThumbnailsPane } from '@embedpdf/plugin-thumbnail/vue'
import { flattenPdfBookmarks, type FlatPdfBookmark } from '../pdf-viewer-utils'

export type PdfSidebarTab = 'thumbnails' | 'contents' | 'search'

const props = defineProps<{
  documentId: string
  activeTab: PdfSidebarTab
  headerVisible: boolean
}>()

const emit = defineEmits<{
  close: []
  'update:activeTab': [tab: PdfSidebarTab]
}>()

const { state: scrollState, provides: scroll } = useScroll(() => props.documentId)
const { state: searchState, provides: search } = useSearch(() => props.documentId)
const { provides: bookmarksCapability } = useBookmarkCapability()
const { provides: annotationCapability } = useAnnotationCapability()

const searchQuery = ref(searchState.value.query ?? '')
const searchPending = ref(false)
const searchProgressPage = ref(0)
const searchInput = ref<HTMLInputElement | null>(null)
const bookmarks = ref<FlatPdfBookmark[]>([])
const bookmarksLoading = ref(false)
const bookmarksLoaded = ref(false)

const normalizedSearchQuery = computed(() => searchQuery.value.trim())
const matchCase = computed(() => searchState.value.flags.includes(MatchFlag.MatchCase))
const wholeWord = computed(() => searchState.value.flags.includes(MatchFlag.MatchWholeWord))
const activeResultNumber = computed(() => (searchState.value.activeResultIndex >= 0 ? searchState.value.activeResultIndex + 1 : 0))

function getSearchResultKey(_result: SearchResult, index: number) {
  return index
}

function handleClose() {
  emit('close')
}

function selectThumbnails() {
  emit('update:activeTab', 'thumbnails')
}

function selectContents() {
  emit('update:activeTab', 'contents')
}

function selectSearch() {
  emit('update:activeTab', 'search')
}

function handleThumbnail(pageIndex: number) {
  scroll.value?.scrollToPage({ pageNumber: pageIndex + 1, behavior: 'smooth' })
}

function scrollToSearchResult(index: number) {
  const result = searchState.value.results[index]
  if (!result) return
  if (result.rects.length === 0) {
    scroll.value?.scrollToPage({ pageNumber: result.pageIndex + 1 })
    return
  }
  const coordinates = result.rects.reduce(
    (minimum, rect) => ({
      x: Math.min(minimum.x, rect.origin.x),
      y: Math.min(minimum.y, rect.origin.y),
    }),
    { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
  )
  scroll.value?.scrollToPage({
    pageNumber: result.pageIndex + 1,
    pageCoordinates: coordinates,
    alignX: 50,
    alignY: 30,
  })
}

function handleSearchResult(index: number) {
  search.value?.goToResult(index)
  scrollToSearchResult(index)
}

function handlePreviousResult() {
  const total = searchState.value.total
  if (total <= 0) return
  const current = searchState.value.activeResultIndex
  const index = current <= 0 ? total - 1 : current - 1
  search.value?.goToResult(index)
  scrollToSearchResult(index)
}

function handleNextResult() {
  const total = searchState.value.total
  if (total <= 0) return
  const current = searchState.value.activeResultIndex
  const index = current >= total - 1 ? 0 : current + 1
  search.value?.goToResult(index)
  scrollToSearchResult(index)
}

function handleSearchKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (event.shiftKey) handlePreviousResult()
  else handleNextResult()
}

function handleClearSearch() {
  searchQuery.value = ''
  searchProgressPage.value = 0
  search.value?.stopSearch()
  void nextTick(() => searchInput.value?.focus())
}

function handleMatchCase(event: Event) {
  updateSearchFlag(MatchFlag.MatchCase, (event.target as HTMLInputElement).checked)
}

function handleWholeWord(event: Event) {
  updateSearchFlag(MatchFlag.MatchWholeWord, (event.target as HTMLInputElement).checked)
}

function updateSearchFlag(flag: MatchFlag, enabled: boolean) {
  const flags = new Set(searchState.value.flags)
  if (enabled) flags.add(flag)
  else flags.delete(flag)
  search.value?.setFlags([...flags])
}

function handleBookmark(entry: FlatPdfBookmark) {
  const target = entry.bookmark.target
  if (!target) return
  annotationCapability.value?.forDocument(props.documentId).navigateTarget(target)
}

function getBookmarkIndent(depth: number) {
  return `${10 + Math.min(depth, 6) * 16}px`
}

function loadBookmarks() {
  if (bookmarksLoaded.value || bookmarksLoading.value || !bookmarksCapability.value) return
  bookmarksLoading.value = true
  bookmarksCapability.value
    .forDocument(props.documentId)
    .getBookmarks()
    .wait(
      ({ bookmarks: items }) => {
        bookmarks.value = flattenPdfBookmarks(items)
        bookmarksLoaded.value = true
        bookmarksLoading.value = false
      },
      () => {
        bookmarksLoaded.value = true
        bookmarksLoading.value = false
      },
    )
}

watch(
  [searchQuery, () => props.activeTab],
  ([query, activeTab], _previous, onCleanup) => {
    const normalized = query.trim()
    searchPending.value = false
    searchProgressPage.value = 0
    search.value?.stopSearch()
    if (activeTab !== 'search' || normalized.length < 2) return

    searchPending.value = true
    const timer = window.setTimeout(() => {
      searchPending.value = false
      const task = search.value?.searchAllPages(normalized)
      task?.onProgress((progress) => {
        searchProgressPage.value = progress.page + 1
      })
    }, 250)
    onCleanup(() => window.clearTimeout(timer))
  },
  { flush: 'post', immediate: true },
)

watch(
  () => [props.activeTab, bookmarksCapability.value] as const,
  ([tab]) => {
    if (tab === 'contents') {
      loadBookmarks()
      return
    }
    if (tab === 'search') void nextTick(() => searchInput.value?.focus())
  },
  { immediate: true },
)

onUnmounted(() => search.value?.stopSearch())
</script>

<template>
  <div
    data-pdf-reader-panel
    class="fixed inset-x-0 bottom-0 z-40 flex bg-background/40 md:static md:z-auto md:h-full md:w-[19rem] md:shrink-0 md:bg-transparent"
    :class="props.headerVisible ? 'top-11' : 'top-0'"
    @click.self="handleClose"
  >
    <aside
      class="pointer-events-auto flex h-full w-[18rem] max-w-[88vw] flex-col overflow-hidden border-r border-border bg-card text-card-foreground shadow-2xl sm:w-[19rem]"
    >
      <div class="flex h-11 shrink-0 items-center border-b border-border px-2">
        <div class="grid min-w-0 flex-1 grid-cols-3">
          <button
            class="relative flex min-w-0 items-center justify-center gap-1 px-1 py-2.5 text-[13px] transition-colors"
            :class="props.activeTab === 'thumbnails' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
            @click="selectThumbnails"
          >
            <FileText :size="15" />
            <span>Pages</span>
            <span v-if="props.activeTab === 'thumbnails'" class="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full bg-primary" />
          </button>
          <button
            class="relative flex min-w-0 items-center justify-center gap-1 px-1 py-2.5 text-[13px] transition-colors"
            :class="props.activeTab === 'contents' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
            @click="selectContents"
          >
            <BookOpen :size="15" />
            <span>Contents</span>
            <span v-if="props.activeTab === 'contents'" class="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full bg-primary" />
          </button>
          <button
            class="relative flex min-w-0 items-center justify-center gap-1 px-1 py-2.5 text-[13px] transition-colors"
            :class="props.activeTab === 'search' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
            @click="selectSearch"
          >
            <Search :size="15" />
            <span>Search</span>
            <span v-if="props.activeTab === 'search'" class="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full bg-primary" />
          </button>
        </div>
        <button class="viewer-btn ml-1" aria-label="Close navigation" @click="handleClose">
          <X :size="17" />
        </button>
      </div>

      <div v-if="props.activeTab === 'thumbnails'" class="min-h-0 flex-1 overflow-hidden bg-muted/25">
        <ThumbnailsPane :document-id="props.documentId" class="h-full w-full">
          <template #default="{ meta }">
            <button
              class="absolute flex w-full cursor-pointer flex-col items-center"
              :style="{ height: `${meta.wrapperHeight}px`, top: `${meta.top}px` }"
              :aria-label="`Go to page ${meta.pageIndex + 1}`"
              @click="handleThumbnail(meta.pageIndex)"
            >
              <span
                class="overflow-hidden rounded border-2 bg-background shadow-sm transition-colors"
                :class="
                  scrollState.currentPage === meta.pageIndex + 1
                    ? 'border-primary ring-2 ring-primary/15'
                    : 'border-border hover:border-muted-foreground/50'
                "
                :style="{ width: `${meta.width}px`, height: `${meta.height}px` }"
              >
                <ThumbImg :document-id="props.documentId" :meta="meta" class="h-full w-full object-contain" />
              </span>
              <span class="mt-1 text-xs tabular-nums text-muted-foreground">{{ meta.pageIndex + 1 }}</span>
            </button>
          </template>
        </ThumbnailsPane>
      </div>

      <div v-else-if="props.activeTab === 'contents'" class="min-h-0 flex-1 overflow-y-auto p-2">
        <div v-if="bookmarksLoading" class="flex h-32 items-center justify-center text-muted-foreground">
          <LoaderCircle :size="22" class="animate-spin" />
        </div>
        <p v-else-if="bookmarks.length === 0" class="px-3 py-8 text-center text-xs text-muted-foreground">This PDF has no document outline.</p>
        <button
          v-for="(entry, entryIndex) in bookmarks"
          :key="entryIndex"
          class="flex w-full min-w-0 items-start overflow-hidden rounded-md py-2 pr-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          :style="{ paddingLeft: getBookmarkIndent(entry.depth) }"
          @click="handleBookmark(entry)"
        >
          <span class="line-clamp-2 min-w-0 break-words">{{ entry.bookmark.title }}</span>
        </button>
      </div>

      <div v-else class="flex min-h-0 flex-1 flex-col">
        <div class="shrink-0 border-b border-border p-3">
          <div class="relative">
            <Search :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              ref="searchInput"
              v-model="searchQuery"
              type="search"
              placeholder="Search this PDF"
              class="h-9 w-full rounded-md border border-border bg-background pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              @keydown="handleSearchKeydown"
            />
            <button
              v-if="searchQuery"
              class="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
              @click="handleClearSearch"
            >
              <X :size="14" />
            </button>
          </div>
          <div class="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <label class="flex items-center gap-1.5">
              <input type="checkbox" :checked="matchCase" class="accent-primary" @change="handleMatchCase" />
              Match case
            </label>
            <label class="flex items-center gap-1.5">
              <input type="checkbox" :checked="wholeWord" class="accent-primary" @change="handleWholeWord" />
              Whole word
            </label>
          </div>
          <div v-if="searchState.active && !searchState.loading" class="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{{ activeResultNumber }} of {{ searchState.total }}</span>
            <div v-if="searchState.total > 1" class="flex items-center">
              <button class="viewer-btn !h-7 !w-7" aria-label="Previous result" @click="handlePreviousResult"><ChevronLeft :size="15" /></button>
              <button class="viewer-btn !h-7 !w-7" aria-label="Next result" @click="handleNextResult"><ChevronRight :size="15" /></button>
            </div>
          </div>
        </div>

        <div v-if="searchPending || searchState.loading" class="flex flex-1 items-center justify-center text-muted-foreground">
          <div class="flex flex-col items-center gap-2" role="status" aria-live="polite">
            <LoaderCircle :size="22" class="animate-spin" />
            <span class="text-xs">Searching page {{ searchProgressPage || 1 }} of {{ scrollState.totalPages || 1 }}</span>
          </div>
        </div>
        <p v-else-if="normalizedSearchQuery.length === 1" class="px-4 py-8 text-center text-xs text-muted-foreground">
          Enter at least 2 characters to search this PDF.
        </p>
        <p v-else-if="normalizedSearchQuery.length >= 2 && searchState.total === 0" class="px-4 py-8 text-center text-xs text-muted-foreground">
          No searchable text matched your query.
        </p>
        <RecycleScroller
          v-else
          v-slot="{ item, index }"
          class="min-h-0 min-w-0 flex-1 overflow-x-hidden p-2"
          :items="searchState.results"
          :item-size="76"
          :key-field="getSearchResultKey"
        >
          <button
            class="mb-1.5 h-[70px] w-full min-w-0 overflow-hidden rounded-md border p-2 text-left text-xs transition-colors"
            :class="
              index === searchState.activeResultIndex
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:text-foreground'
            "
            @click="handleSearchResult(index)"
          >
            <span class="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Page {{ item.pageIndex + 1 }}</span>
            <span class="line-clamp-2 min-w-0 break-words">
              <template v-if="item.context.truncatedLeft">… </template>{{ item.context.before
              }}<mark class="rounded-sm bg-primary/20 px-0.5 text-foreground">{{ item.context.match }}</mark
              >{{ item.context.after }}<template v-if="item.context.truncatedRight"> …</template>
            </span>
          </button>
        </RecycleScroller>
        <span class="sr-only" aria-live="polite">{{ searchState.total }} search results</span>
      </div>
    </aside>
  </div>
</template>
