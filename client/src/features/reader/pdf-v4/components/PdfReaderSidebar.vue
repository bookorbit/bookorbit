<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, ChevronLeft, ChevronRight, FileText, Highlighter, LoaderCircle, Search, StickyNote, Trash2, X } from '@lucide/vue'
import { RecycleScroller } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import { MatchFlag, type SearchResult } from '@embedpdf/models'
import { useAnnotationCapability } from '@embedpdf/plugin-annotation/vue'
import { useBookmarkCapability } from '@embedpdf/plugin-bookmark/vue'
import { useScroll } from '@embedpdf/plugin-scroll/vue'
import { useSearch } from '@embedpdf/plugin-search/vue'
import { ThumbImg, ThumbnailsPane } from '@embedpdf/plugin-thumbnail/vue'
import { flattenPdfBookmarks, type FlatPdfBookmark } from '../pdf-viewer-utils'
import { ANNOTATION_HIGHLIGHT_COLORS, type AnnotationItem } from '@bookorbit/types'

export type PdfSidebarTab = 'thumbnails' | 'contents' | 'search' | 'highlights'

const props = defineProps<{
  documentId: string
  activeTab: PdfSidebarTab
  headerVisible: boolean
  annotations: AnnotationItem[]
  loadError?: boolean
  loading?: boolean
  loadingMore?: boolean
  hasMore?: boolean
}>()

const { t } = useI18n()

