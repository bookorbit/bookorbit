<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowUpToLine,
  Check,
  Download,
  ExternalLink,
  ListEnd,
  ListPlus,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Pause,
  Pin,
  PinOff,
  Play,
  RotateCcw,
  Trash2,
} from '@lucide/vue'
import type { PodcastEpisodeListItem } from '@bookorbit/types'
import { formatRelativeTimeFromNow } from '@/i18n/formatters'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatPodcastDate, formatPodcastDuration } from '../lib/podcast-format'
import { canQueueEpisodeDownload, canRemoveEpisodeDownload } from '../lib/podcast-episode-api'
import { episodeDownloadPercent, episodeNumberLabel, hasEpisodeStatusChips } from '../lib/podcast-episode-presentation'
import { PODCAST_EPISODE_ACTIONS } from '../composables/usePodcastEpisodeListActions'
import PodcastArtwork from './PodcastArtwork.vue'
import PodcastEpisodeStatusChips from './PodcastEpisodeStatusChips.vue'

const props = withDefaults(
  defineProps<{
    episode: PodcastEpisodeListItem
    canDownload: boolean
    showPodcastTitle?: boolean
    isActive?: boolean
    isPlaying?: boolean
    queueControls?: boolean
    /** Both the metadata permission and editor access to the episode's library, resolved by the host view. */
    canEditMetadata?: boolean
    downloadProgress?: { receivedBytes: number; totalBytes: number | null } | null
  }>(),
  {
    showPodcastTitle: true,
    isActive: false,
    isPlaying: false,
    queueControls: false,
    canEditMetadata: false,
    downloadProgress: null,
  },
)

const emit = defineEmits<{
  moveTop: [episode: PodcastEpisodeListItem]
}>()
const actions = inject(PODCAST_EPISODE_ACTIONS)
const { t } = useI18n()

const canRemoveFile = computed(() => canRemoveEpisodeDownload(props.episode, props.canDownload))
const canQueueFile = computed(() => canQueueEpisodeDownload(props.episode, props.canDownload))

const playbackStateClasses = computed(() => {
  if (!props.isActive) return 'border-border/60 bg-card'
  return props.isPlaying ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/10' : 'border-border bg-muted/30 ring-1 ring-border/60'
})
const episodeNumber = computed(() => episodeNumberLabel(props.episode))
const downloadPercent = computed(() => episodeDownloadPercent(props.downloadProgress))
const lastListened = computed(() => {
  if (!props.episode.lastListenedAt || props.episode.progressPercent > 0) return null
  return formatRelativeTimeFromNow(props.episode.lastListenedAt, { smallestUnit: 'minute' })
})
const hasStatus = computed(() => hasEpisodeStatusChips(props.episode, props.isActive))
const timeRemaining = computed(() => {
  if (props.episode.progressPercent <= 0 || props.episode.finished || !props.episode.durationSeconds) return null
  return formatPodcastDuration(Math.max(0, props.episode.durationSeconds - props.episode.positionSeconds))
})

function handlePlay() {
  void actions?.play(props.episode)
}

function handleOpen() {
  actions?.openPlayer(props.episode)
}

function handleDetails() {
  actions?.openDetails(props.episode)
}

function handleEditMetadata() {
  actions?.openMetadataEditor(props.episode)
}

function handleQueue() {
  void actions?.queue(props.episode)
}

function handleQueueNext() {
  void actions?.queueNext(props.episode)
}

function handleUnqueue() {
  void actions?.unqueue(props.episode)
}

function handleDownload() {
  void actions?.download(props.episode)
}

function handleRemoveDownload() {
  void actions?.removeDownload(props.episode)
}

function handleFinish() {
  void actions?.finish(props.episode)
}

function handleUnfinish() {
  void actions?.unfinish(props.episode)
}

function handlePin() {
  void actions?.pin(props.episode)
}

function handleUnpin() {
  void actions?.unpin(props.episode)
}

function handleMoveTop() {
  emit('moveTop', props.episode)
}
</script>

