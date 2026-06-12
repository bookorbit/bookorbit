<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useElementSize, useWindowSize, watchDebounced } from '@vueuse/core'
import { RecycleScroller } from 'vue-virtual-scroller'
import { isAudioFormat, type BookCard, type CoverAspectRatio } from '@bookorbit/types'
import BookCoverCard from './BookCoverCard.vue'
import BookCoverSkeleton from './BookCoverSkeleton.vue'
import CollapsedSeriesCard from './CollapsedSeriesCard.vue'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../lib/cover-aspect-ratio'
import { isBookPlaceholder, type BookSlot } from '../composables/useBookWindow'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

type BookActionType = 'quick-view' | 'add-to-collection' | 'delete'

const props = withDefaults(
  defineProps<{
    books: BookSlot[]
    coverSize: number
    gridGap: number
    selectionMode?: boolean
    isSelected?: (bookId: number) => boolean
    newBookIds?: Set<number>
    virtualized?: boolean
    audioCoverScale?: number
    railGutter?: boolean
  }>(),
  {
    selectionMode: false,
    isSelected: undefined,
    newBookIds: () => new Set<number>(),
    virtualized: true,
    audioCoverScale: 1,
    railGutter: false,
  },
)

const emit = defineEmits<{
  action: [book: BookCard, action: BookActionType]
  select: [bookId: number, event: MouseEvent]
  'update:book': [updated: BookCard]
  range: [startIndex: number, endIndex: number]
  'first-visible-index': [index: number]
}>()

const containerRef = ref<HTMLElement | null>(null)
const scrollerRef = ref<{ scrollToItem: (index: number) => void } | null>(null)
const { width: containerWidth } = useElementSize(containerRef)
const { width: windowWidth } = useWindowSize()

function asPositiveInt(value: unknown, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.round(n)
}

function normalizeScale(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 1) return 1
  return n
}

// During a window drag the measured width changes every frame; relayout only
// after it settles so the virtual pool is not reshuffled continuously. The
// first measurement applies immediately to avoid a blank mount.
const settledWidth = ref(0)
watch(
  containerWidth,
  (width) => {
    const rounded = Math.round(Number(width))
    if (!Number.isFinite(rounded) || rounded <= 0) return
    if (settledWidth.value === 0) settledWidth.value = rounded
  },
  { immediate: true },
)
watchDebounced(
  containerWidth,
  (width) => {
    const rounded = Math.round(Number(width))
    if (!Number.isFinite(rounded) || rounded <= 0) return
    settledWidth.value = rounded
  },
  { debounce: 120 },
)

const coverPx = computed(() => asPositiveInt(props.coverSize, 140))
const gapPx = computed(() => asPositiveInt(props.gridGap, 20))
const audioCoverScale = computed(() => normalizeScale(props.audioCoverScale))

const availableWidth = computed(() => {
  if (settledWidth.value > 0) return settledWidth.value

  const direct = Number(containerRef.value?.getBoundingClientRect().width ?? 0)
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct)

  const parent = Number(containerRef.value?.parentElement?.getBoundingClientRect().width ?? 0)
  if (Number.isFinite(parent) && parent > 0) return Math.round(parent)

  const viewport = Number(windowWidth.value)
  if (Number.isFinite(viewport) && viewport > 0) return Math.round(Math.max(viewport - 48, 0))

  return coverPx.value + gapPx.value
})

const targetCellSize = computed(() => coverPx.value + gapPx.value)
const gridItems = computed(() => {
  const cols = Math.floor((availableWidth.value + gapPx.value) / targetCellSize.value)
  return Number.isFinite(cols) && cols > 0 ? cols : 1
})
const itemSecondarySize = computed(() => {
  return Math.max(1, Math.floor((availableWidth.value + gapPx.value) / gridItems.value))
})
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
const aspectMultiplier = computed(() => (coverAspectRatio.value === '1/1' ? 1 : 3 / 2))

const cardWidth = computed(() => Math.max(1, itemSecondarySize.value - gapPx.value))
const cardHeight = computed(() => Math.max(1, Math.round(cardWidth.value * aspectMultiplier.value)))

