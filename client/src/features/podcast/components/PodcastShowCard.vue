<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Archive, Bell, Check, Download, FolderX, HardDrive, Play } from '@lucide/vue'
import type { PodcastListItem } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPodcastDate } from '../lib/podcast-format'
import PodcastArtwork from './PodcastArtwork.vue'

const props = defineProps<{
  show: PodcastListItem
  /** Off unless a list has turned on select mode, so the collection and playlist grids are unaffected. */
  selectable?: boolean
  selected?: boolean
}>()
const emit = defineEmits<{
  open: [show: PodcastListItem]
  play: [show: PodcastListItem]
  follow: [show: PodcastListItem]
  unfollow: [show: PodcastListItem]
  'toggle-select': [show: PodcastListItem]
}>()
const { t } = useI18n()

/** A local show is never refreshed, so a failure counter left on one describes nothing current. */
const feedFailing = computed(() => props.show.origin !== 'local' && props.show.consecutiveFailures > 0)
const playLabel = computed(() => {
  const recommendation = props.show.playbackRecommendation
  if (!recommendation) return ''
  return recommendation.kind === 'resume'
    ? t('podcast.actions.resumeEpisode', { title: recommendation.title })
    : t('podcast.actions.playLatestEpisode', { title: recommendation.title })
})

function handleOpen() {
  // In select mode the whole cover is the checkbox: a grid you are picking from should not navigate
  // away the moment you aim slightly wrong.
  if (props.selectable) {
    emit('toggle-select', props.show)
    return
  }
  emit('open', props.show)
}

function handleFollow() {
  emit('follow', props.show)
}

function handlePlay() {
  emit('play', props.show)
}

function handleUnfollow() {
  emit('unfollow', props.show)
}
</script>

