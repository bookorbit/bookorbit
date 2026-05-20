<script setup lang="ts">
import { Clock, BookOpen, Play } from 'lucide-vue-next'
import { useRouter } from 'vue-router'

import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import { useLongWaitWidget } from '../../composables/useLongWaitWidget'

const { data, loading, error } = useLongWaitWidget()
const router = useRouter()
const { coverUrl } = useCoverVersions()

function goToBook() {
  if (!data.value) return
  void router.push({ name: 'book-detail', params: { bookId: data.value.bookId } })
}

function startReading() {
  if (!data.value) return
  if (data.value.fileId) {
    void router.push({
      name: 'reader',
      params: { bookId: data.value.bookId, fileId: data.value.fileId },
      query: { format: data.value.fileFormat ?? 'epub' },
    })
  } else {
    goToBook()
  }
}
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-3 flex items-center gap-2 self-start">
      <Clock :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">The Long Wait</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="h-16 w-12 animate-pulse rounded bg-muted" />
      <div class="h-3 w-20 animate-pulse rounded bg-muted" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">Failed to load</div>

    <!-- Empty -->
    <div v-else-if="!data" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Clock :size="16" class="text-muted-foreground/60" />
      </div>
      <p class="text-center text-xs text-muted-foreground">No books waiting. You've started everything!</p>
    </div>

    <!-- Long wait book -->
    <div v-else class="flex flex-1 flex-col">
      <div class="flex flex-1 items-center justify-center gap-4">
        <BookCoverSurface
          tag="button"
          type="button"
          size="mini"
          class="h-24 w-18 shrink-0 cursor-pointer overflow-hidden rounded transition-opacity hover:opacity-80"
          @click="goToBook"
        >
          <img v-if="data.hasCover" :src="coverUrl(data.bookId)" :alt="data.title ?? 'Cover'" class="h-full w-full object-cover" />
          <div v-else class="flex h-full w-full items-center justify-center bg-muted">
            <BookOpen :size="14" class="text-muted-foreground" />
          </div>
        </BookCoverSurface>

        <div class="min-w-0 text-left">
          <button class="block cursor-pointer truncate text-xs font-semibold leading-tight hover:underline" @click="goToBook">
            {{ data.title ?? 'Untitled' }}
          </button>
          <p class="mt-2 text-2xl font-bold leading-none tabular-nums text-primary">{{ data.waitingDays }}</p>
          <p class="text-[11px] text-muted-foreground">days waiting</p>

          <div class="mt-2 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
            <span v-if="data.pageCount" class="shrink-0">{{ data.pageCount }} pages</span>
            <span v-if="data.pageCount && data.genre" class="shrink-0">&middot;</span>
            <span v-if="data.genre" class="truncate">{{ data.genre }}</span>
          </div>
        </div>
      </div>

      <!-- Start Reading CTA -->
      <button
        class="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary/10 py-2 text-[12px] font-medium text-primary transition-colors hover:bg-primary/20"
        @click="startReading"
      >
        <Play :size="12" class="translate-x-px" />
        Start Reading
      </button>
    </div>
  </div>
</template>
