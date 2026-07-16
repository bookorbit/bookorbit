<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock, Play } from '@lucide/vue'
import { useRouter } from 'vue-router'
import { FORMAT_TO_GROUP } from '@bookorbit/types'

import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import { useLongWaitWidget } from '../../composables/useLongWaitWidget'

const { data, loading, error } = useLongWaitWidget()
const { t } = useI18n()
const router = useRouter()
const { coverUrl } = useCoverVersions()

const isComic = computed(() => {
  const format = data.value?.fileFormat
  return format != null && FORMAT_TO_GROUP[format] === 'cbx'
})

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
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.longWait.title') }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-1 flex-col items-center justify-center gap-3">
      <div class="h-16 w-12 animate-pulse rounded bg-muted" />
      <div class="h-3 w-20 animate-pulse rounded bg-muted" />
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ t('dashboard.common.failedToLoad') }}
    </div>

    <!-- Empty -->
    <div v-else-if="!data" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Clock :size="16" class="text-muted-foreground/60" />
      </div>
      <p class="text-center text-xs text-muted-foreground">{{ t('dashboard.widgets.longWait.empty') }}</p>
    </div>

    <!-- Long wait book -->
    <div v-else class="flex flex-1 flex-col">
      <div class="flex flex-1 items-center justify-center gap-4">
        <BookCoverSurface
          tag="button"
          type="button"
          size="mini"
          class="book-cover-surface--spine-fitted h-24 w-18 shrink-0 cursor-pointer overflow-hidden rounded transition-opacity hover:opacity-80"
          :is-comic="isComic"
          @click="goToBook"
        >
          <BookCoverArtwork
            :src="coverUrl(data.bookId)"
            :has-cover="data.hasCover"
            :title="data.title"
            :author-line="null"
            :is-audio="false"
            :seed="data.title ?? String(data.bookId)"
            :alt="data.title ?? t('dashboard.common.cover')"
            frame-aspect-ratio="3/4"
            :is-comic="isComic"
          />
        </BookCoverSurface>

        <div class="min-w-0 text-left">
          <button class="block cursor-pointer truncate text-xs font-semibold leading-tight hover:underline" @click="goToBook">
            {{ data.title ?? t('dashboard.common.untitled') }}
          </button>
          <p class="mt-2 text-2xl font-bold leading-none tabular-nums text-primary">{{ data.waitingDays }}</p>
          <p class="text-[11px] text-muted-foreground">{{ t('dashboard.widgets.longWait.daysWaiting') }}</p>

          <div class="mt-2 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
            <span v-if="data.pageCount" class="shrink-0">{{ t('dashboard.widgets.longWait.pages', { count: data.pageCount }, data.pageCount) }}</span>
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
        {{ t('dashboard.widgets.longWait.startReading') }}
      </button>
    </div>
  </div>
</template>