<template>
  <article
    class="group/card flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/80 bg-card shadow-[var(--elevation-xs)] transition-[border-color,box-shadow] duration-200 hover:border-primary/30 hover:shadow-[var(--elevation-sm)] focus-within:border-primary/50 focus-within:shadow-[var(--elevation-sm)] @container"
  >
    <div class="relative aspect-square overflow-hidden bg-muted">
      <button
        type="button"
        class="group/cover block h-full w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        :aria-label="selectable ? t('podcast.selection.toggleShow', { title: show.title }) : show.title"
        :aria-pressed="selectable ? selected : undefined"
        @click="handleOpen"
      >
        <PodcastArtwork
          :src="show.imageUrl"
          :reset-key="show.id"
          class="h-full w-full"
          image-class="transition-transform duration-300 group-hover/cover:scale-[1.025] motion-reduce:transition-none motion-reduce:group-hover/cover:scale-100"
          icon-class="h-12 w-12"
        />
      </button>
      <div class="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-1">
        <Badge v-if="show.unplayedCount > 0" class="bg-primary text-primary-foreground shadow-[var(--elevation-xs)]">
          {{ t('podcast.labels.newEpisodeCount', { count: formatNumber(show.unplayedCount) }) }}
        </Badge>
        <span class="ml-auto flex flex-col items-end gap-1">
          <Badge v-if="feedFailing" variant="destructive" :title="t('podcast.status.feedFailing')">
            <AlertTriangle class="mr-1 size-3" /> {{ t('podcast.status.feedFailing') }}
          </Badge>
          <Badge v-if="show.missingAt" variant="destructive" :title="t('podcast.status.missingDescription')">
            <FolderX class="mr-1 size-3" /> {{ t('podcast.status.missing') }}
          </Badge>
          <!-- A missing folder is only ever a local show, so the missing badge stands in for both
               rather than stacking two badges across a cover that has room for one. -->
          <Badge v-else-if="show.origin === 'local'" variant="secondary" :title="t('podcast.status.localShowDescription')">
            <HardDrive class="mr-1 size-3" /> {{ t('podcast.status.localShow') }}
          </Badge>
          <Badge v-if="show.archivedAt" variant="secondary"> <Archive class="mr-1 size-3" /> {{ t('podcast.status.archived') }} </Badge>
        </span>
      </div>
      <div
        v-if="selectable"
        class="pointer-events-none absolute inset-0 z-20 rounded-sm"
        :class="selected ? 'bg-primary/20 ring-2 ring-inset ring-primary' : ''"
      >
        <div
          class="absolute bottom-2 left-2 flex size-5 items-center justify-center rounded transition-colors"
          :class="selected ? 'bg-primary' : 'border border-white/50 bg-black/40'"
        >
          <Check v-if="selected" class="text-primary-foreground" :size="12" />
        </div>
      </div>
      <div
        v-if="show.playbackRecommendation && !selectable"
        class="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/45 opacity-0 backdrop-blur-[1px] transition-opacity duration-200 group-hover/card:opacity-100 group-focus-within/card:opacity-100"
      >
        <button
          type="button"
          class="pointer-events-none flex size-[26cqi] max-h-14 max-w-14 min-h-10 min-w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--elevation-lg)] outline-none transition-transform group-hover/card:pointer-events-auto group-focus-within/card:pointer-events-auto hover:scale-105 focus-visible:ring-ring/50 focus-visible:ring-[3px] motion-reduce:transition-none"
          :aria-label="playLabel"
          :title="playLabel"
          @click="handlePlay"
        >
          <Play class="ml-[1cqi] size-[11cqi] max-h-6 max-w-6 fill-current" />
        </button>
      </div>
    </div>
    <!-- The content column is what a title and a formatted date have to fit inside, and at the
         default cover size it was a pixel or three short of both. The padding and the separator
         gaps below are sized to leave that room at every cover size, not only the roomy ones. -->
    <div class="grid flex-1 grid-rows-[2rem_1.25rem_1.25rem] gap-y-0.5 p-2">
      <div class="flex min-w-0 items-center gap-1">
        <button
          type="button"
          class="block min-w-0 flex-1 rounded-md text-left outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          :title="show.title"
          @click="handleOpen"
        >
          <h2 class="truncate text-sm font-semibold leading-5 transition-colors hover:text-primary">{{ show.title }}</h2>
        </button>
        <Button
          v-if="show.playbackRecommendation && !selectable"
          size="icon-sm"
          class="shrink-0 [@media(hover:hover)]:hidden"
          :aria-label="playLabel"
          :title="playLabel"
          @click="handlePlay"
        >
          <Play class="ml-px size-3 fill-current" />
        </Button>
        <!-- Following is an action, and a grid the user is picking from should offer none. -->
        <template v-if="!selectable">
          <Button
            v-if="show.followed"
            variant="ghost"
            size="icon-sm"
            class="bg-success/10 text-success hover:bg-destructive/10 hover:text-destructive"
            :aria-label="t('podcast.actions.unfollowPodcast')"
            :title="t('podcast.actions.unfollow')"
            @click="handleUnfollow"
          >
            <Bell class="size-3 fill-current" />
          </Button>
          <Button
            v-else
            variant="ghost"
            size="icon-sm"
            class="bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary"
            :aria-label="t('podcast.actions.followPodcast')"
            :title="t('podcast.actions.follow')"
            @click="handleFollow"
          >
            <Bell class="size-3" />
          </Button>
        </template>
      </div>
      <p class="truncate text-xs leading-5 text-muted-foreground">{{ show.author || t('podcast.labels.unknownPublisher') }}</p>
      <p class="flex min-w-0 items-center gap-1 truncate text-[11px] leading-5 text-muted-foreground">
        <Badge
          variant="outline"
          class="h-5 min-w-6 border-transparent bg-primary/10 px-1.5 text-[10px] font-semibold tabular-nums text-primary"
          :aria-label="t('podcast.labels.episodeCount', { count: show.episodeCount })"
        >
          {{ formatNumber(show.episodeCount) }}
        </Badge>
        <span aria-hidden="true">·</span>
        <span class="inline-flex items-center gap-1"><Download class="size-3" /> {{ formatNumber(show.downloadedCount) }}</span>
        <span v-if="show.latestPublishedAt" aria-hidden="true">·</span>
        <span v-if="show.latestPublishedAt" class="shrink-0">{{ formatPodcastDate(show.latestPublishedAt) }}</span>
      </p>
    </div>
  </article>
</template>