const { gridCardSecondaryLabel, cardInfoMode } = useDisplaySettings()
const labelAreaHeight = computed(() => {
  if (cardInfoMode.value !== 'below-cover') return 0
  const hasSecondary = gridCardSecondaryLabel.value !== 'hidden'
  return hasSecondary ? 40 : 24
})
const showLabel = computed(() => cardInfoMode.value === 'below-cover')

const itemSize = computed(() => cardHeight.value + labelAreaHeight.value + gapPx.value)
const buffer = computed(() => Math.max(itemSize.value * 2, 240))

const scrollerStyle = computed(() => ({
  '--book-grid-gap': `${gapPx.value}px`,
  '--book-grid-height': `${cardHeight.value}px`,
  '--book-grid-label-height': `${labelAreaHeight.value}px`,
}))

const staticGridStyle = computed(() => ({
  gap: `${gapPx.value}px`,
  gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${coverPx.value}px), 1fr))`,
}))

const staticVariableWrapStyle = computed(() => ({
  gap: `${gapPx.value}px`,
}))

const useVariableStaticWidths = computed(() => !props.virtualized && audioCoverScale.value > 1)

const staticBooks = computed(() => props.books.filter((slot): slot is BookCard => !isBookPlaceholder(slot)))

function asBook(slot: BookSlot): BookCard {
  return slot as BookCard
}

function isAudiobook(book: BookCard): boolean {
  return book.files.some((file) => (file.format ? isAudioFormat(file.format) : false))
}

function staticItemStyle(book: BookCard): { width: string; maxWidth: string } {
  const scale = isAudiobook(book) ? audioCoverScale.value : 1
  const width = Math.max(1, Math.round(coverPx.value * scale))
  return { width: `${width}px`, maxWidth: '100%' }
}

function staticCoverAspectRatio(book: BookCard): CoverAspectRatio {
  if (isAudiobook(book)) return '1/1'
  return coverAspectRatio.value
}

function handleScrollerUpdate(startIndex: number, endIndex: number) {
  emit('range', startIndex, endIndex)
}

// First visible index from scroll geometry: O(1), no per-cell DOM reads, and
// independent of RecycleScroller's buffer-inflated visibleStartIndex.
const firstVisibleIndex = ref(0)
let scrollParent: HTMLElement | null = null
let scrollRafId = 0

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const overflowY = getComputedStyle(node).overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

function computeFirstVisibleIndex() {
  const gridEl = containerRef.value
  if (!scrollParent || !gridEl || props.books.length === 0 || itemSize.value <= 0) return
  const parentRect = scrollParent.getBoundingClientRect()
  const gridRect = gridEl.getBoundingClientRect()
  const scrolledIntoGrid = parentRect.top - gridRect.top
  const row = Math.max(0, Math.floor(scrolledIntoGrid / itemSize.value))
  const cols = gridItems.value
  const rowStart = Math.min(props.books.length - 1, row * cols)
  if (rowStart === firstVisibleIndex.value) return
  firstVisibleIndex.value = rowStart
  // Report the middle cell of the first visible row, not its first cell. A
  // letter bucket usually starts mid-row, so reporting the row start would
  // resolve the active bucket to the previous letter (the tail still showing
  // in the top-left). The midpoint lands inside the dominant letter of the
  // row, which is also the one a jump targets.
  const activeIndex = Math.min(props.books.length - 1, rowStart + Math.floor((cols - 1) / 2))
  emit('first-visible-index', activeIndex)
}

function handleScrollParentScroll() {
  if (scrollRafId) return
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = 0
    computeFirstVisibleIndex()
  })
}

onMounted(() => {
  if (!props.virtualized) return
  void nextTick(() => {
    scrollParent = findScrollParent(containerRef.value)
    scrollParent?.addEventListener('scroll', handleScrollParentScroll, { passive: true })
  })
})

onBeforeUnmount(() => {
  scrollParent?.removeEventListener('scroll', handleScrollParentScroll)
  scrollParent = null
  if (scrollRafId) cancelAnimationFrame(scrollRafId)
})

// Re-anchor on column-count changes so a relayout keeps the same books in
// view. firstVisibleIndex still holds the pre-relayout value here because it
// only updates from scroll events.
watch(gridItems, (next, prev) => {
  if (!props.virtualized || !prev || next === prev) return
  const anchor = firstVisibleIndex.value
  if (anchor <= 0) return
  void nextTick(() => {
    scrollerRef.value?.scrollToItem(anchor)
  })
})

function scrollToIndex(index: number) {
  scrollerRef.value?.scrollToItem(index)
  handleScrollParentScroll()
}

defineExpose({ scrollToIndex })
</script>

<template>
  <div ref="containerRef" class="w-full" :class="{ 'pr-9': railGutter }">
    <div
      v-if="!virtualized && useVariableStaticWidths"
      class="flex w-full flex-wrap content-start items-end"
      :style="staticVariableWrapStyle"
      data-testid="book-grid-static"
    >
      <div
        v-for="book in staticBooks"
        :key="book.id"
        class="min-w-0 shrink-0"
        :class="{ 'book-grid-cell--new': props.newBookIds.has(book.id) }"
        :style="staticItemStyle(book)"
      >
        <CollapsedSeriesCard v-if="book.collapsedSeries" :book="book" :show-label="showLabel" />
        <BookCoverCard
          v-else
          :book="book"
          :show-label="showLabel"
          :cover-aspect-ratio="staticCoverAspectRatio(book)"
          :selection-mode="selectionMode"
          :selected="isSelected?.(book.id) ?? false"
          @action="emit('action', book, $event)"
          @select="emit('select', book.id, $event)"
          @update:book="emit('update:book', $event)"
        />
      </div>
    </div>

    <div v-else-if="!virtualized" class="grid w-full max-w-full items-start" :style="staticGridStyle" data-testid="book-grid-static">
      <div v-for="book in staticBooks" :key="book.id" class="min-w-0" :class="{ 'book-grid-cell--new': props.newBookIds.has(book.id) }">
        <CollapsedSeriesCard v-if="book.collapsedSeries" :book="book" :show-label="showLabel" />
        <BookCoverCard
          v-else
          :book="book"
          :show-label="showLabel"
          :selection-mode="selectionMode"
          :selected="isSelected?.(book.id) ?? false"
          @action="emit('action', book, $event)"
          @select="emit('select', book.id, $event)"
          @update:book="emit('update:book', $event)"
        />
      </div>
    </div>

    <RecycleScroller
      v-else
      ref="scrollerRef"
      :items="books"
      key-field="id"
      page-mode
      emit-update
      :item-size="itemSize"
      :grid-items="gridItems"
      :item-secondary-size="itemSecondarySize"
      :buffer="buffer"
      :style="scrollerStyle"
      class="book-grid-scroller"
      @update="handleScrollerUpdate"
    >
      <template #default="{ item }">
        <div class="book-grid-cell" :class="{ 'book-grid-cell--new': props.newBookIds.has(item.id) }">
          <BookCoverSkeleton v-if="isBookPlaceholder(item)" />
          <CollapsedSeriesCard v-else-if="asBook(item).collapsedSeries" :book="asBook(item)" :show-label="showLabel" />
          <BookCoverCard
            v-else
            :book="asBook(item)"
            :show-label="showLabel"
            :selection-mode="selectionMode"
            :selected="isSelected?.(item.id) ?? false"
            @action="emit('action', asBook(item), $event)"
            @select="emit('select', item.id, $event)"
            @update:book="emit('update:book', $event)"
          />
        </div>
      </template>
    </RecycleScroller>
  </div>
</template>

<style>
@import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
</style>

<style scoped>
.book-grid-scroller {
  width: 100%;
  max-width: 100%;
  /* clip, not hidden: hidden still creates a scrollable box, so focusing a
     rail button could scroll the row sideways and crop the first column. */
  overflow-x: clip;
  overscroll-behavior-x: none;
}

@media (pointer: coarse) {
  .book-grid-scroller {
    touch-action: pan-y;
  }
}

.book-grid-cell {
  height: calc(var(--book-grid-height) + var(--book-grid-label-height, 0px));
  box-sizing: border-box;
  padding-left: 0;
  padding-right: var(--book-grid-gap);
  padding-bottom: var(--book-grid-gap);
}

.book-grid-cell--new {
  animation: book-enter 0.25s ease-out both;
}

@keyframes book-enter {
  from {
    transform: translateY(4px) scale(0.98);
  }
  to {
    transform: translateY(0) scale(1);
  }
}
</style>
