<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, LoaderCircle, Search, X } from '@lucide/vue'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import { MatchFlag } from '@embedpdf/models'
import { useScroll } from '@embedpdf/plugin-scroll/vue'
import { useSearch } from '@embedpdf/plugin-search/vue'

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 250

const props = defineProps<{
  documentId: string
  active: boolean
}>()

const { t } = useI18n()

const { state: scrollState, provides: scroll } = useScroll(() => props.documentId)
const { state: searchState, provides: search } = useSearch(() => props.documentId)

const query = ref(searchState.value.query ?? '')
const pending = ref(false)
const progressPage = ref(0)
const input = ref<HTMLInputElement | null>(null)

const normalizedQuery = computed(() => query.value.trim())
const matchCase = computed(() => searchState.value.flags.includes(MatchFlag.MatchCase))
const wholeWord = computed(() => searchState.value.flags.includes(MatchFlag.MatchWholeWord))
const activeResultNumber = computed(() => (searchState.value.activeResultIndex >= 0 ? searchState.value.activeResultIndex + 1 : 0))

/** Repeating the page label only when it changes gives grouped results without breaking virtualization. */
const rows = computed(() =>
  searchState.value.results.map((result, index) => ({
    id: index,
    result,
    startsPage: index === 0 || searchState.value.results[index - 1]?.pageIndex !== result.pageIndex,
  })),
)

function scrollToResult(index: number) {
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
  scroll.value?.scrollToPage({ pageNumber: result.pageIndex + 1, pageCoordinates: coordinates, alignX: 50, alignY: 30 })
}

function handleResult(index: number) {
  search.value?.goToResult(index)
  scrollToResult(index)
}

function handlePreviousResult() {
  const total = searchState.value.total
  if (total <= 0) return
  const current = searchState.value.activeResultIndex
  const index = current <= 0 ? total - 1 : current - 1
  search.value?.goToResult(index)
  scrollToResult(index)
}

function handleNextResult() {
  const total = searchState.value.total
  if (total <= 0) return
  const current = searchState.value.activeResultIndex
  const index = current >= total - 1 ? 0 : current + 1
  search.value?.goToResult(index)
  scrollToResult(index)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (event.shiftKey) handlePreviousResult()
  else handleNextResult()
}

function handleClear() {
  query.value = ''
  progressPage.value = 0
  search.value?.stopSearch()
  void nextTick(() => input.value?.focus())
}

function updateFlag(flag: MatchFlag, enabled: boolean) {
  const flags = new Set(searchState.value.flags)
  if (enabled) flags.add(flag)
  else flags.delete(flag)
  search.value?.setFlags([...flags])
}

function toggleMatchCase() {
  updateFlag(MatchFlag.MatchCase, !matchCase.value)
}

function toggleWholeWord() {
  updateFlag(MatchFlag.MatchWholeWord, !wholeWord.value)
}

watch(
  [query, () => props.active],
  ([nextQuery, active], _previous, onCleanup) => {
    const normalized = nextQuery.trim()
    pending.value = false
    progressPage.value = 0
    search.value?.stopSearch()
    if (!active || normalized.length < MIN_QUERY_LENGTH) return

    pending.value = true
    const timer = window.setTimeout(() => {
      pending.value = false
      const task = search.value?.searchAllPages(normalized)
      task?.onProgress((progress) => {
        progressPage.value = progress.page + 1
      })
    }, DEBOUNCE_MS)
    onCleanup(() => window.clearTimeout(timer))
  },
  { flush: 'post', immediate: true },
)

watch(
  () => props.active,
  (active) => {
    if (active) void nextTick(() => input.value?.focus())
  },
  { immediate: true },
)

