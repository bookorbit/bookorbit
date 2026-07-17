<script setup lang="ts">
import { Gem, Star, BookMarked, Check } from '@lucide/vue'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import BookCoverArtwork from '@/features/book/components/BookCoverArtwork.vue'
import BookCoverSurface from '@/features/book/components/BookCoverSurface.vue'
import { useBookStatus } from '@/features/book/composables/useBookStatus'
import { useNeglectedGemsWidget } from '../../composables/useNeglectedGemsWidget'

const { data, loading, error } = useNeglectedGemsWidget()
const { t } = useI18n()
const router = useRouter()
const { setStatus } = useBookStatus()
const { coverUrl } = useCoverVersions()

const displayIndex = ref(0)
const currentGem = computed(() => data.value?.gems[displayIndex.value] ?? null)
const queuedIds = ref<Set<number>>(new Set())

function handleShuffle() {
  if (!data.value || data.value.gems.length <= 1) return
  displayIndex.value = (displayIndex.value + 1) % data.value.gems.length
}

function goToBook() {
  if (!currentGem.value) return
  void router.push({ name: 'book-detail', params: { bookId: currentGem.value.bookId } })
}

async function addToQueue() {
  if (!currentGem.value) return
  const bookId = currentGem.value.bookId
  await setStatus(bookId, 'want_to_read')
  queuedIds.value = new Set([...queuedIds.value, bookId])
}
</script>

<template>
  <div class="flex h-full flex-col p-3">
    <div class="mb-3 flex items-center gap-2 self-start">
      <Gem :size="16" class="text-primary/90" />
      <span class="text-[15px] font-semibold text-foreground">{{ t('dashboard.widgets.neglectedGems.title') }}</span>
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
    <div v-else-if="!data || data.gems.length === 0" class="flex flex-1 flex-col items-center justify-center gap-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
        <Gem :size="16" class="text-muted-foreground/60" />
      </div>
      <p class="text-center text-xs text-muted-foreground">{{ t('dashboard.widgets.neglectedGems.empty') }}</p>
    </div>

    <!-- Gem -->
    <div v-else-if="currentGem" class="flex flex-1 flex-col items-center justify-center gap-2">
      <BookCoverSurface
        tag="button"
        type="button"
        size="mini"
        class="book-cover-surface--spine-fitted h-19 w-13 cursor-pointer overflow-hidden rounded transition-opacity hover:opacity-80"
        @click="goToBook"
      >
        <BookCoverArtwork
          :src="coverUrl(currentGem.bookId)"
          :has-cover="currentGem.hasCover"
          :title="currentGem.title"
          :author-line="null"
          :is-audio="false"
          :seed="currentGem.title ?? String(currentGem.bookId)"
          :alt="currentGem.title ?? t('dashboard.common.cover')"
          frame-aspect-ratio="13/19"
        />
      </BookCoverSurface>
      <button class="max-w-full cursor-pointer truncate text-center text-xs font-semibold hover:underline" @click="goToBook">
        {{ currentGem.title ?? t('dashboard.common.untitled') }}
      </button>
      <div class="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Star :size="12" class="fill-amber-400 text-amber-400" />
        <span>{{ t('dashboard.widgets.neglectedGems.rating', { rating: currentGem.rating }) }}</span>
        <span>&middot;</span>
        <span>{{ t('dashboard.widgets.neglectedGems.daysWaiting', { count: currentGem.waitingDays }) }}</span>
      </div>

      <!-- Actions -->
      <div class="mt-1 flex items-center gap-1.5">
        <button
          class="flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-[11px] transition-colors"
          :class="
            queuedIds.has(currentGem.bookId) ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600' : 'text-muted-foreground hover:bg-muted'
          "
          :disabled="queuedIds.has(currentGem.bookId)"
          @click="addToQueue"
        >
          <component :is="queuedIds.has(currentGem.bookId) ? Check : BookMarked" :size="11" />
          {{ queuedIds.has(currentGem.bookId) ? t('dashboard.widgets.neglectedGems.queued') : t('dashboard.widgets.neglectedGems.addToQueue') }}
        </button>
        <button
          v-if="data.gems.length > 1"
          class="rounded-md border border-input px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
          @click="handleShuffle"
        >
          {{ t('dashboard.widgets.neglectedGems.shuffle') }}
        </button>
      </div>
    </div>
  </div>
</template>
