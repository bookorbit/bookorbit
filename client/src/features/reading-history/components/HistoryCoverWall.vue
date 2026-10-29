<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import type { ReadingHistoryItem, ReadingHistoryMonth } from '@bookorbit/types'
import HistoryCoverTile from './HistoryCoverTile.vue'
import HistoryMonthHeader from './HistoryMonthHeader.vue'
import type { ReadingHistoryAnchor } from '../composables/useReadingHistoryList'
import { useShellVirtualizer } from '../composables/useShellVirtualizer'

const props = defineProps<{
  months: ReadingHistoryMonth[]
  itemAt: (index: number) => ReadingHistoryItem | null
  selectedId: number | null
}>()

const emit = defineEmits<{ range: [start: number, end: number]; select: [attemptId: number] }>()

const MIN_TILE = 104
const GAP_X = 14
const GAP_Y = 16
const HEADER_HEIGHT = 34
/** Title (two lines), the date line and their gaps, under the 2:3 cover. */
const TILE_TEXT = 58

const listEl = ref<HTMLElement | null>(null)
// Read on mount rather than through useElementSize, which reports 0 until its first resize
// callback: a switch that scrolls the wall as soon as it mounts needs the real column count.
const width = ref(0)
useResizeObserver(listEl, ([entry]) => {
  if (entry) width.value = entry.contentRect.width
})
onMounted(() => {
  width.value = listEl.value?.clientWidth ?? 0
})

const columns = computed(() => (width.value < 480 ? 3 : Math.max(3, Math.floor((width.value + GAP_X) / (MIN_TILE + GAP_X)))))
const tileWidth = computed(() => Math.max(1, (width.value - GAP_X * (columns.value - 1)) / columns.value))
const tileRowHeight = computed(() => Math.round(tileWidth.value * 1.5 + TILE_TEXT + GAP_Y))

type WallRow =
  { kind: 'month'; key: string; month: ReadingHistoryMonth } | { kind: 'tiles'; key: string; start: number; count: number; month: string }

/** Each month is a header and as many rows of covers as its reads fill at the current width. */
const rows = computed<WallRow[]>(() => {
  const out: WallRow[] = []
  let index = 0
  for (const month of props.months) {
    out.push({ kind: 'month', key: `m-${month.month}`, month })
    for (let offset = 0; offset < month.reads; offset += columns.value) {
      const count = Math.min(columns.value, month.reads - offset)
      out.push({ kind: 'tiles', key: `t-${month.month}-${offset}-${columns.value}`, start: index + offset, count, month: month.month })
    }
    index += month.reads
  }
  return out
})

const count = computed(() => rows.value.length)
const { virtualizer, items, totalSize, scrollMargin, listScrollTop, measureElement, scrollToIndex } = useShellVirtualizer({
  listEl,
  count,
  estimateSize: (index) => (rows.value[index]?.kind === 'month' ? HEADER_HEIGHT : tileRowHeight.value),
  getItemKey: (index) => rows.value[index]?.key ?? String(index),
  overscan: 3,
})

// Rows not yet on screen keep the estimate they got first, and the wall's first estimate is made
// before it has a width; re-estimate once it knows how tall a row of covers is.
watch(tileRowHeight, () => virtualizer.value.measure())

const entries = computed(() =>
  items.value.map((virtual) => {
    const row = rows.value[virtual.index]
    const tiles =
      row?.kind === 'tiles'
        ? Array.from({ length: row.count }, (_, offset) => ({ index: row.start + offset, item: props.itemAt(row.start + offset) }))
        : []
    return {
      key: String(virtual.key),
      index: virtual.index,
      start: virtual.start - scrollMargin.value,
      month: row?.kind === 'month' ? row.month : null,
      tiles,
    }
  }),
)

watch(
  items,
  (visible) => {
    let start = Number.POSITIVE_INFINITY
    let end = -1
    for (const virtual of visible) {
      const row = rows.value[virtual.index]
      if (row?.kind !== 'tiles') continue
      start = Math.min(start, row.start)
      end = Math.max(end, row.start + row.count - 1)
    }
    if (end >= 0) emit('range', start, end)
  },
  { immediate: true },
)

function scrollToMonth(month: string) {
  const index = rows.value.findIndex((row) => row.kind === 'month' && row.month.month === month)
  if (index !== -1) scrollToIndex(index)
}

/** The row at the top of the screen; null while the screen is still above the wall. */
function topAnchor(): ReadingHistoryAnchor | null {
  const top = listScrollTop.value
  if (top <= 0) return null
  const atTop = items.value.find((item) => item.end - scrollMargin.value > top + 1)
  const row = atTop ? rows.value[atTop.index] : undefined
  if (!row) return null
  return row.kind === 'month' ? { kind: 'month', month: row.month.month } : { kind: 'read', index: row.start }
}

/** Puts the row of covers holding a read at the top; a month's first row shows its header too. */
function scrollToAnchor(anchor: ReadingHistoryAnchor) {
  if (anchor.kind === 'month') return scrollToMonth(anchor.month)
  const index = rows.value.findIndex((row) => row.kind === 'tiles' && anchor.index >= row.start && anchor.index < row.start + row.count)
  if (index === -1) return
  scrollToIndex(rows.value[index - 1]?.kind === 'month' ? index - 1 : index)
}

function handleSelect(attemptId: number) {
  emit('select', attemptId)
}

defineExpose({ scrollToMonth, topAnchor, scrollToAnchor })
</script>

<template>
  <div ref="listEl" class="relative" :style="{ height: `${totalSize}px` }">
    <div
      v-for="entry in entries"
      :key="entry.key"
      :ref="measureElement"
      :data-index="entry.index"
      class="absolute inset-x-0 top-0"
      :style="{ transform: `translateY(${entry.start}px)` }"
    >
      <HistoryMonthHeader v-if="entry.month" :month="entry.month" />
      <div v-else class="grid pb-4" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: `${GAP_X}px` }">
        <template v-for="tile in entry.tiles" :key="tile.index">
          <HistoryCoverTile v-if="tile.item" :item="tile.item" :selected="selectedId === tile.item.id" @select="handleSelect" />
          <span v-else data-history-placeholder class="flex flex-col gap-1.5" aria-hidden="true">
            <span class="block aspect-[2/3] w-full rounded-md bg-muted" />
            <span class="h-3 w-3/4 rounded-xs bg-muted" />
            <span class="h-2.5 w-1/3 rounded-xs bg-muted" />
          </span>
        </template>
      </div>
    </div>
  </div>
</template>