onUnmounted(() => search.value?.stopSearch())
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="shrink-0 space-y-2 border-b border-border p-3">
      <div class="relative">
        <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref="input"
          v-model="query"
          type="search"
          :placeholder="t('reader.pdf.sidebar.searchPlaceholder')"
          :aria-label="t('reader.pdf.sidebar.searchPlaceholder')"
          class="h-9 w-full rounded-md border border-border bg-background ps-9 pe-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
          @keydown="handleKeydown"
        />
        <button
          v-if="query"
          type="button"
          class="absolute end-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :aria-label="t('reader.pdf.sidebar.clearSearch')"
          @click="handleClear"
        >
          <X :size="14" />
        </button>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <button
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="
            matchCase ? 'border-primary/45 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          :aria-pressed="matchCase"
          @click="toggleMatchCase"
        >
          {{ t('reader.pdf.sidebar.matchCase') }}
        </button>
        <button
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="
            wholeWord ? 'border-primary/45 bg-primary/15 text-primary' : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          :aria-pressed="wholeWord"
          @click="toggleWholeWord"
        >
          {{ t('reader.pdf.sidebar.wholeWord') }}
        </button>
      </div>

      <div v-if="searchState.active && !searchState.loading" class="flex items-center justify-between text-xs text-muted-foreground">
        <span>{{ t('reader.pdf.sidebar.resultPosition', { current: activeResultNumber, total: searchState.total }) }}</span>
        <div v-if="searchState.total > 1" class="flex items-center">
          <button type="button" class="viewer-btn !size-7" :aria-label="t('reader.pdf.sidebar.previousResult')" @click="handlePreviousResult">
            <ChevronLeft :size="15" />
          </button>
          <button type="button" class="viewer-btn !size-7" :aria-label="t('reader.pdf.sidebar.nextResult')" @click="handleNextResult">
            <ChevronRight :size="15" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="pending || searchState.loading" class="flex flex-1 items-center justify-center text-muted-foreground">
      <div class="flex flex-col items-center gap-2" role="status" aria-live="polite">
        <LoaderCircle :size="22" class="animate-spin" />
        <span class="text-xs">
          {{ t('reader.pdf.sidebar.searchingPage', { page: progressPage || 1, total: scrollState.totalPages || 1 }) }}
        </span>
      </div>
    </div>
    <DynamicScroller
      v-else-if="rows.length > 0"
      v-slot="{ item, index, active: itemActive }"
      class="min-h-0 min-w-0 flex-1 overflow-x-hidden p-2"
      :items="rows"
      :min-item-size="58"
      key-field="id"
      data-testid="search-results"
    >
      <DynamicScrollerItem :item="item" :active="itemActive" :data-index="index" :size-dependencies="[item.result.context.match]">
        <p v-if="item.startsPage" class="px-1 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground first:pt-0">
          {{ t('reader.pdf.sidebar.page', { page: item.result.pageIndex + 1 }) }}
        </p>
        <button
          type="button"
          class="mb-1 block w-full min-w-0 rounded-md border px-2.5 py-2 text-start text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="
            index === searchState.activeResultIndex
              ? 'border-primary/45 bg-primary/10 text-foreground'
              : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          :aria-current="index === searchState.activeResultIndex ? 'true' : undefined"
          @click="handleResult(index)"
        >
          <span class="line-clamp-3 min-w-0 break-words leading-relaxed">
            <template v-if="item.result.context.truncatedLeft">… </template>{{ item.result.context.before
            }}<mark class="rounded-sm bg-primary/25 px-0.5 text-foreground">{{ item.result.context.match }}</mark
            >{{ item.result.context.after }}<template v-if="item.result.context.truncatedRight"> …</template>
          </span>
        </button>
      </DynamicScrollerItem>
    </DynamicScroller>
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <Search :size="20" class="text-muted-foreground" aria-hidden="true" />
      <p class="text-xs text-muted-foreground">
        <template v-if="normalizedQuery.length === 0">{{ t('reader.pdf.sidebar.searchPrompt') }}</template>
        <template v-else-if="normalizedQuery.length < MIN_QUERY_LENGTH">
          {{ t('reader.pdf.sidebar.searchTooShort', { min: MIN_QUERY_LENGTH }) }}
        </template>
        <template v-else>{{ t('reader.pdf.sidebar.noSearchResults') }}</template>
      </p>
    </div>
    <span class="sr-only" aria-live="polite">{{ t('reader.search.resultCount', { count: searchState.total }) }}</span>
  </div>
</template>

<style>
@import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
</style>