<template>
  <article
    class="group flex min-w-0 items-center gap-2.5 rounded-xl border p-2.5 transition-[border-color,background-color,box-shadow] hover:border-primary/25 hover:shadow-[var(--elevation-sm)]"
    :class="playbackStateClasses"
    :aria-current="isActive ? 'true' : undefined"
    :aria-label="episode.title"
  >
    <button
      type="button"
      class="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-muted outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] sm:h-18 sm:w-18"
      :aria-label="t('podcast.actions.playNamedEpisode', { title: episode.title })"
      @click="handlePlay"
    >
      <PodcastArtwork :src="episode.podcastImageUrl" :reset-key="episode.podcastId" class="h-full w-full" />
      <span
        class="absolute inset-0 flex items-center justify-center bg-background/65 opacity-0 backdrop-blur-[1px] transition-opacity group-hover:opacity-100"
      >
        <span class="flex h-9 w-9 items-center justify-center rounded-full bg-card/90 text-foreground shadow-[var(--elevation-sm)]">
          <Pause v-if="isActive && isPlaying" class="h-4 w-4 fill-current" />
          <Play v-else class="ml-0.5 h-4 w-4 fill-current" />
        </span>
      </span>
    </button>

    <div class="min-w-0 flex-1">
      <p v-if="showPodcastTitle" class="truncate text-[11px] font-medium text-muted-foreground">{{ episode.podcastTitle }}</p>
      <button
        type="button"
        class="mt-0.5 block w-full rounded-sm text-start outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
        :aria-label="t('podcast.actions.episodeDetailsNamed', { title: episode.title })"
        @click="handleDetails"
      >
        <span class="line-clamp-2 text-sm font-semibold leading-5 text-foreground transition-colors hover:text-primary">
          {{ episode.title }}
        </span>
      </button>
      <!-- The date was the only elastic item here, so it absorbed every shortfall and was the first
           thing to lose characters on a narrow screen. Nothing here shrinks now, so the row keeps
           every value whole and wraps instead: a season number, a long date, a duration and the
           explicit badge together overrun 375px, and the badge is the piece that was being cut in
           half. Wrapping trades a line of height for never slicing a content warning. The dots only
           separate items sitting on one line, so they go when the row is free to wrap. -->
      <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden text-xs text-muted-foreground sm:flex-nowrap sm:gap-x-2">
        <span v-if="episodeNumber" class="shrink-0 font-medium tabular-nums">{{ episodeNumber }}</span>
        <span v-if="episodeNumber" class="hidden sm:inline" aria-hidden="true">·</span>
        <span class="shrink-0">{{ formatPodcastDate(episode.publishedAt) }}</span>
        <span class="hidden sm:inline" aria-hidden="true">·</span>
        <span class="shrink-0">{{ formatPodcastDuration(episode.durationSeconds) }}</span>
        <span
          v-if="episode.explicit"
          class="inline-flex h-5 min-w-5 items-center justify-center rounded border border-border px-1 text-[10px] font-bold text-foreground"
          :aria-label="t('podcast.labels.explicit')"
          :title="t('podcast.labels.explicit')"
        >
          E
        </span>
        <span v-if="lastListened" class="hidden min-w-0 truncate xl:inline">{{ t('podcast.labels.lastListened', { time: lastListened }) }}</span>
        <span v-if="episode.pinned" class="inline-flex shrink-0 items-center text-muted-foreground" :title="t('podcast.labels.pinnedHint')">
          <Pin class="h-3 w-3" aria-hidden="true" />
          <span class="sr-only">{{ t('podcast.labels.pinnedEpisode') }}</span>
        </span>
      </div>
      <div v-if="hasStatus" class="mt-1 flex flex-wrap gap-1 text-xs" data-testid="episode-status-row">
        <PodcastEpisodeStatusChips :episode="episode" :is-active="isActive" :is-playing="isPlaying" />
      </div>
      <div v-if="episode.progressPercent > 0 && !episode.finished" class="mt-2 flex items-center gap-2">
        <div
          class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          :aria-label="t('podcast.status.playbackProgress')"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="Math.round(episode.progressPercent)"
        >
          <div class="h-full rounded-full bg-primary" :style="{ width: `${episode.progressPercent}%` }" />
        </div>
        <span v-if="timeRemaining" class="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {{ t('podcast.labels.timeLeft', { time: timeRemaining }) }}
        </span>
      </div>
      <div
        v-if="episode.mediaStatus === 'downloading' && downloadPercent !== null"
        class="mt-2 h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        :aria-label="t('podcast.status.downloadProgress')"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(downloadPercent)"
      >
        <div class="h-full rounded-full bg-info" :style="{ width: `${downloadPercent}%` }" />
      </div>
    </div>

    <!-- Rows are a touch surface first. The controls keep their compact look but stand 40px tall so a
         thumb has something to land on, and the gap grew with them so neighbouring targets, one of
         which removes the episode from the queue, cannot be caught by the same tap. -->
    <div class="flex shrink-0 items-center gap-2 self-center">
      <Button
        size="sm"
        class="h-10 w-10 px-0 sm:w-auto sm:px-3"
        :aria-label="t('podcast.actions.listenToEpisode', { title: episode.title })"
        @click="handlePlay"
      >
        <Pause v-if="isActive && isPlaying" class="size-3.5 fill-current" />
        <Play v-else class="size-3.5 fill-current" />
        <span class="hidden sm:inline">{{ isActive && isPlaying ? t('podcast.actions.pause') : t('podcast.actions.listen') }}</span>
      </Button>
      <Button
        v-if="episode.queued"
        variant="outline"
        size="sm"
        class="hidden h-10 text-muted-foreground hover:text-foreground sm:inline-flex"
        @click="handleUnqueue"
      >
        <ListEnd class="size-3.5" /> {{ t('podcast.actions.remove') }}
      </Button>
      <Button v-else variant="outline" size="sm" class="hidden h-10 text-muted-foreground hover:text-foreground sm:inline-flex" @click="handleQueue">
        <ListPlus class="size-3.5" /> {{ t('podcast.views.queue') }}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="outline"
            size="icon-sm"
            class="size-10 text-muted-foreground hover:text-foreground"
            :aria-label="t('podcast.actions.episodeActions')"
          >
            <MoreHorizontal :size="15" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-44">
          <DropdownMenuItem @click="handleDetails"> <PanelRight class="mr-2 h-4 w-4" /> {{ t('podcast.actions.episodeDetails') }} </DropdownMenuItem>
          <DropdownMenuItem @click="handleOpen"> <ExternalLink class="mr-2 h-4 w-4" /> {{ t('podcast.actions.openFullPlayer') }} </DropdownMenuItem>
          <DropdownMenuItem v-if="canEditMetadata" data-testid="podcast-edit-episode-metadata" @click="handleEditMetadata">
            <Pencil class="mr-2 h-4 w-4" /> {{ t('podcast.actions.editEpisodeMetadata') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem v-if="queueControls" @click="handlePlay">
            <Play class="mr-2 h-4 w-4" /> {{ t('podcast.actions.playFromHere') }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="queueControls" @click="handleMoveTop">
            <ArrowUpToLine class="mr-2 h-4 w-4" /> {{ t('podcast.actions.moveToTop') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator v-if="queueControls" />
          <DropdownMenuItem v-if="episode.queued" class="sm:hidden" @click="handleUnqueue">
            <ListEnd class="mr-2 h-4 w-4" /> {{ t('podcast.actions.removeFromQueue') }}
          </DropdownMenuItem>
          <DropdownMenuItem v-else class="sm:hidden" @click="handleQueue">
            <ListPlus class="mr-2 h-4 w-4" /> {{ t('podcast.actions.addToQueue') }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="!episode.queued" @click="handleQueueNext">
            <ListPlus class="mr-2 h-4 w-4" /> {{ t('podcast.actions.playNext') }}
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="canQueueFile"
            :disabled="episode.mediaStatus === 'queued' || episode.mediaStatus === 'downloading'"
            @click="handleDownload"
          >
            <Download class="mr-2 h-4 w-4" />
            {{ episode.mediaStatus === 'failed' ? t('podcast.actions.retryDownload') : t('podcast.actions.download') }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="canRemoveFile" :variant="episode.origin === 'local' ? 'destructive' : undefined" @click="handleRemoveDownload">
            <Trash2 class="mr-2 h-4 w-4" />
            {{ t('podcast.actions.removeDownload') }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem v-if="episode.pinned" :title="t('podcast.labels.pinnedHint')" @click="handleUnpin">
            <PinOff class="mr-2 h-4 w-4" /> {{ t('podcast.actions.unpinEpisode') }}
          </DropdownMenuItem>
          <DropdownMenuItem v-else :title="t('podcast.labels.pinnedHint')" @click="handlePin">
            <Pin class="mr-2 h-4 w-4" /> {{ t('podcast.actions.pinEpisode') }}
          </DropdownMenuItem>
          <DropdownMenuItem v-if="episode.finished" @click="handleUnfinish">
            <RotateCcw class="mr-2 h-4 w-4" /> {{ t('podcast.actions.markUnplayed') }}
          </DropdownMenuItem>
          <DropdownMenuItem v-else @click="handleFinish"> <Check class="mr-2 h-4 w-4" /> {{ t('podcast.actions.markPlayed') }} </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </article>
</template>
