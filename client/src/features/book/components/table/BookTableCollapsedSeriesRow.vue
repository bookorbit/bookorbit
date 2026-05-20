<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronRight } from 'lucide-vue-next'
import type { BookCard } from '@bookorbit/types'
import BookCoverSurface from '../BookCoverSurface.vue'

const props = defineProps<{
  book: BookCard
  colspan: number
  selectionMode?: boolean
}>()

const router = useRouter()

const collapsed = computed(() => props.book.collapsedSeries!)
const seriesName = computed(() => props.book.seriesName ?? '')
const readCount = computed(() => collapsed.value.readCount)
const bookCount = computed(() => collapsed.value.bookCount)
const coverIds = computed(() => collapsed.value.coverBookIds.filter((id) => id > 0).slice(0, 4))

function handleClick() {
  if (props.selectionMode) return
  router.push({ name: 'series-detail', params: { seriesName: seriesName.value } })
}

function thumbnailUrl(bookId: number): string {
  return `/api/v1/books/${bookId}/thumbnail`
}
</script>

<template>
  <td :colspan="colspan" role="gridcell" class="cursor-pointer px-3 py-1.5" @click="handleClick">
    <div class="flex items-center gap-3 min-w-0">
      <!-- Cover row: up to 4 thumbnails -->
      <div class="flex shrink-0 gap-0.5">
        <BookCoverSurface v-for="coverId in coverIds" :key="coverId" size="mini" class="h-8 w-6 rounded-sm overflow-hidden">
          <img :src="thumbnailUrl(coverId)" class="h-full w-full object-cover" loading="lazy" alt="" />
        </BookCoverSurface>
        <BookCoverSurface v-if="coverIds.length === 0" size="mini" class="h-8 w-6 rounded-sm bg-muted flex items-center justify-center">
          <span class="text-[8px] text-muted-foreground">?</span>
        </BookCoverSurface>
      </div>

      <!-- Series info -->
      <div class="min-w-0 flex-1">
        <span class="font-medium text-sm truncate block">{{ seriesName }}</span>
        <div class="flex items-center gap-2 mt-0.5">
          <span class="text-xs text-muted-foreground"> {{ bookCount }} {{ bookCount === 1 ? 'book' : 'books' }} </span>
          <span v-if="readCount > 0" class="text-xs text-muted-foreground"> &middot; {{ readCount }} of {{ bookCount }} read </span>
        </div>
      </div>

      <!-- Chevron -->
      <ChevronRight :size="14" class="shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
    </div>
  </td>
</template>
