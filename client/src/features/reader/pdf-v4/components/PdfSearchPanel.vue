<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, LoaderCircle, Search, X } from '@lucide/vue'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import { useSearch, useSearchHits, useSearchState } from '@embedpdf/vue/search'

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 250

const props = defineProps<{
  active: boolean
}>()

const { t } = useI18n()

const search = useSearch()
const { query: searchQuery, status, hitCount, activeHitIndex, progress } = useSearchState()
const hits = useSearchHits()

const query = ref(searchQuery.value?.text ?? '')
const matchCase = ref(searchQuery.value?.matchCase ?? false)
const wholeWord = ref(searchQuery.value?.wholeWord ?? false)
const pending = ref(false)
const input = ref<HTMLInputElement | null>(null)

const normalizedQuery = computed(() => query.value.trim())
const searching = computed(() => pending.value || status.value === 'searching')
const activeResultNumber = computed(() => (activeHitIndex.value >= 0 ? activeHitIndex.value + 1 : 0))
const progressTotal = computed(() => Math.max(progress.value.pageCount, 1))
const progressPage = computed(() => Math.min(progress.value.pagesSearched + 1, progressTotal.value))

/** Repeating the page label only when it changes gives grouped results without breaking virtualization. */
const rows = computed(() =>
  hits.value.map((hit, index) => ({
    id: index,
    hit,
    startsPage: index === 0 || hits.value[index - 1]?.pageIndex !== hit.pageIndex,
  })),
)

// Every search call throws while no document is open, and a search the engine refuses rejects.
function run(action: () => unknown) {
  try {
    const result = action()
    if (result instanceof Promise) result.catch(() => undefined)
  } catch {
    return
  }
}

function goToHit(index: number) {
  run(() => search.goToHit(index))
}

function handleResult(index: number) {
  goToHit(index)
}

function handlePreviousResult() {
  const total = hitCount.value
  if (total <= 0) return
  const current = activeHitIndex.value
  goToHit(current <= 0 ? total - 1 : current - 1)
}

function handleNextResult() {
  const total = hitCount.value
  if (total <= 0) return
  const current = activeHitIndex.value
  goToHit(current < 0 || current >= total - 1 ? 0 : current + 1)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  if (event.shiftKey) handlePreviousResult()
  else handleNextResult()
}

function handleClear() {
  query.value = ''
  run(() => search.clear())
  void nextTick(() => input.value?.focus())
}

function toggleMatchCase() {
  matchCase.value = !matchCase.value
}

function toggleWholeWord() {
  wholeWord.value = !wholeWord.value
}

watch(
  [query, matchCase, wholeWord, () => props.active],
  ([nextQuery, nextMatchCase, nextWholeWord, active], _previous, onCleanup) => {
    const text = nextQuery.trim()
    pending.value = false
    run(() => search.clear())
    if (!active || text.length < MIN_QUERY_LENGTH) return

    pending.value = true
    const timer = window.setTimeout(() => {
      pending.value = false
      run(() => search.search({ text, matchCase: nextMatchCase, wholeWord: nextWholeWord }))
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

onUnmounted(() => run(() => search.clear()))
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
          class="absolute end-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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

      <div v-if="status === 'complete'" class="flex items-center justify-between text-xs text-muted-foreground">
        <span>{{ t('reader.pdf.sidebar.resultPosition', { current: activeResultNumber, total: hitCount }) }}</span>
        <div v-if="hitCount > 1" class="flex items-center">
          <button type="button" class="viewer-btn !size-7" :aria-label="t('reader.pdf.sidebar.previousResult')" @click="handlePreviousResult">
            <ChevronLeft :size="15" />
          </button>
          <button type="button" class="viewer-btn !size-7" :aria-label="t('reader.pdf.sidebar.nextResult')" @click="handleNextResult">
            <ChevronRight :size="15" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="searching" class="flex flex-1 items-center justify-center text-muted-foreground">
      <div class="flex flex-col items-center gap-2" role="status" aria-live="polite">
        <LoaderCircle :size="22" class="animate-spin" />
        <span class="text-xs">
          {{ t('reader.pdf.sidebar.searchingPage', { page: progressPage, total: progressTotal }) }}
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
      <DynamicScrollerItem :item="item" :active="itemActive" :data-index="index" :size-dependencies="[item.hit.snippet?.match]">
        <p v-if="item.startsPage" class="px-1 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground first:pt-0">
          {{ t('reader.pdf.sidebar.page', { page: item.hit.pageIndex + 1 }) }}
        </p>
        <button
          type="button"
          class="mb-1 block w-full min-w-0 rounded-md border px-2.5 py-2 text-start text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          :class="
            index === activeHitIndex
              ? 'border-primary/45 bg-primary/10 text-foreground'
              : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          :aria-current="index === activeHitIndex ? 'true' : undefined"
          @click="handleResult(index)"
        >
          <span v-if="item.hit.snippet" class="line-clamp-3 min-w-0 break-words leading-relaxed">
            {{ item.hit.snippet.before }}<mark class="rounded-sm bg-primary/25 px-0.5 text-foreground">{{ item.hit.snippet.match }}</mark
            >{{ item.hit.snippet.after }}
          </span>
          <span v-else class="min-w-0 break-words">{{ t('reader.pdf.sidebar.page', { page: item.hit.pageIndex + 1 }) }}</span>
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
    <span class="sr-only" aria-live="polite">{{ t('reader.search.resultCount', { count: hitCount }) }}</span>
  </div>
</template>

<style>
@import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
</style>
