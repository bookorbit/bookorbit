<script setup lang="ts">
import { Highlighter, BookOpen, ExternalLink } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import { useHighlightOfTheDayWidget } from '../../composables/useHighlightOfTheDayWidget'

const { data, loading, error } = useHighlightOfTheDayWidget()
const router = useRouter()
const { coverUrl } = useCoverVersions()

function goToBook() {
  if (!data.value) return
  void router.push({ name: 'book-detail', params: { bookId: data.value.bookId } })
}
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-2 flex items-center gap-2 self-start">
      <Highlighter :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">Highlight of the Day</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 flex-col gap-2">
      <div class="h-16 w-full animate-pulse rounded bg-muted" />
      <div class="h-3 w-2/3 animate-pulse rounded bg-muted" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">Failed to load</div>

    <!-- Empty -->
    <div v-else-if="!data" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Highlighter :size="16" class="text-muted-foreground/60" />
      </div>
      <p class="text-center text-xs text-muted-foreground">Highlight passages while reading to see them here</p>
    </div>

    <!-- Quote -->
    <div v-else class="flex flex-1 flex-col justify-between gap-2 overflow-hidden">
      <blockquote
        class="overflow-y-auto border-l-2 border-primary/40 py-1 pl-3 text-xs italic leading-relaxed text-foreground/90 [scrollbar-width:thin]"
      >
        "{{ data.text.length > 200 ? data.text.slice(0, 200) + '...' : data.text }}"
      </blockquote>
      <button class="flex cursor-pointer items-center gap-2 rounded-lg pb-1 pl-1 text-left transition-colors hover:bg-muted/40" @click="goToBook">
        <BookCoverSurface v-if="data.hasCover" size="mini" class="h-9 w-6 shrink-0 overflow-hidden rounded">
          <img :src="coverUrl(data.bookId)" :alt="data.bookTitle ?? 'Cover'" class="h-full w-full object-cover" />
        </BookCoverSurface>
        <div v-else class="flex h-8 w-5 shrink-0 items-center justify-center rounded bg-muted">
          <BookOpen :size="10" class="text-muted-foreground" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[12px] font-medium leading-tight">{{ data.bookTitle ?? 'Untitled' }}</p>
          <p v-if="data.chapterTitle" class="truncate text-[11px] text-muted-foreground">{{ data.chapterTitle }}</p>
        </div>
        <ExternalLink :size="14" class="mr-1 shrink-0 text-muted-foreground/50" />
      </button>
    </div>
  </div>
</template>
