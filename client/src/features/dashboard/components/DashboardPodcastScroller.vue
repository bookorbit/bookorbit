<script setup lang="ts">
import { ref, useAttrs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, Play, Radio, RefreshCw } from '@lucide/vue'

import type { PodcastEpisodeListItem } from '@bookorbit/types'
import { formatPodcastDuration } from '@/features/podcast/lib/podcast-format'
import { usePodcastPlayer } from '@/features/podcast/composables/usePodcastPlayer'
import { useDashboardPodcastScroller } from '../composables/useDashboardPodcastScroller'

defineOptions({
  inheritAttrs: false,
})

const props = defineProps<{
  title: string
  limit?: number
}>()

const attrs = useAttrs()
const { t } = useI18n()
const player = usePodcastPlayer()
const { episodes, loading, error, refresh } = useDashboardPodcastScroller(props.limit)

const scrollEl = ref<HTMLElement | null>(null)
const failedArtworkIds = ref<Set<number>>(new Set())

const SKELETONS = Array.from({ length: 6 })

// Finishing an episode drops it out of the resume feed, so the shelf would otherwise keep
// offering an episode the user just completed.
watch(
  () => [player.episode.value?.id, player.episode.value?.finished] as const,
  ([episodeId, finished], previous) => {
    if (!episodeId || !finished) return
    if (previous?.[0] === episodeId && previous[1]) return
    void refresh()
  },
)

function scrollPrevious() {
  scrollEl.value?.scrollBy({ left: -560, behavior: 'smooth' })
}

function scrollNext() {
  scrollEl.value?.scrollBy({ left: 560, behavior: 'smooth' })
}

async function playEpisode(episode: PodcastEpisodeListItem) {
  if (player.episode.value?.id === episode.id) {
    player.togglePlayback()
    return
  }
  await player.playInline(episode.id)
}

function artworkAvailable(episode: PodcastEpisodeListItem) {
  return Boolean(episode.podcastImageUrl) && !failedArtworkIds.value.has(episode.id)
}

function handleArtworkError(episodeId: number) {
  failedArtworkIds.value = new Set(failedArtworkIds.value).add(episodeId)
}

function timeRemaining(episode: PodcastEpisodeListItem) {
  if (!episode.durationSeconds) return null
  return formatPodcastDuration(Math.max(0, episode.durationSeconds - episode.positionSeconds))
}
</script>

<template>
  <section v-bind="attrs" class="group/scroller overflow-hidden rounded-2xl border border-primary/40 bg-card/30 shadow-sm backdrop-blur-[1px]">
    <div class="mb-2 flex items-center justify-between px-5 pt-4">
      <div class="flex items-center gap-2.5">
        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50">
          <Radio :size="14" class="text-foreground" aria-hidden="true" />
        </div>
        <h2 class="text-[15px] font-bold tracking-tight">{{ title }}</h2>
        <span
          v-if="!loading && !error && episodes.length > 0"
          class="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground"
        >
          {{ episodes.length }}
        </span>
      </div>
      <div class="flex items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/scroller:opacity-100 focus-within:opacity-100">
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          :aria-label="t('common.previous')"
          @click="scrollPrevious"
        >
          <ChevronLeft :size="16" />
        </button>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          :aria-label="t('common.next')"
          @click="scrollNext"
        >
          <ChevronRight :size="16" />
        </button>
      </div>
    </div>

    <div v-if="loading" class="flex gap-5 overflow-hidden px-5 pb-5" role="status" aria-live="polite">
      <span class="sr-only">{{ t('podcast.library.loading') }}</span>
      <div v-for="(_, n) in SKELETONS" :key="n" class="w-[150px] shrink-0">
        <div class="aspect-square w-full animate-pulse rounded-lg bg-muted" />
        <div class="mt-2 h-3.5 w-full animate-pulse rounded bg-muted" />
        <div class="mt-1.5 h-3 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    </div>

    <div v-else-if="error" class="flex items-center gap-2.5 px-5 pb-4 pt-1 text-sm text-muted-foreground">
      <span>{{ t('dashboard.scroller.failedToLoad') }}</span>
      <button class="flex items-center gap-1.5 text-xs text-primary hover:underline" @click="refresh">
        <RefreshCw :size="12" />
        {{ t('dashboard.common.retry') }}
      </button>
    </div>

    <div v-else-if="episodes.length === 0" class="flex animate-fade-up flex-col items-center justify-center gap-3 py-10 text-center">
      <div class="flex h-12 w-12 animate-scale-in items-center justify-center rounded-full bg-muted">
        <Radio :size="20" class="text-muted-foreground" aria-hidden="true" />
      </div>
      <p class="text-sm text-muted-foreground">{{ t('dashboard.scroller.empty.continuePodcasts') }}</p>
    </div>

    <div v-else ref="scrollEl" class="flex items-start gap-5 overflow-x-auto px-5 pb-5 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button
        v-for="(episode, index) in episodes"
        :key="episode.id"
        type="button"
        class="group/tile w-[150px] shrink-0 animate-fade-up rounded-lg text-start outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        :style="{ animationDelay: `${index * 35}ms` }"
        :aria-label="t('podcast.actions.resumeEpisode', { title: episode.title })"
        @click="playEpisode(episode)"
      >
        <span class="relative block aspect-square overflow-hidden rounded-lg bg-muted">
          <img
            v-if="artworkAvailable(episode)"
            :src="episode.podcastImageUrl!"
            alt=""
            class="h-full w-full object-cover transition-transform duration-200 group-hover/tile:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover/tile:scale-100"
            @error="handleArtworkError(episode.id)"
          />
          <span v-else class="flex h-full w-full items-center justify-center">
            <Radio class="size-8 text-muted-foreground" aria-hidden="true" />
          </span>
          <span
            class="absolute inset-0 flex items-center justify-center bg-background/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100 motion-reduce:transition-none"
          >
            <span class="flex size-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--elevation-lg)]">
              <Play class="ml-0.5 size-5 fill-current" aria-hidden="true" />
            </span>
          </span>
          <span class="absolute inset-x-0 bottom-0 h-1 bg-background/70">
            <span class="block h-full bg-primary" :style="{ width: `${episode.progressPercent}%` }" />
          </span>
        </span>

        <span class="mt-2 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-foreground transition-colors group-hover/tile:text-primary">
          {{ episode.title }}
        </span>
        <span class="mt-0.5 block truncate text-xs text-muted-foreground">{{ episode.podcastTitle }}</span>
        <span v-if="timeRemaining(episode)" class="mt-0.5 block text-xs tabular-nums text-muted-foreground">
          {{ t('podcast.labels.timeLeft', { time: timeRemaining(episode) }) }}
        </span>
      </button>
    </div>
  </section>
</template>
