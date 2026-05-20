<script setup lang="ts">
import { computed, inject, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { BookCard } from '@bookorbit/types'
import BookCoverPlaceholder from './BookCoverPlaceholder.vue'
import BookCoverSurface from './BookCoverSurface.vue'
import { COVER_ASPECT_RATIO_KEY, DEFAULT_COVER_ASPECT_RATIO } from '../lib/cover-aspect-ratio'
import { useCoverVersions } from '../composables/useCoverVersions'

const props = defineProps<{
  book: BookCard
}>()

const route = useRoute()
const router = useRouter()
const coverAspectRatio = inject(COVER_ASPECT_RATIO_KEY, ref(DEFAULT_COVER_ASPECT_RATIO))
const { coverUrl } = useCoverVersions()

const collapsed = computed(() => props.book.collapsedSeries!)
const seriesName = computed(() => props.book.seriesName ?? '')
const authorLine = computed(() => props.book.authors.join(', ') || null)
const hoverTitleClampClass = computed(() => (coverAspectRatio.value === '1/1' ? 'line-clamp-1' : 'line-clamp-2'))

const coverIds = computed(() => collapsed.value.coverBookIds.filter((bookId) => bookId > 0).slice(0, 4))
const tileCount = computed(() => Math.max(coverIds.value.length, 1))

const failedCovers = ref(new Set<number>())

function handleCoverError(bookId: number) {
  failedCovers.value = new Set([...failedCovers.value, bookId])
}

function handleClick() {
  router.push({ name: 'series-detail', params: { seriesName: seriesName.value }, query: { from: route.fullPath } })
}

function tileClass(index: number): string {
  if (tileCount.value <= 1) return 'col-span-2 row-span-2'
  if (tileCount.value === 2) return 'row-span-2'
  if (tileCount.value === 3 && index === 0) return 'row-span-2'
  return ''
}
</script>

<template>
  <div class="group flex flex-col @container cursor-pointer" @click="handleClick">
    <!-- Cover -->
    <BookCoverSurface
      class="relative w-full rounded-sm overflow-hidden transition-[box-shadow,transform] duration-150 will-change-transform group-hover:scale-[1.02]"
      interactive
      :style="{ aspectRatio: coverAspectRatio }"
    >
      <!-- Adaptive cover mosaic -->
      <div class="absolute inset-0 grid grid-cols-2 grid-rows-2">
        <template v-for="(bookId, i) in coverIds" :key="bookId">
          <div class="relative overflow-hidden" :class="tileClass(i)" data-testid="series-cover-tile">
            <img
              v-if="!failedCovers.has(bookId)"
              :src="coverUrl(bookId)"
              class="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
              alt=""
              @error="() => handleCoverError(bookId)"
            />
            <BookCoverPlaceholder v-else title="" author-line="" :is-audio="false" :seed="`series-${bookId}`" />
          </div>
        </template>
        <div v-if="coverIds.length === 0" class="relative overflow-hidden" :class="tileClass(0)" data-testid="series-cover-fallback">
          <BookCoverPlaceholder title="" author-line="" :is-audio="false" seed="series-empty" />
        </div>
      </div>

      <!-- Count badge -->
      <div
        class="absolute right-1.5 top-1.5 z-10 rounded-sm bg-black/70 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white group-hover:opacity-0 transition-opacity duration-150"
        data-testid="series-count-badge"
      >
        {{ collapsed.bookCount }}
      </div>

      <!-- Hover overlay -->
      <div
        class="absolute inset-0 flex flex-col p-2 bg-black/70 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-150"
      >
        <div class="flex-1" />
        <div class="shrink-0 flex flex-col">
          <p class="text-xs font-semibold text-white leading-tight" :class="hoverTitleClampClass">
            {{ seriesName }}
          </p>
          <p v-if="authorLine" class="text-[10px] text-white/70 truncate mt-0.5">
            {{ authorLine }}
          </p>
        </div>
      </div>
    </BookCoverSurface>
  </div>
</template>
