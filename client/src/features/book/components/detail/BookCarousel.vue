<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight } from 'lucide-vue-next'

import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

export interface CarouselBook {
  id: number
  title: string | null
  seriesIndex?: number | null
}

const props = withDefaults(
  defineProps<{
    books: CarouselBook[]
    loading: boolean
    currentBookId?: number | null
    showSeriesIndex?: boolean
    showHeader?: boolean
  }>(),
  {
    currentBookId: null,
    showSeriesIndex: false,
    showHeader: true,
  },
)

const router = useRouter()
const { coverUrl } = useCoverVersions()
const scrollEl = ref<HTMLElement | null>(null)

function scroll(direction: 'left' | 'right') {
  if (!scrollEl.value) return
  scrollEl.value.scrollBy({ left: direction === 'left' ? -240 : 240, behavior: 'smooth' })
}

function navigateToBook(bookId: number) {
  router.push({ name: 'book-detail', params: { bookId } })
}

function formatSeriesIndex(index: number | null | undefined): string {
  if (index == null) return ''
  return Number.isInteger(index) ? `#${index}` : `#${index}`
}

watch(
  () => [props.books, props.loading, props.currentBookId] as const,
  async ([books, loading, currentId]) => {
    if (loading || !currentId || books.length === 0) return
    await nextTick()
    if (!scrollEl.value) return
    const card = scrollEl.value.querySelector(`[data-book-id="${currentId}"]`)
    if (card) card.scrollIntoView({ inline: 'center', behavior: 'instant', block: 'nearest' })
  },
  { immediate: true },
)
defineExpose({ scroll })
</script>

<template>
  <div v-if="loading || books.length > 0">
    <div v-if="showHeader" class="flex items-center justify-between mb-4">
      <slot name="header" />
      <div class="flex items-center gap-1">
        <button
          class="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="scroll('left')"
        >
          <ChevronLeft :size="14" />
        </button>
        <button
          class="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="scroll('right')"
        >
          <ChevronRight :size="14" />
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex gap-3 overflow-x-auto pb-2">
      <div v-for="i in 10" :key="i" class="w-24 shrink-0">
        <div class="w-full rounded-sm bg-muted animate-shimmer" style="aspect-ratio: 2/3" />
      </div>
    </div>

    <div v-else ref="scrollEl" class="flex gap-6 overflow-x-auto pb-2">
      <button
        v-for="(book, index) in books"
        :key="book.id"
        :data-book-id="book.id"
        class="shrink-0 text-left group animate-fade-up w-30"
        :style="{ animationDelay: `${index * 40}ms` }"
        @click="navigateToBook(book.id)"
      >
        <div
          class="relative w-full rounded-sm overflow-hidden shadow-sm transition-all duration-150 group-hover:shadow-md group-hover:scale-[1.02]"
          style="aspect-ratio: 2/3"
          :style="bookCoverStyle(book.title ?? String(book.id))"
        >
          <img
            :src="coverUrl(book.id, 'thumbnail')"
            :alt="book.title ?? ''"
            class="w-full h-full object-cover transition-opacity duration-300 ease-out"
            loading="lazy"
            @error="(e) => ((e.target as HTMLImageElement).style.display = 'none')"
          />
          <span
            v-if="showSeriesIndex && book.seriesIndex != null"
            class="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-[9px] font-semibold leading-none px-1.5 py-1 rounded-full pointer-events-none"
          >
            {{ formatSeriesIndex(book.seriesIndex) }}
          </span>
        </div>
      </button>
    </div>
  </div>
</template>
