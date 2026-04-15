<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SeriesSummary } from '@projectx/types'
import { BookCopy } from 'lucide-vue-next'
import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import SeriesCompletionBar from './SeriesCompletionBar.vue'

const MAX_VISIBLE = 7
const COVER_WIDTH_PCT = 43
const COVER_VERTICAL_MARGIN_PCT = 5.5
const COVER_GROUP_WIDTH_BY_COUNT = {
  1: 43,
  2: 62,
  3: 72,
  4: 80,
  5: 86,
  6: 90,
  7: 92,
} satisfies Record<number, number>
const DEFAULT_COVER_GROUP_WIDTH = COVER_GROUP_WIDTH_BY_COUNT[7]

const props = defineProps<{
  series: SeriesSummary
}>()

const emit = defineEmits<{
  open: [seriesName: string]
}>()

const { coverUrl } = useCoverVersions()
const fallbackStyle = computed(() => bookCoverStyle(props.series.name))
const initial = computed(() => props.series.name.trim().charAt(0).toUpperCase() || '?')

const failedCovers = ref(new Set<number>())
const visibleCovers = computed(() => props.series.coverBookIds.filter((id) => !failedCovers.value.has(id)).slice(0, MAX_VISIBLE))

const authorsLine = computed(() => {
  const a = props.series.authors
  if (a.length === 0) return ''
  if (a.length <= 2) return a.join(', ')
  return `${a[0]}, ${a[1]} +${a.length - 2}`
})

function handleCoverError(bookId: number) {
  failedCovers.value = new Set([...failedCovers.value, bookId])
}

function handleClick() {
  emit('open', props.series.name)
}

const coverStyles = computed(() => {
  const total = visibleCovers.value.length
  if (total === 0) return []

  const groupWidth = COVER_GROUP_WIDTH_BY_COUNT[total as keyof typeof COVER_GROUP_WIDTH_BY_COUNT] ?? DEFAULT_COVER_GROUP_WIDTH
  const step = total > 1 ? (groupWidth - COVER_WIDTH_PCT) / (total - 1) : 0
  const startLeft = (100 - groupWidth) / 2
  const center = (total - 1) / 2

  return visibleCovers.value.map((_, index) => ({
    left: `${startLeft + step * index}%`,
    bottom: `${COVER_VERTICAL_MARGIN_PCT}%`,
    width: `${COVER_WIDTH_PCT}%`,
    aspectRatio: '2 / 3',
    zIndex: Math.round(total - Math.abs(index - center)) + 1,
    boxShadow:
      index === Math.round(center)
        ? '0 18px 34px -20px rgba(15, 23, 42, 0.72), 0 8px 14px -12px rgba(15, 23, 42, 0.28)'
        : '0 14px 26px -20px rgba(15, 23, 42, 0.58), 0 6px 12px -12px rgba(15, 23, 42, 0.22)',
  }))
})
</script>

<template>
  <div class="group flex h-full cursor-pointer flex-col" @click="handleClick">
    <div
      class="flex h-full flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm transition-all duration-200 hover:border-border hover:shadow-md"
    >
      <div
        class="relative isolate overflow-hidden border-b border-border/60 bg-linear-to-b from-white/[0.035] via-background/5 to-black/[0.07]"
        style="aspect-ratio: 11 / 8"
      >
        <div class="absolute inset-x-[21%] bottom-[5%] h-4 rounded-full bg-black/10 blur-2xl opacity-38" />

        <div class="absolute right-2.5 top-2.5 z-[100]">
          <span
            class="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/88 px-2 py-1 text-[11px] font-medium text-foreground shadow-sm backdrop-blur"
          >
            <BookCopy :size="12" class="text-muted-foreground" />
            {{ series.bookCount.toLocaleString() }}
          </span>
        </div>

        <div v-for="(bookId, i) in visibleCovers" :key="bookId" class="absolute overflow-hidden rounded-lg" :style="coverStyles[i] ?? {}">
          <img :src="coverUrl(bookId)" alt="" class="h-full w-full object-cover" loading="lazy" decoding="async" @error="handleCoverError(bookId)" />
        </div>

        <div
          v-if="visibleCovers.length === 0"
          class="absolute inset-x-[28.5%] bottom-[5.5%] top-[5.5%] flex select-none items-center justify-center rounded-[14px] text-4xl font-bold shadow-[0_12px_28px_-18px_rgba(15,23,42,0.7)]"
          :style="{ background: fallbackStyle.background, color: fallbackStyle.color }"
        >
          {{ initial }}
        </div>
      </div>

      <div class="flex flex-1 flex-col px-4 py-3">
        <h3 class="truncate text-sm font-semibold text-foreground">{{ series.name }}</h3>
        <p v-if="authorsLine" class="mt-1 truncate text-xs text-muted-foreground">{{ authorsLine }}</p>
      </div>

      <SeriesCompletionBar :read-count="series.readCount" :total-count="series.bookCount" compact flush class="mt-auto" />
    </div>
  </div>
</template>
