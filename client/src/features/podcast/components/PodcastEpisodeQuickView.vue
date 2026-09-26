<script setup lang="ts">
import { computed, inject, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import DOMPurify from 'dompurify'
import { Check, Download, ExternalLink, ListEnd, ListPlus, Pause, Pencil, Play, RotateCcw, Trash2 } from '@lucide/vue'
import type { PodcastEpisodeListItem } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import { formatPodcastDate, formatPodcastDuration } from '../lib/podcast-format'
import { canRemoveEpisodeDownload } from '../lib/podcast-episode-api'
import { episodeNumberLabel } from '../lib/podcast-episode-presentation'
import { usePodcastEpisodeDetail } from '../composables/usePodcastEpisodeDetail'
import { PODCAST_EPISODE_ACTIONS } from '../composables/usePodcastEpisodeListActions'
import PodcastArtwork from './PodcastArtwork.vue'
import PodcastEpisodeStatusChips from './PodcastEpisodeStatusChips.vue'

const props = withDefaults(
  defineProps<{
    episode: PodcastEpisodeListItem | null
    open: boolean
    canDownload: boolean
    isActive?: boolean
    isPlaying?: boolean
    /** Both the metadata permission and editor access to the episode's library, resolved by the host view. */
    canEditMetadata?: boolean
  }>(),
  { isActive: false, isPlaying: false, canEditMetadata: false },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()
const actions = inject(PODCAST_EPISODE_ACTIONS)

const { t } = useI18n()
const canRemoveFile = computed(() => (props.episode ? canRemoveEpisodeDownload(props.episode, props.canDownload) : false))
const { detail, loading, error, reload } = usePodcastEpisodeDetail(
  toRef(() => props.episode?.id ?? null),
  toRef(() => props.open),
)

const episodeNumber = computed(() => (props.episode ? episodeNumberLabel(props.episode) : null))
const safeDescription = computed(() => DOMPurify.sanitize(detail.value?.description ?? ''))

function handleOpenChange(value: boolean) {
  emit('update:open', value)
}

function handlePlay() {
  if (props.episode) void actions?.play(props.episode)
}

function handleOpenPlayer() {
  if (!props.episode) return
  actions?.openPlayer(props.episode)
  emit('update:open', false)
}

function handleEditMetadata() {
  if (!props.episode) return
  actions?.openMetadataEditor(props.episode)
  emit('update:open', false)
}

function handleQueue() {
  if (props.episode) void actions?.queue(props.episode)
}

function handleQueueNext() {
  if (props.episode) void actions?.queueNext(props.episode)
}

function handleUnqueue() {
  if (props.episode) void actions?.unqueue(props.episode)
}

function handleDownload() {
  if (props.episode) void actions?.download(props.episode)
}

function handleRemoveDownload() {
  if (props.episode) void actions?.removeDownload(props.episode)
}

function handleFinish() {
  if (props.episode) void actions?.finish(props.episode)
}

function handleUnfinish() {
  if (props.episode) void actions?.unfinish(props.episode)
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent side="right" class="w-full gap-0 sm:max-w-100" data-testid="podcast-episode-quick-view">
      <SheetHeader class="border-b border-border pr-10">
        <SheetTitle>{{ t('podcast.actions.episodeDetails') }}</SheetTitle>
        <SheetDescription>{{ t('podcast.fullPlayer.aboutEpisode') }}</SheetDescription>
      </SheetHeader>

      <div v-if="loading" class="flex-1 space-y-4 overflow-y-auto p-5" role="status">
        <span class="sr-only">{{ t('podcast.fullPlayer.loading') }}</span>
        <div class="flex gap-3">
          <Skeleton class="size-20 shrink-0 rounded-xl" />
          <div class="flex-1 space-y-2">
            <Skeleton class="h-3 w-2/3" />
            <Skeleton class="h-5 w-full" />
            <Skeleton class="h-3 w-4/5" />
          </div>
        </div>
        <Skeleton class="h-24 w-full" />
        <Skeleton class="h-9 w-full" />
      </div>

      <LoadErrorPanel v-else-if="error" :message="error" class="flex-1" @retry="reload" />

      <div v-else-if="episode && detail" class="flex-1 overflow-y-auto p-5">
        <div class="flex gap-3">
          <PodcastArtwork :src="detail.podcastImageUrl" :reset-key="detail.id" class="size-20 shrink-0 rounded-xl" icon-class="size-7" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium text-muted-foreground">{{ detail.podcastTitle }}</p>
            <h2 class="mt-1 text-base font-semibold leading-6">{{ detail.title }}</h2>
            <div class="mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-muted-foreground">
              <span v-if="episodeNumber" class="shrink-0">{{ episodeNumber }}</span>
              <span v-if="episodeNumber" aria-hidden="true">·</span>
              <span class="truncate">{{ formatPodcastDate(detail.publishedAt) }}</span>
              <span aria-hidden="true">·</span>
              <span class="shrink-0">{{ formatPodcastDuration(detail.durationSeconds) }}</span>
              <span v-if="detail.explicit" class="shrink-0 font-bold" :aria-label="t('podcast.labels.explicit')">E</span>
            </div>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-1 text-xs">
          <PodcastEpisodeStatusChips :episode="episode" :is-active="isActive" :is-playing="isPlaying" />
        </div>

        <div class="mt-5 flex flex-wrap gap-2 border-y border-border py-4">
          <Button size="sm" @click="handlePlay">
            <Pause v-if="isActive && isPlaying" class="size-3.5 fill-current" />
            <Play v-else class="size-3.5 fill-current" />
            {{ isActive && isPlaying ? t('podcast.actions.pause') : t('podcast.actions.listen') }}
          </Button>
          <Button v-if="episode.queued" variant="outline" size="sm" @click="handleUnqueue">
            <ListEnd class="size-3.5" /> {{ t('podcast.actions.removeFromQueue') }}
          </Button>
          <Button v-else variant="outline" size="sm" @click="handleQueue">
            <ListPlus class="size-3.5" /> {{ t('podcast.actions.addToQueue') }}
          </Button>
          <Button v-if="!episode.queued" variant="outline" size="sm" @click="handleQueueNext">
            <ListPlus class="size-3.5" /> {{ t('podcast.actions.playNext') }}
          </Button>
          <Button
            v-if="canDownload && episode.mediaStatus !== 'local'"
            variant="outline"
            size="sm"
            :disabled="episode.mediaStatus === 'queued' || episode.mediaStatus === 'downloading'"
            @click="handleDownload"
          >
            <Download class="size-3.5" />
            {{ episode.mediaStatus === 'failed' ? t('podcast.actions.retryDownload') : t('podcast.actions.download') }}
          </Button>
          <Button
            v-if="canRemoveFile"
            variant="outline"
            size="sm"
            :class="episode.origin === 'local' ? 'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive' : undefined"
            @click="handleRemoveDownload"
          >
            <Trash2 class="size-3.5" />
            {{ t('podcast.actions.removeDownload') }}
          </Button>
          <Button v-if="episode.finished" variant="outline" size="sm" @click="handleUnfinish">
            <RotateCcw class="size-3.5" /> {{ t('podcast.actions.markUnplayed') }}
          </Button>
          <Button v-else variant="outline" size="sm" @click="handleFinish"> <Check class="size-3.5" /> {{ t('podcast.actions.markPlayed') }} </Button>
          <Button v-if="canEditMetadata" variant="outline" size="sm" data-testid="podcast-quick-view-edit-metadata" @click="handleEditMetadata">
            <Pencil class="size-3.5" /> {{ t('podcast.actions.editEpisodeMetadata') }}
          </Button>
          <Button variant="ghost" size="sm" @click="handleOpenPlayer">
            <ExternalLink class="size-3.5" /> {{ t('podcast.actions.openFullPlayer') }}
          </Button>
        </div>

        <section v-if="safeDescription" class="mt-5">
          <h3 class="text-sm font-semibold">{{ t('podcast.fullPlayer.aboutEpisode') }}</h3>
          <div
            class="mt-2 break-words text-sm leading-6 text-muted-foreground [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_p+p]:mt-3"
            v-html="safeDescription"
          />
        </section>

        <section v-if="detail.chapters.length > 0" class="mt-5 border-t border-border pt-4">
          <h3 class="text-sm font-semibold">
            {{ t('podcast.fullPlayer.chapters') }}
            <span class="ms-1 text-xs font-normal text-muted-foreground">{{ formatNumber(detail.chapters.length) }}</span>
          </h3>
        </section>

        <section v-if="detail.transcripts.length > 0" class="mt-5 border-t border-border pt-4">
          <h3 class="text-sm font-semibold">{{ t('podcast.fullPlayer.transcripts') }}</h3>
          <div class="mt-2 flex flex-col gap-1">
            <a
              v-for="(transcript, index) in detail.transcripts"
              :key="`${transcript.url}:${index}`"
              :href="transcript.url"
              target="_blank"
              rel="noreferrer"
              class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-primary outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            >
              <ExternalLink class="size-3.5 shrink-0" />
              <span class="truncate">{{ transcript.language || t('podcast.fullPlayer.transcript') }}</span>
              <span v-if="transcript.type" class="ms-auto shrink-0 text-xs text-muted-foreground">{{ transcript.type }}</span>
            </a>
          </div>
        </section>
      </div>
    </SheetContent>
  </Sheet>
</template>