const emit = defineEmits<{
  close: []
  'update:activeTab': [tab: PdfSidebarTab]
  navigateHighlight: [annotation: AnnotationItem]
  deleteHighlight: [id: number]
  retryHighlights: []
  loadMoreHighlights: []
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

const tabs = computed(() => [
  { id: 'thumbnails' as const, icon: FileText, label: t('reader.pdf.sidebar.pages') },
  { id: 'contents' as const, icon: BookOpen, label: t('reader.pdf.sidebar.contents') },
  { id: 'search' as const, icon: Search, label: t('reader.pdf.sidebar.search') },
  { id: 'highlights' as const, icon: Highlighter, label: t('reader.sidebar.tabs.notesShort') },
])

const sidebarId = `pdf-sidebar-${useId()}`
const tabListEl = ref<HTMLElement | null>(null)

function tabId(tab: PdfSidebarTab) {
  return `${sidebarId}-tab-${tab}`
}

function panelId(tab: PdfSidebarTab) {
  return `${sidebarId}-panel-${tab}`
}

function selectTab(tab: PdfSidebarTab) {
  emit('update:activeTab', tab)
}

function handleTabKeydown(event: KeyboardEvent) {
  const options = tabs.value
  const current = options.findIndex((tab) => tab.id === props.activeTab)
  let next: number
  if (event.key === 'ArrowRight') next = (current + 1) % options.length
  else if (event.key === 'ArrowLeft') next = (current - 1 + options.length) % options.length
  else if (event.key === 'Home') next = 0
  else if (event.key === 'End') next = options.length - 1
  else return

  event.preventDefault()
  const nextTab = options[next]
  if (!nextTab) return
  selectTab(nextTab.id)
  void nextTick(() => tabListEl.value?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus())
}

const highlightQuery = ref('')
const highlightColorFilter = ref('all')
const highlightNotesOnly = ref(false)

const HIGHLIGHT_COLOR_NAMES: Record<string, string> = Object.fromEntries(
  ANNOTATION_HIGHLIGHT_COLORS.map((color) => [color.hex.toUpperCase(), color.name]),
)

function getHighlightColorLabel(color: string): string {
  const name = HIGHLIGHT_COLOR_NAMES[color.trim().toUpperCase()]
  return name ? t(`annotations.colors.${name}`) : t('reader.sidebar.customColor', { color })
}

const highlightColorOptions = computed(() =>
  Array.from(new Set(props.annotations.map((annotation) => annotation.color)))
    .map((hex) => ({ hex, label: getHighlightColorLabel(hex) }))
    .sort((a, b) => a.label.localeCompare(b.label)),
)

const filteredHighlights = computed(() => {
  const query = highlightQuery.value.trim().toLowerCase()
  return props.annotations
    .filter((annotation) => {
      if (highlightColorFilter.value !== 'all' && annotation.color !== highlightColorFilter.value) return false
      if (highlightNotesOnly.value && !annotation.note?.trim()) return false
      if (!query) return true
      return `${annotation.text} ${annotation.note ?? ''}`.toLowerCase().includes(query)
    })
    .sort((a, b) => {
      const pageA = a.pdf?.page ?? a.pageno ?? 0
      const pageB = b.pdf?.page ?? b.pageno ?? 0
      if (pageA !== pageB) return pageA - pageB
      return (a.pdf?.rect.y ?? 0) - (b.pdf?.rect.y ?? 0)
    })
})

function highlightPageLabel(annotation: AnnotationItem): number | null {
  if (annotation.pdf) return annotation.pdf.page + 1
  return annotation.pageno
}

function handleNavigateHighlight(annotation: AnnotationItem) {
  emit('navigateHighlight', annotation)
}

function handleDeleteHighlight(id: number) {
  emit('deleteHighlight', id)
}

function handleRetryHighlights() {
  emit('retryHighlights')
}

function handleLoadMoreHighlights() {
  emit('loadMoreHighlights')
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
      <div class="flex h-14 shrink-0 items-stretch border-b border-border">
        <div
          ref="tabListEl"
          role="tablist"
          :aria-label="t('reader.pdf.sidebar.tabsLabel')"
          class="flex min-w-0 flex-1 items-stretch"
          @keydown="handleTabKeydown"
        >
          <button
            v-for="tab in tabs"
            :id="tabId(tab.id)"
            :key="tab.id"
            type="button"
            role="tab"
            :aria-selected="props.activeTab === tab.id"
            :aria-controls="panelId(tab.id)"
            :tabindex="props.activeTab === tab.id ? 0 : -1"
            class="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
            :class="
              props.activeTab === tab.id
                ? 'text-primary'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:text-foreground'
            "
            @click="selectTab(tab.id)"
          >
            <component :is="tab.icon" :size="16" class="shrink-0" aria-hidden="true" />
            <span class="w-full truncate text-center text-[11px] leading-none">{{ tab.label }}</span>
            <span v-if="props.activeTab === tab.id" aria-hidden="true" class="absolute inset-x-0 bottom-0 h-0.5 rounded-t-full bg-primary" />
          </button>
        </div>
        <div class="flex shrink-0 items-center border-l border-border px-1.5">
          <button type="button" class="viewer-btn" :aria-label="t('reader.pdf.sidebar.closeNavigation')" @click="handleClose">
            <X :size="17" />
          </button>
        </div>
      </div>

      <div
        v-if="props.activeTab === 'thumbnails'"
        :id="panelId('thumbnails')"
        role="tabpanel"
        :aria-labelledby="tabId('thumbnails')"
        class="min-h-0 flex-1 overflow-hidden bg-muted/25"
      >
        <ThumbnailsPane :document-id="props.documentId" class="h-full w-full">
          <template #default="{ meta }">
            <button
              class="absolute flex w-full cursor-pointer flex-col items-center"
              :style="{ height: `${meta.wrapperHeight}px`, top: `${meta.top}px` }"
              :aria-label="t('reader.pdf.sidebar.goToPage', { page: meta.pageIndex + 1 })"
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

      <div
        v-else-if="props.activeTab === 'contents'"
        :id="panelId('contents')"
        role="tabpanel"
        :aria-labelledby="tabId('contents')"
        class="min-h-0 flex-1 overflow-y-auto p-2"
      >
        <div v-if="bookmarksLoading" class="flex h-32 items-center justify-center text-muted-foreground">
          <LoaderCircle :size="22" class="animate-spin" />
        </div>
        <p v-else-if="bookmarks.length === 0" class="px-3 py-8 text-center text-xs text-muted-foreground">
          {{ t('reader.pdf.sidebar.noOutline') }}
        </p>
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

      <div
        v-else-if="props.activeTab === 'search'"
        :id="panelId('search')"
        role="tabpanel"
        :aria-labelledby="tabId('search')"
        class="flex min-h-0 flex-1 flex-col"
      >
        <div class="shrink-0 border-b border-border p-3">
          <div class="relative">
            <Search :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              ref="searchInput"
              v-model="searchQuery"
              type="search"
              :placeholder="t('reader.pdf.sidebar.searchPlaceholder')"
              class="h-9 w-full rounded-md border border-border bg-background pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              @keydown="handleSearchKeydown"
            />
            <button
              v-if="searchQuery"
              class="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              :aria-label="t('reader.pdf.sidebar.clearSearch')"
              @click="handleClearSearch"
            >
              <X :size="14" />
            </button>
          </div>
          <div class="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <label class="flex items-center gap-1.5">
              <input type="checkbox" :checked="matchCase" class="accent-primary" @change="handleMatchCase" />
              {{ t('reader.pdf.sidebar.matchCase') }}
            </label>
            <label class="flex items-center gap-1.5">
              <input type="checkbox" :checked="wholeWord" class="accent-primary" @change="handleWholeWord" />
              {{ t('reader.pdf.sidebar.wholeWord') }}
            </label>
          </div>
          <div v-if="searchState.active && !searchState.loading" class="mt-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{{ t('reader.pdf.sidebar.resultPosition', { current: activeResultNumber, total: searchState.total }) }}</span>
            <div v-if="searchState.total > 1" class="flex items-center">
              <button class="viewer-btn !h-7 !w-7" :aria-label="t('reader.pdf.sidebar.previousResult')" @click="handlePreviousResult">
                <ChevronLeft :size="15" />
              </button>
              <button class="viewer-btn !h-7 !w-7" :aria-label="t('reader.pdf.sidebar.nextResult')" @click="handleNextResult">
                <ChevronRight :size="15" />
              </button>
            </div>
          </div>
        </div>

        <div v-if="searchPending || searchState.loading" class="flex flex-1 items-center justify-center text-muted-foreground">
          <div class="flex flex-col items-center gap-2" role="status" aria-live="polite">
            <LoaderCircle :size="22" class="animate-spin" />
            <span class="text-xs">{{
              t('reader.pdf.sidebar.searchingPage', { page: searchProgressPage || 1, total: scrollState.totalPages || 1 })
            }}</span>
          </div>
        </div>
        <RecycleScroller
          v-else-if="searchState.results.length > 0"
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
            <span class="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{{
              t('reader.pdf.sidebar.page', { page: item.pageIndex + 1 })
            }}</span>
            <span class="line-clamp-2 min-w-0 break-words">
              <template v-if="item.context.truncatedLeft">… </template>{{ item.context.before
              }}<mark class="rounded-sm bg-primary/20 px-0.5 text-foreground">{{ item.context.match }}</mark
              >{{ item.context.after }}<template v-if="item.context.truncatedRight"> …</template>
            </span>
          </button>
        </RecycleScroller>
        <div v-else class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Search :size="20" class="text-muted-foreground" aria-hidden="true" />
          <p class="text-xs text-muted-foreground">
            <template v-if="normalizedSearchQuery.length === 0">{{ t('reader.pdf.sidebar.searchPrompt') }}</template>
            <template v-else-if="normalizedSearchQuery.length === 1">{{ t('reader.pdf.sidebar.searchTooShort', { min: 2 }) }}</template>
            <template v-else>{{ t('reader.pdf.sidebar.noSearchResults') }}</template>
          </p>
        </div>
        <span class="sr-only" aria-live="polite">{{ t('reader.search.resultCount', { count: searchState.total }) }}</span>
      </div>

      <div v-else :id="panelId('highlights')" role="tabpanel" :aria-labelledby="tabId('highlights')" class="flex min-h-0 flex-1 flex-col">
        <div class="shrink-0 space-y-2 border-b border-border p-3">
          <div class="relative">
            <Search :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              v-model="highlightQuery"
              type="search"
              :placeholder="t('reader.sidebar.searchHighlights')"
              class="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>
          <div class="flex items-center gap-2">
            <select
              v-model="highlightColorFilter"
              class="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary"
            >
              <option value="all">{{ t('reader.sidebar.allColors') }}</option>
              <option v-for="option in highlightColorOptions" :key="option.hex" :value="option.hex">{{ option.label }}</option>
            </select>
            <label class="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <input v-model="highlightNotesOnly" type="checkbox" class="accent-primary" />
              {{ t('reader.sidebar.notesOnly') }}
            </label>
          </div>
        </div>

        <div v-if="props.loadError" class="px-4 py-8 text-center" role="alert" aria-live="assertive">
          <p class="text-xs text-destructive">{{ t('reader.pdf.annotationsLoadError') }}</p>
          <button class="mt-3 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" @click="handleRetryHighlights">
            {{ t('reader.retry') }}
          </button>
        </div>
        <div v-else-if="props.loading" class="flex flex-1 items-center justify-center text-muted-foreground" role="status" aria-live="polite">
          <LoaderCircle :size="22" class="animate-spin" />
          <span class="sr-only">{{ t('reader.pdf.loadingAnnotations') }}</span>
        </div>
        <p v-else-if="filteredHighlights.length === 0" class="px-4 py-8 text-center text-xs text-muted-foreground">
          {{ props.annotations.length === 0 ? t('reader.sidebar.noHighlights') : t('reader.sidebar.noHighlightsMatch') }}
        </p>
        <RecycleScroller
          v-else
          v-slot="{ item: annotation }"
          class="min-h-0 min-w-0 flex-1 overflow-x-hidden p-2"
          :items="filteredHighlights"
          :item-size="126"
          key-field="id"
        >
          <div
            class="group mb-1.5 h-[120px] overflow-hidden rounded-md border border-border bg-background p-2 text-left transition-colors hover:border-muted-foreground/50"
          >
            <button class="flex w-full min-w-0 gap-2 text-left" @click="handleNavigateHighlight(annotation)">
              <span class="mt-0.5 h-4 w-1.5 shrink-0 rounded-full" :style="{ background: annotation.color }" />
              <span class="min-w-0 flex-1">
                <span class="line-clamp-3 break-words text-xs text-foreground">{{ annotation.text }}</span>
                <span v-if="annotation.note" class="mt-1 flex items-start gap-1 text-[11px] text-muted-foreground">
                  <StickyNote :size="12" class="mt-0.5 shrink-0" />
                  <span class="line-clamp-2 break-words italic">{{ annotation.note }}</span>
                </span>
                <span v-if="highlightPageLabel(annotation) != null" class="mt-1 block text-[10px] uppercase tracking-wide text-muted-foreground">
                  {{ t('reader.pdf.sidebar.page', { page: highlightPageLabel(annotation) }) }}
                </span>
              </span>
            </button>
            <div class="mt-1 flex justify-end">
              <button
                class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-100 transition-opacity hover:text-destructive [@media(pointer:fine)]:opacity-0 [@media(pointer:fine)]:focus-visible:opacity-100 [@media(pointer:fine)]:group-hover:opacity-100"
                :aria-label="t('reader.sidebar.deleteHighlight')"
                @click="handleDeleteHighlight(annotation.id)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
        </RecycleScroller>
        <button
          v-if="props.hasMore && !props.loadError"
          class="m-2 shrink-0 rounded-md border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
          :disabled="props.loadingMore"
          @click="handleLoadMoreHighlights"
        >
          {{ props.loadingMore ? t('reader.pdf.loadingMoreAnnotations') : t('reader.pdf.loadMoreAnnotations') }}
        </button>
      </div>
    </aside>
  </div>
</template>
