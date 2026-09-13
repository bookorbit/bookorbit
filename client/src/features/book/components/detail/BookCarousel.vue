<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight } from '@lucide/vue'

import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import { STATUS_COLORS, STATUS_ICONS } from '@/features/book/composables/useBookStatus'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import type { CoverAspectRatio, ReadStatus, UserBookStatus } from '@bookorbit/types'

export interface CarouselBook {
  id: number
  title: string | null
  coverAspectRatio: CoverAspectRatio
  updatedAt?: string | null
  seriesIndex?: string | null
  hasCover: boolean
  authors: string[]
  readStatus?: UserBookStatus | null
  isAudiobook?: boolean
  isComic?: boolean
}

const props = withDefaults(
  defineProps<{
    books: CarouselBook[]
    loading: boolean
    currentBookId?: number | null
    showSeriesIndex?: boolean
    showHeader?: boolean
    /** 'lg' is the book detail shelf, where the cover is the whole point. */
    size?: 'md' | 'lg'
  }>(),
  {
    currentBookId: null,
    showSeriesIndex: false,
    showHeader: true,
    size: 'md',
  },
)

/** Both ratios resolve to the same cover height, so a mixed shelf stays level. */
const cardWidthClass = computed(() => {
  const square = props.size === 'lg' ? 'w-46' : 'w-38'
  const portrait = props.size === 'lg' ? 'w-31' : 'w-30'
  return { square, portrait }
})

const router = useRouter()
const { t } = useI18n()
const { coverUrl } = useCoverVersions()
const scrollEl = ref<HTMLElement | null>(null)
const coverResetVersion = ref(0)

function scroll(direction: 'left' | 'right') {
  if (!scrollEl.value) return
  scrollEl.value.scrollBy({ left: direction === 'left' ? -240 : 240, behavior: 'smooth' })
}

function navigateToBook(bookId: number) {
  router.push({ name: 'book-detail', params: { bookId } })
}

function formatSeriesIndex(index: string | null | undefined): string {
  if (index == null) return ''
  return `#${index}`
}

function isAudiobook(book: CarouselBook): boolean {
  return book.isAudiobook ?? false
}

function isComic(book: CarouselBook): boolean {
  return book.isComic ?? false
}

function readStatus(book: CarouselBook): ReadStatus | null {
  const status = book.readStatus?.status
  return status != null && status !== 'unread' ? status : null
}

function readStatusLabel(status: ReadStatus): string {
  const key = status.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
  return t(`book.readStatus.${key}`)
}

function cardAspectRatio(book: CarouselBook): string {
  return book.coverAspectRatio
}

watch(
  () => props.books,
  () => {
    coverResetVersion.value += 1
  },
  { immediate: true },
)

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

    <div v-if="loading" class="flex gap-6 overflow-x-auto pb-2">
      <div v-for="i in 10" :key="i" class="shrink-0" :class="cardWidthClass.portrait">
        <div class="w-full rounded-sm bg-muted animate-shimmer" style="aspect-ratio: 2/3" />
      </div>
    </div>

    <div v-else ref="scrollEl" class="flex gap-6 overflow-x-auto pb-2">
      <button
        v-for="(book, index) in books"
        :key="book.id"
        :data-book-id="book.id"
        class="shrink-0 text-left group animate-fade-up"
        :class="book.coverAspectRatio === '1/1' ? cardWidthClass.square : cardWidthClass.portrait"
        :style="{ animationDelay: `${index * 40}ms` }"
        @click="navigateToBook(book.id)"
      >
        <BookCoverSurface
          class="book-cover-surface--spine-fitted relative w-full rounded-sm overflow-hidden transition-transform duration-150 group-hover:scale-[1.02]"
          :interactive="true"
          :disable-spine="isAudiobook(book)"
          :is-comic="isComic(book)"
          :display-mode="isAudiobook(book) ? 'fill-crop' : undefined"
          :style="{ aspectRatio: cardAspectRatio(book) }"
        >
          <BookCoverArtwork
            :src="coverUrl(book.id, 'thumbnail', book.updatedAt)"
            :has-cover="book.hasCover"
            :title="book.title"
            :author-line="book.authors.length > 0 ? book.authors.join(', ') : null"
            :is-audio="isAudiobook(book)"
            :seed="book.title ?? String(book.id)"
            :alt="book.title ?? ''"
            :frame-aspect-ratio="cardAspectRatio(book)"
            :mode="isAudiobook(book) ? 'fill-crop' : undefined"
            :reset-key="`${coverResetVersion}:${book.id}`"
            :spine="!isAudiobook(book)"
            :is-comic="isComic(book)"
          />
          <span
            v-if="readStatus(book)"
            class="absolute top-1.5 left-1.5 z-10 flex items-center justify-center rounded-full bg-black/60 p-1 pointer-events-none"
          >
            <component :is="STATUS_ICONS[readStatus(book)!]" :size="12" :class="STATUS_COLORS[readStatus(book)!]" />
            <span class="sr-only">{{ readStatusLabel(readStatus(book)!) }}</span>
          </span>
          <span
            v-if="showSeriesIndex && book.seriesIndex != null"
            class="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-[9px] font-semibold leading-none px-1.5 py-1 rounded-full pointer-events-none"
          >
            {{ formatSeriesIndex(book.seriesIndex) }}
          </span>
        </BookCoverSurface>
      </button>
    </div>
  </div>
</template>
