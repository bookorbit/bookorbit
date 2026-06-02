<script setup lang="ts">
import { computed, ref } from 'vue'
import type { SeriesSummary } from '@bookorbit/types'
import { BookCopy } from 'lucide-vue-next'
import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import { resolveSquareCoverScale, shouldPersistCoverRatio } from '../lib/cover-scale'
import { useCoverStack } from '../composables/useCoverStack'
import SeriesCompletionBar from './SeriesCompletionBar.vue'

const HOVERED_COVER_Z_INDEX = 120
const SQUARE_COVER_SCALE = 1.25

const props = defineProps<{
  series: SeriesSummary
}>()

const emit = defineEmits<{
  open: [seriesId: number]
}>()

const { coverUrl } = useCoverVersions()
const fallbackStyle = computed(() => bookCoverStyle(props.series.name))
const initial = computed(() => props.series.name.trim().charAt(0).toUpperCase() || '?')

const failedCovers = ref(new Set<number>())
const coverRatios = ref(new Map<number, number>())
const hoveredCoverId = ref<number | null>(null)
const activeCoverIds = computed(() => props.series.coverBookIds.filter((id) => !failedCovers.value.has(id)))
const { visibleCovers, baseStyles } = useCoverStack(activeCoverIds)

const authorsLine = computed(() => {
  const a = props.series.authors
  if (a.length === 0) return ''
  if (a.length <= 2) return a.join(', ')
  return `${a[0]}, ${a[1]} +${a.length - 2}`
})

function handleCoverError(bookId: number) {
  failedCovers.value = new Set([...failedCovers.value, bookId])
  if (coverRatios.value.has(bookId)) {
    const nextRatios = new Map(coverRatios.value)
    nextRatios.delete(bookId)
    coverRatios.value = nextRatios
  }
}

function handleCoverLoad(bookId: number, ratio: number | null) {
  const prev = coverRatios.value.get(bookId)
  if (!shouldPersistCoverRatio(prev, ratio)) return
  coverRatios.value = new Map(coverRatios.value).set(bookId, ratio)
}

function handleClick() {
  emit('open', props.series.id)
}

function handleCoverHover(bookId: number) {
  hoveredCoverId.value = bookId
}

function clearHoveredCover() {
  hoveredCoverId.value = null
}

const coverStyles = computed(() => {
  const total = visibleCovers.value.length
  if (total === 0) return []

  const hoveredId = hoveredCoverId.value
  const hoveredIndex = hoveredId == null ? -1 : visibleCovers.value.findIndex((id) => id === hoveredId)
  const hasActiveHover = hoveredIndex >= 0

  return baseStyles.value.map((base, index) => {
    const bookId = visibleCovers.value[index]
    const ratio = bookId == null ? null : (coverRatios.value.get(bookId) ?? null)
    const squareScale = resolveSquareCoverScale(ratio, SQUARE_COVER_SCALE)
    const isHovered = hasActiveHover && hoveredId === visibleCovers.value[index]
    const distanceFromHovered = hasActiveHover ? Math.abs(index - hoveredIndex) : 0
    const loweredScale = Math.max(0.95, 1 - distanceFromHovered * 0.03)
    const loweredOffset = Math.min(4, distanceFromHovered * 1.4)

    return {
      ...base,
      zIndex: hasActiveHover ? (isHovered ? HOVERED_COVER_Z_INDEX : base.zIndex) : base.zIndex,
      transformOrigin: squareScale > 1 ? 'center bottom' : 'center',
      transform: hasActiveHover
        ? isHovered
          ? `translateY(-8px) scale(${1.05 * squareScale})`
          : `translateY(${loweredOffset}px) scale(${loweredScale * squareScale})`
        : `translateY(0) scale(${squareScale})`,
      opacity: hasActiveHover ? (isHovered ? 1 : 0.58) : 1,
      filter: hasActiveHover ? (isHovered ? 'brightness(1.08) saturate(1.14)' : 'brightness(0.78) saturate(0.74)') : 'none',
      boxShadow: hasActiveHover
        ? isHovered
          ? '0 0 0 2px hsl(var(--primary) / 0.45), 0 24px 36px -20px rgba(15, 23, 42, 0.72), 0 10px 18px -14px rgba(15, 23, 42, 0.3)'
          : '0 10px 18px -16px rgba(15, 23, 42, 0.4)'
        : base.boxShadow,
      transition: 'transform 190ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 180ms ease, filter 180ms ease, box-shadow 220ms ease',
      willChange: 'transform, opacity, filter',
    }
  })
})
</script>

<template>
  <div class="group flex h-full cursor-pointer flex-col" @click="handleClick">
    <div
      class="flex h-full flex-col overflow-hidden rounded-lg border border-border/60 bg-card shadow-sm transition-all duration-200 hover:border-border hover:shadow-md"
    >
      <div
        class="relative isolate overflow-hidden border-b border-border/60 bg-linear-to-b from-white/[0.035] via-background/5 to-black/[0.07]"
        style="aspect-ratio: 11 / 8"
        @mouseleave="clearHoveredCover"
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

        <div
          v-for="(bookId, i) in visibleCovers"
          :key="bookId"
          class="absolute overflow-hidden rounded-lg"
          :style="coverStyles[i] ?? {}"
          @mouseenter="handleCoverHover(bookId)"
        >
          <BookCoverArtwork
            :src="coverUrl(bookId)"
            :has-cover="true"
            :title="series.name"
            :seed="`${series.name}-${bookId}`"
            alt=""
            frame-aspect-ratio="2/3"
            loading="lazy"
            decoding="async"
            :spine="false"
            @load="handleCoverLoad(bookId, $event)"
            @error="handleCoverError(bookId)"
          />
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
