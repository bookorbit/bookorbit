<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useElementSize, useWindowSize } from '@vueuse/core'
import { RecycleScroller } from 'vue-virtual-scroller'
import type { BookCard } from '@bookorbit/types'
import BookCoverCard from './BookCoverCard.vue'
import CollapsedSeriesCard from './CollapsedSeriesCard.vue'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../lib/cover-aspect-ratio'
import { useDisplaySettings } from '@/composables/useDisplaySettings'

type BookActionType = 'quick-view' | 'add-to-collection' | 'delete'

const props = withDefaults(
  defineProps<{
    books: BookCard[]
    coverSize: number
    gridGap: number
    selectionMode?: boolean
    isSelected?: (bookId: number) => boolean
    newBookIds?: Set<number>
    virtualized?: boolean
  }>(),
  {
    selectionMode: false,
    isSelected: undefined,
    newBookIds: () => new Set<number>(),
    virtualized: true,
  },
)

const emit = defineEmits<{
  action: [book: BookCard, action: BookActionType]
  select: [bookId: number, event: MouseEvent]
  'update:book': [updated: BookCard]
}>()

const containerRef = ref<HTMLElement | null>(null)
const { width: containerWidth } = useElementSize(containerRef)
const { width: windowWidth } = useWindowSize()

function asPositiveInt(value: unknown, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.round(n)
}

const coverPx = computed(() => asPositiveInt(props.coverSize, 140))
const gapPx = computed(() => asPositiveInt(props.gridGap, 20))

const availableWidth = computed(() => {
  const observed = Number(containerWidth.value)
  if (Number.isFinite(observed) && observed > 0) return Math.round(observed)

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
</script>

<template>
  <div ref="containerRef" class="w-full">
    <div v-if="!virtualized" class="grid w-full max-w-full items-start" :style="staticGridStyle" data-testid="book-grid-static">
      <div v-for="book in books" :key="book.id" class="min-w-0" :class="{ 'book-grid-cell--new': props.newBookIds.has(book.id) }">
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
      :items="books"
      key-field="id"
      page-mode
      :item-size="itemSize"
      :grid-items="gridItems"
      :item-secondary-size="itemSecondarySize"
      :buffer="buffer"
      :style="scrollerStyle"
      class="book-grid-scroller"
    >
      <template #default="{ item: book }">
        <div class="book-grid-cell" :class="{ 'book-grid-cell--new': props.newBookIds.has(book.id) }">
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
  overflow-x: hidden;
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
