<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, LibraryBig } from '@lucide/vue'
import { FORMAT_TO_GROUP, type BookCard } from '@bookorbit/types'
import BookCoverSurface from '../BookCoverSurface.vue'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

const props = defineProps<{
  book: BookCard
  colId: string
}>()

const { t } = useI18n()

const collapsed = computed(() => props.book.collapsedSeries!)
const seriesName = computed(() => props.book.seriesName ?? '')
const readCount = computed(() => collapsed.value.readCount)
const bookCount = computed(() => collapsed.value.bookCount)
const coverIds = computed(() => collapsed.value.coverBookIds.filter((id) => id > 0).slice(0, 4))
const primaryFile = computed(() => props.book.files.find((file) => file.role === 'primary') ?? props.book.files[0] ?? null)
const isAudiobook = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'audio')
const isComic = computed(() => primaryFile.value?.format != null && FORMAT_TO_GROUP[primaryFile.value.format] === 'cbx')
const { coverUrl } = useCoverVersions()

function thumbnailUrl(bookId: number): string {
  const version = bookId === props.book.id ? (props.book.updatedAt ?? props.book.addedAt) : collapsed.value.coverUpdatedAtByBookId?.[bookId]
  return coverUrl(bookId, 'thumbnail', version)
}
</script>

<template>
  <div v-if="colId === 'lockRow'" class="flex h-6 w-6 items-center justify-center">
    <LibraryBig :size="13" class="text-muted-foreground/60" />
  </div>

  <div v-else-if="colId === 'readStatus'" class="flex w-full items-center px-1 py-0.5">
    <div class="flex w-3 items-center justify-center">
      <span class="text-[10px] text-muted-foreground/40">-</span>
    </div>
  </div>

  <div v-else-if="colId === 'read'" class="flex w-full items-center justify-start">
    <div class="mr-auto flex h-7 w-7 items-center justify-center">
      <span class="text-[10px] text-muted-foreground/40">-</span>
    </div>
  </div>

  <div v-else-if="colId === 'cover'" class="flex h-9 items-center">
    <!-- Cover row: up to 4 thumbnails -->
    <div class="flex shrink-0 gap-0.5 min-w-9" :class="coverIds.length <= 1 ? 'justify-center' : 'justify-start'">
      <BookCoverSurface
        v-for="coverId in coverIds"
        :key="coverId"
        size="mini"
        :disable-spine="isAudiobook"
        :is-comic="isComic"
        class="h-8 w-6 rounded-sm overflow-hidden"
      >
        <img :src="thumbnailUrl(coverId)" class="h-full w-full object-cover" loading="lazy" alt="" />
      </BookCoverSurface>
      <BookCoverSurface
        v-if="coverIds.length === 0"
        size="mini"
        :disable-spine="isAudiobook"
        :is-comic="isComic"
        class="h-8 w-6 rounded-sm bg-muted flex items-center justify-center"
      >
        <span class="text-[8px] text-muted-foreground">?</span>
      </BookCoverSurface>
    </div>
  </div>

  <div v-else-if="colId === 'title'" class="flex items-center gap-2 min-w-0 h-full px-1">
    <span class="font-medium text-sm truncate block">{{ seriesName }}</span>
    <span class="text-xs text-muted-foreground shrink-0 mt-0.5">{{ t('book.table.series.bookCount', { count: bookCount }, bookCount) }}</span>
    <span v-if="readCount > 0" class="text-xs text-muted-foreground shrink-0 mt-0.5"
      >&middot; {{ t('book.table.series.readOfCount', { read: readCount, total: bookCount }) }}</span
    >
  </div>

  <div v-else-if="colId === 'actions'" class="flex h-full w-6 items-center justify-center">
    <ChevronRight :size="16" class="text-muted-foreground/60 group-hover:text-foreground transition-colors" />
  </div>

  <!-- Dash for all other columns -->
  <div v-else class="flex h-full items-center">
    <span class="text-[10px] text-muted-foreground/20">-</span>
  </div>
</template>
