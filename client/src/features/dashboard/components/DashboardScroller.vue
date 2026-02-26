<script setup lang="ts">
import { computed, ref } from 'vue'
import { Aperture, BookMarked, ChevronLeft, ChevronRight, RefreshCw, Shuffle, Sparkles } from 'lucide-vue-next'

import type { ScrollerType } from '@projectx/types'
import DashboardBookCard from './DashboardBookCard.vue'
import { useDashboardScroller } from '../composables/useDashboardScroller'

const props = defineProps<{
  type: ScrollerType
  title: string
  limit?: number
  lensId?: number
}>()

const { books, loading, error, refresh } = useDashboardScroller(props.type, props.limit, props.lensId)

const scrollEl = ref<HTMLElement | null>(null)

function scrollBy(delta: number) {
  scrollEl.value?.scrollBy({ left: delta, behavior: 'smooth' })
}

const typeIcon = computed(() => {
  if (props.type === 'continue-reading') return BookMarked
  if (props.type === 'recently-added') return Sparkles
  if (props.type === 'lens') return Aperture
  return Shuffle
})

const SKELETONS = Array.from({ length: 8 })
</script>

<template>
  <section class="group/scroller overflow-hidden rounded-2xl border border-primary/40 bg-card/30 shadow-sm backdrop-blur-[1px]">
    <!-- Header -->
    <div class="mb-2 flex items-center justify-between px-5 pt-4">
      <div class="flex items-center gap-2.5">
        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50">
          <component :is="typeIcon" :size="14" class="text-foreground" />
        </div>
        <h2 class="text-[15px] font-bold tracking-tight">{{ title }}</h2>
        <span
          v-if="!loading && !error && books.length > 0"
          class="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground"
        >
          {{ books.length }}
        </span>
      </div>
      <div class="flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/scroller:opacity-100">
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="scrollBy(-560)"
        >
          <ChevronLeft :size="16" />
        </button>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="scrollBy(560)"
        >
          <ChevronRight :size="16" />
        </button>
      </div>
    </div>

    <!-- Skeleton -->
    <div v-if="loading" class="flex gap-3 overflow-hidden px-5 pb-5">
      <div v-for="(_, n) in SKELETONS" :key="n" class="w-[120px] shrink-0">
        <div class="w-full animate-pulse rounded-md bg-muted" style="aspect-ratio: 2/3" />
      </div>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex items-center gap-2.5 px-5 pb-4 pt-1 text-sm text-muted-foreground">
      <span>Failed to load.</span>
      <button class="flex items-center gap-1.5 text-xs text-primary hover:underline" @click="refresh">
        <RefreshCw :size="12" />
        Retry
      </button>
    </div>

    <!-- Empty -->
    <div v-else-if="books.length === 0" class="px-5 pb-4 pt-1">
      <p class="text-sm text-muted-foreground">
        <template v-if="type === 'continue-reading'">No books in progress yet. Start reading one to see it here.</template>
        <template v-else-if="type === 'recently-added'">No books in your library yet.</template>
        <template v-else-if="type === 'lens'">No books match this lens.</template>
        <template v-else>No unread books found.</template>
      </p>
    </div>

    <!-- Books row — card's overflow:hidden gives clean edge, no gradient needed -->
    <div v-else ref="scrollEl" class="flex gap-5 overflow-x-auto px-5 pb-5 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div
        v-for="(book, index) in books"
        :key="book.id"
        class="w-[120px] shrink-0"
        style="animation: dashboardFadeUp 0.35s ease both"
        :style="{ animationDelay: `${index * 35}ms` }"
      >
        <DashboardBookCard :book="book" :show-progress="type === 'continue-reading'" />
      </div>
    </div>
  </section>
</template>

<style scoped>
@keyframes dashboardFadeUp {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
