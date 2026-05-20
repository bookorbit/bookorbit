<script setup lang="ts">
import { BookOpen, Play } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import { useCurrentlyReadingWidget } from '../../composables/useCurrentlyReadingWidget'

const { data, loading, error } = useCurrentlyReadingWidget()
const router = useRouter()
const { coverUrl } = useCoverVersions()

function goToBook(bookId: number) {
  void router.push({ name: 'book-detail', params: { bookId } })
}

function continueReading(bookId: number, fileId: number | null, fileFormat: string | null) {
  if (fileId) {
    void router.push({ name: 'reader', params: { bookId, fileId }, query: { format: fileFormat ?? 'epub' } })
  } else {
    void router.push({ name: 'book-detail', params: { bookId } })
  }
}
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-3 flex items-center gap-2 self-start">
      <BookOpen :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">Currently Reading</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 gap-3">
      <div v-for="n in 2" :key="n" class="flex w-full gap-2.5">
        <div class="h-16 w-11 shrink-0 animate-pulse rounded bg-muted" />
        <div class="flex-1 space-y-2">
          <div class="h-3 w-3/4 animate-pulse rounded bg-muted" />
          <div class="h-2.5 w-1/2 animate-pulse rounded bg-muted" />
          <div class="mt-1 h-1.5 w-full animate-pulse rounded-full bg-muted" />
        </div>
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">Failed to load</div>

    <!-- Empty -->
    <div v-else-if="!data || data.books.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <BookOpen :size="16" class="text-muted-foreground/60" />
      </div>
      <p class="text-center text-xs text-muted-foreground">No books in progress. Start reading one to see it here.</p>
    </div>

    <!-- Books list -->
    <div v-else class="flex-1 overflow-y-auto pr-1 [scrollbar-width:thin]">
      <div class="flex flex-col gap-2">
        <div
          v-for="book in data.books"
          :key="book.bookId"
          class="group/book relative flex min-w-0 cursor-pointer gap-2.5 rounded-lg bg-muted/20 p-1.5 transition-colors hover:bg-muted/40"
          @click="goToBook(book.bookId)"
        >
          <!-- Cover thumbnail -->
          <BookCoverSurface size="mini" class="h-14 w-9 shrink-0 overflow-hidden rounded">
            <img v-if="book.hasCover" :src="coverUrl(book.bookId)" :alt="book.title ?? 'Book cover'" class="h-full w-full object-cover" />
            <div v-else class="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
              <BookOpen :size="12" />
            </div>
          </BookCoverSurface>

          <!-- Info -->
          <div class="flex min-w-0 flex-1 flex-col justify-center">
            <p class="truncate text-xs font-semibold leading-tight">{{ book.title ?? 'Untitled' }}</p>
            <p v-if="book.authors.length > 0" class="truncate text-xs text-muted-foreground">
              {{ book.authors.join(', ') }}
            </p>
            <!-- Progress bar -->
            <div class="mt-1.5 flex items-center gap-1.5">
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div class="h-full rounded-full bg-primary transition-all duration-300" :style="{ width: `${Math.round(book.progress)}%` }" />
              </div>
              <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">{{ Math.round(book.progress) }}%</span>
            </div>
          </div>

          <!-- Continue button (hover) -->
          <button
            class="absolute right-2 top-1/3 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow transition-opacity group-hover/book:opacity-100"
            title="Continue reading"
            @click.stop="continueReading(book.bookId, book.fileId, book.fileFormat)"
          >
            <Play :size="11" class="translate-x-px" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
