<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ReadingHistoryItem, ReadingHistoryMarks } from '@bookorbit/types'
import HistoryMonthHeader from './HistoryMonthHeader.vue'
import HistoryReadRow from './HistoryReadRow.vue'
import type { ReadingHistoryAnchor, ReadingHistoryRow } from '../composables/useReadingHistoryList'
import { useShellVirtualizer } from '../composables/useShellVirtualizer'

type MarksState = { status: 'loading' } | { status: 'ready'; marks: ReadingHistoryMarks } | { status: 'error' } | undefined

const props = defineProps<{
  rows: ReadingHistoryRow[]
  itemAt: (index: number) => ReadingHistoryItem | null
  openId: number | null
  marksFor: (attemptId: number) => MarksState
  ratingBusyId: number | null
}>()

const emit = defineEmits<{
  range: [start: number, end: number]
  toggle: [attemptId: number]
  loadMarks: [attemptId: number]
  rate: [attemptId: number, rating: number | null]
}>()

const HEADER_HEIGHT = 34
const ROW_HEIGHT = 92

const listEl = ref<HTMLElement | null>(null)
const count = computed(() => props.rows.length)

const { items, totalSize, scrollMargin, listScrollTop, measureElement, scrollToIndex } = useShellVirtualizer({
  listEl,
  count,
  estimateSize: (index) => (props.rows[index]?.kind === 'month' ? HEADER_HEIGHT : ROW_HEIGHT),
  getItemKey: (index) => props.rows[index]?.key ?? String(index),
  overscan: 8,
  // Jumps land below the pinned month header rather than under it.
  scrollPaddingStart: HEADER_HEIGHT,
})

type Entry = { key: string; index: number; start: number; month: (ReadingHistoryRow & { kind: 'month' }) | null; item: ReadingHistoryItem | null }

/** What each virtual row draws: a month header, a loaded read, or a placeholder until its page arrives. */
const entries = computed<Entry[]>(() =>
  items.value.map((virtual) => {
    const row = props.rows[virtual.index]
    return {
      key: String(virtual.key),
      index: virtual.index,
      start: virtual.start - scrollMargin.value,
      month: row?.kind === 'month' ? row : null,
      item: row?.kind === 'read' ? props.itemAt(row.index) : null,
    }
  }),
)

/**
 * The month of the row at the top of the viewport, pinned above its reads. The next month's
 * header pushes it up as it arrives, so the two never overlap; nothing is pinned while the row
 * at the top is a month header itself.
 */
const pinned = computed(() => {
  const top = listScrollTop.value
  if (top <= 0) return null
  const atTopIndex = items.value.findIndex((item) => item.end - scrollMargin.value > top + 1)
  const atTop = items.value[atTopIndex]
  const row = atTop ? props.rows[atTop.index] : undefined
  if (!row || row.kind === 'month') return null
  const month = monthRowFor(row.month)
  if (!month) return null
  const next = items.value.slice(atTopIndex + 1).find((item) => props.rows[item.index]?.kind === 'month')
  const gap = next ? next.start - scrollMargin.value - top : Number.POSITIVE_INFINITY
  return { month, offset: Math.min(0, gap - HEADER_HEIGHT) }
})

const monthIndex = computed(() => {
  const map = new Map<string, number>()
  props.rows.forEach((row, index) => {
    if (row.kind === 'month') map.set(row.month.month, index)
  })
  return map
})

function monthRowFor(month: string) {
  const index = monthIndex.value.get(month)
  const row = index === undefined ? undefined : props.rows[index]
  return row?.kind === 'month' ? row : null
}

watch(
  items,
  (visible) => {
    let start = Number.POSITIVE_INFINITY
    let end = -1
    for (const item of visible) {
      const row = props.rows[item.index]
      if (row?.kind !== 'read') continue
      start = Math.min(start, row.index)
      end = Math.max(end, row.index)
    }
    if (end >= 0) emit('range', start, end)
  },
  { immediate: true },
)

/** Jumps to a month's first read: its header, a row above, lands exactly where the pinned header sits. */
function scrollToMonth(month: string) {
  const index = monthIndex.value.get(month)
  if (index !== undefined) scrollToIndex(index + 1)
}

/** The row at the top of the screen, below the pinned month; null while the screen is still above the list. */
function topAnchor(): ReadingHistoryAnchor | null {
  const top = listScrollTop.value
  if (top <= 0) return null
  const atTop = items.value.find((item) => item.end - scrollMargin.value > top + HEADER_HEIGHT)
  const row = atTop ? props.rows[atTop.index] : undefined
  if (!row) return null
  return row.kind === 'month' ? { kind: 'month', month: row.month.month } : { kind: 'read', index: row.index }
}

function scrollToAnchor(anchor: ReadingHistoryAnchor) {
  if (anchor.kind === 'month') return scrollToMonth(anchor.month)
  const index = props.rows.findIndex((row) => row.kind === 'read' && row.index === anchor.index)
  if (index !== -1) scrollToIndex(index)
}

function handleToggle(attemptId: number) {
  emit('toggle', attemptId)
}

function handleLoadMarks(attemptId: number) {
  emit('loadMarks', attemptId)
}

function handleRate(attemptId: number, rating: number | null) {
  emit('rate', attemptId, rating)
}

defineExpose({ scrollToMonth, topAnchor, scrollToAnchor })
</script>

<template>
  <div ref="listEl" class="relative" data-history-list>
    <div v-if="pinned" class="sticky top-0 z-[3] -mb-[34px] h-[34px] overflow-hidden">
      <HistoryMonthHeader :month="pinned.month.month" class="h-[34px]" :style="{ transform: `translateY(${pinned.offset}px)` }" />
    </div>
    <div class="relative" :style="{ height: `${totalSize}px` }">
      <div
        v-for="entry in entries"
        :key="entry.key"
        :ref="measureElement"
        :data-index="entry.index"
        class="absolute inset-x-0 top-0"
        :style="{ transform: `translateY(${entry.start}px)` }"
      >
        <!-- Exactly HEADER_HEIGHT, so a jump's padding puts a month's first read right under its pinned header. -->
        <HistoryMonthHeader v-if="entry.month" :month="entry.month.month" class="h-[34px]" />
        <HistoryReadRow
          v-else-if="entry.item"
          :item="entry.item"
          :open="openId === entry.item.id"
          :marks="marksFor(entry.item.id)"
          :rating-busy="ratingBusyId === entry.item.id"
          class="border-t border-border/50"
          @toggle="handleToggle"
          @load-marks="handleLoadMarks"
          @rate="handleRate"
        />
        <div
          v-else
          data-history-placeholder
          class="grid h-[92px] grid-cols-[40px_minmax(0,1fr)] items-start gap-x-3 border-t border-border/50 px-1.5 py-3 md:grid-cols-[3.75rem_44px_minmax(0,1fr)_13rem] md:gap-x-3.5 md:px-2"
          aria-hidden="true"
        >
          <span class="hidden h-3 w-10 justify-self-end rounded-xs bg-muted md:block" />
          <span class="h-[60px] w-10 rounded-xs bg-muted md:h-[66px] md:w-11" />
          <span class="flex flex-col gap-2 pt-0.5"
            ><span class="h-3.5 w-2/3 rounded-xs bg-muted" /><span class="h-3 w-1/3 rounded-xs bg-muted"
          /></span>
          <span class="hidden h-3 w-3/4 rounded-xs bg-muted md:block" />
        </div>
      </div>
    </div>
  </div>
</template>
