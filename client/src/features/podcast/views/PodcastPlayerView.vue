<script setup lang="ts">
import { computed, onScopeDispose, provide, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useResizeObserver } from '@vueuse/core'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  Keyboard,
  ListMusic,
  LoaderCircle,
  Minus,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Timer,
  Trash2,
  Wifi,
  WifiOff,
} from '@lucide/vue'
import DOMPurify from 'dompurify'
import { toast } from 'vue-sonner'
import { Permission, type PodcastChapter } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { formatNumber } from '@/i18n/formatters'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import MediaScrubber from '@/components/media/MediaScrubber.vue'
import MediaTransport from '@/components/media/MediaTransport.vue'
import MediaVolumeControl from '@/components/media/MediaVolumeControl.vue'
import type { MediaScrubberMarker, MediaScrubberTooltip } from '@/components/media/types'
import PodcastArtwork from '../components/PodcastArtwork.vue'
import PodcastBookmarksPanel from '../components/PodcastBookmarksPanel.vue'
import PodcastQueueList from '../components/PodcastQueueList.vue'
import { formatPlaybackClock, formatPodcastDate, formatPodcastDuration } from '../lib/podcast-format'
import { formatBytes } from '@/lib/formatting'
import { PLAYBACK_RATES } from '../lib/podcast-playback-rates'
import { usePodcastPlayer } from '../composables/usePodcastPlayer'
import { SLEEP_EXTEND_MINUTES, usePodcastPlayerDisplay } from '../composables/usePodcastPlayerDisplay'
import { usePodcastAnnouncer } from '../composables/usePodcastAnnouncer'
import { usePodcastShortcuts } from '../composables/usePodcastShortcuts'
import { PODCAST_EPISODE_ACTIONS, usePodcastEpisodeListActions } from '../composables/usePodcastEpisodeListActions'

const SLEEP_MINUTES = [5, 15, 30, 45, 60]
const TIME_DISPLAY_STORAGE_KEY = 'bookorbit:podcast-time-display'
const BOOKMARK_MARKER_LIMIT = 20

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { announce } = usePodcastAnnouncer()
const { openShortcuts } = usePodcastShortcuts()
const episodeId = computed(() => Number(route.params.episodeId))
const autoplay = computed(() => route.query.autoplay === '1')
const player = usePodcastPlayer()
const {
  playbackDuration,
  remainingDuration,
  isPlaybackPending,
  hasActiveSleepSetting,
  seekValueText,
  transportLabels,
  sleepLabel,
  extendSleepTimer,
} = usePodcastPlayerDisplay()
provide(PODCAST_EPISODE_ACTIONS, usePodcastEpisodeListActions())
const { hasPermission } = usePermissions()
const canDownload = computed(() => hasPermission(Permission.PodcastDownload))
const sanitizedDescription = computed(() => DOMPurify.sanitize(player.episode.value?.description ?? ''))
const descriptionExpanded = ref(false)
const descriptionBody = ref<HTMLElement | null>(null)
const descriptionOverflows = ref(false)
const chapterList = ref<HTMLElement | null>(null)
const timeDisplay = ref<'remaining' | 'total'>(readTimeDisplay())
const artworkSrc = computed(() => player.episode.value?.podcastImageUrl ?? null)
const playbackRateOptions = computed(() =>
  PLAYBACK_RATES.map((rate) => ({ rate, label: t('podcast.fullPlayer.speedValue', { rate: formatNumber(rate) }) })),
)
const sleepMinuteOptions = computed(() =>
  SLEEP_MINUTES.map((minutes) => ({ minutes, label: t('podcast.fullPlayer.sleepMinutes', { count: minutes }) })),
)
const scrubberMarkers = computed<MediaScrubberMarker[]>(() => [
  ...(player.episode.value?.chapters ?? []).map((chapter, index) => ({
    position: chapter.startSeconds,
    kind: 'chapter' as const,
    label: chapter.title,
    active: player.activeChapterIndex.value === index,
  })),
  ...player.bookmarks.value.slice(0, BOOKMARK_MARKER_LIMIT).map((bookmark) => ({
    position: bookmark.positionSeconds,
    kind: 'bookmark' as const,
    label: bookmark.title,
  })),
])
const seasonEpisodeLabel = computed(() => {
  const activeEpisode = player.episode.value
  if (!activeEpisode) return null
  if (activeEpisode.season && activeEpisode.episode) {
    return t('podcast.labels.seasonEpisode', { season: activeEpisode.season, episode: activeEpisode.episode })
  }
  if (activeEpisode.season) return t('podcast.labels.season', { season: activeEpisode.season })
  if (activeEpisode.episode) return t('podcast.labels.episode', { episode: activeEpisode.episode })
  return null
})
/**
 * Shows with dynamically inserted ads run materially longer than their feed claims: the scrubber
 * already runs on the loaded duration, so trusting the feed here would print two different lengths
 * for one episode on the same screen. The declared value is only the placeholder until load.
 */
const headerDurationSeconds = computed(() => player.duration.value || player.episode.value?.durationSeconds || 0)
const episodeTypeLabel = computed(() => {
  if (player.episode.value?.episodeType === 'trailer') return t('podcast.labels.episodeTypeTrailer')
  if (player.episode.value?.episodeType === 'bonus') return t('podcast.labels.episodeTypeBonus')
  return null
})
const remainingQueueCount = computed(() => {
  if (player.queuePosition.value === null) return player.queueTotal.value
  return Math.max(0, player.queueTotal.value - player.queuePosition.value - 1)
})
const nextQueuePosition = computed(() => (player.queuePosition.value === null ? null : player.queuePosition.value + 1))
const queueSummary = computed(() => {
  if (player.queuePosition.value !== null) {
    const position = player.queuePosition.value + 1
    return t('podcast.fullPlayer.queueNowPlaying', { position, count: remainingQueueCount.value })
  }
  return t('podcast.fullPlayer.queuedCount', { count: player.queueTotal.value })
})
const mediaStatusLabel = computed(() => {
  const status = player.episode.value?.mediaStatus
  if (status === 'local') return t('podcast.status.downloaded')
  if (status === 'queued') return t('podcast.status.downloadQueued')
  if (status === 'downloading') return t('podcast.status.downloading')
  if (status === 'failed') return t('podcast.status.downloadFailed')
  if (status === 'unavailable') return t('podcast.fullPlayer.mediaUnavailable')
  return t('podcast.fullPlayer.streaming')
})
/** Borderless tint: the chip reports state, so it must not read as another button in the action row. */
const mediaStatusClasses = computed(() => {
  const status = player.episode.value?.mediaStatus
  if (status === 'local') return 'bg-success/10 text-success'
  if (status === 'queued') return 'bg-warning/10 text-warning'
  if (status === 'downloading') return 'bg-info/10 text-info'
  if (status === 'failed' || status === 'unavailable') return 'bg-destructive/10 text-destructive'
  return 'bg-muted text-muted-foreground'
})
const canRestart = computed(() => player.currentTime.value > 0 || Boolean(player.episode.value?.finished))
const canQueueDownload = computed(() => canDownload.value && ['remote', 'failed'].includes(player.episode.value?.mediaStatus ?? ''))
// A local episode holds the user's own file rather than a cached copy, so there is no download to
// give back. Offering the action here would put a delete of their archive one click away.
const canRemoveDownload = computed(
  () => canDownload.value && player.episode.value?.mediaStatus === 'local' && player.episode.value.origin !== 'local',
)

watch(
  [episodeId, autoplay],
  ([id, shouldAutoplay]) => {
    // Navigating away drops the route param while this watcher is still live, and the resulting
    // NaN would push a not-found error into the shared player that the mini player then renders.
    if (!Number.isInteger(id)) return
    // Advancing the queue replaces the URL, so this watcher also sees the player's own change.
    // Re-loading the episode already loaded would spend a second context fetch to learn nothing;
    // an explicit autoplay still goes through, since that has to reach a paused player.
    if (player.episode.value?.id === id && !shouldAutoplay) return
    descriptionExpanded.value = false
    void player.loadEpisode(id, shouldAutoplay)
  },
  { immediate: true },
)

watch([() => player.activeChapterIndex.value, chapterList], ([index]) => scrollChapterIntoView(index), { flush: 'post' })

watch([sanitizedDescription, descriptionBody], measureDescriptionOverflow, { flush: 'post' })

// Width changes rewrap the text, so the clamped height can start or stop clipping without the content changing.
useResizeObserver(descriptionBody, measureDescriptionOverflow)

const unsubscribeFromEpisodeChanges = player.subscribeToEpisodeChanges((id) => {
  if (id !== episodeId.value) void router.replace({ name: 'podcast-player', params: { episodeId: id } })
})

onScopeDispose(unsubscribeFromEpisodeChanges)

function goBack() {
  const episode = player.episode.value
  if (episode) void router.push({ name: 'podcast-show', params: { podcastId: episode.podcastId } })
  else void router.back()
}

function readTimeDisplay(): 'remaining' | 'total' {
  return globalThis.localStorage?.getItem(TIME_DISPLAY_STORAGE_KEY) === 'total' ? 'total' : 'remaining'
}

function selectPlaybackRate(rate: number) {
  player.setPlaybackRate(rate)
}

function decreasePlaybackRate() {
  player.setPlaybackRate(Math.max(0.5, Math.round((player.playbackRate.value - 0.05) * 100) / 100))
}

function increasePlaybackRate() {
  player.setPlaybackRate(Math.min(3, Math.round((player.playbackRate.value + 0.05) * 100) / 100))
}

function setSleepMinutes(minutes: number) {
  player.setSleepTimer(minutes)
}

function setSleepAtChapterEnd() {
  player.setSleepAtEnd('chapter')
}

function setSleepAtEpisodeEnd() {
  player.setSleepAtEnd('episode')
}

function clearSleepTimer() {
  player.clearSleepTimer()
}

function setVolume(value: number) {
  player.setVolume(value)
}

function toggleMute() {
  player.toggleMute()
}

function seekBackward() {
  player.skipBackward()
}

function seekForward() {
  player.skipForward()
}

function seekChapter(chapter: PodcastChapter) {
  player.seekTo(chapter.startSeconds)
}

function scrollChapterIntoView(index: number) {
  const list = chapterList.value
  if (!list || index < 0) return
  const target = list.querySelector<HTMLElement>(`[data-chapter-index="${index}"]`)
  if (!target) return
  const behavior: ScrollBehavior = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
  if (target.offsetTop < list.scrollTop) list.scrollTo({ top: target.offsetTop, behavior })
  else if (target.offsetTop + target.offsetHeight > list.scrollTop + list.clientHeight) {
    list.scrollTo({ top: target.offsetTop + target.offsetHeight - list.clientHeight, behavior })
  }
}

function toggleTimeDisplay() {
  timeDisplay.value = timeDisplay.value === 'remaining' ? 'total' : 'remaining'
  globalThis.localStorage?.setItem(TIME_DISPLAY_STORAGE_KEY, timeDisplay.value)
}

function chapterAt(seconds: number): PodcastChapter | null {
  const chapters = player.episode.value?.chapters ?? []
  for (let index = chapters.length - 1; index >= 0; index--) {
    const chapter = chapters[index]!
    if (seconds >= chapter.startSeconds) return chapter
  }
  return null
}

function scrubberTooltip(seconds: number): MediaScrubberTooltip {
  const primary = formatPlaybackClock(seconds)
  const bookmark = player.bookmarks.value.find((item) => Math.abs(item.positionSeconds - seconds) <= Math.max(2, playbackDuration.value * 0.0025))
  if (bookmark) return { primary, secondary: t('podcast.fullPlayer.bookmarkTooltip', { title: bookmark.title }) }
  return { primary, secondary: chapterAt(seconds)?.title }
}

function chapterDuration(chapter: PodcastChapter, index: number): number {
  const chapters = player.episode.value?.chapters ?? []
  const end = chapter.endSeconds ?? chapters[index + 1]?.startSeconds ?? playbackDuration.value
  return Math.max(0, end - chapter.startSeconds)
}

function chapterProgress(index: number): number {
  if (player.activeChapterIndex.value !== index) return 0
  const chapter = player.episode.value?.chapters[index]
  if (!chapter) return 0
  const duration = chapterDuration(chapter, index)
  if (duration <= 0) return 0
  return Math.min(100, Math.max(0, ((player.currentTime.value - chapter.startSeconds) / duration) * 100))
}

function openQueue() {
  const activeEpisode = player.episode.value
  if (!activeEpisode) return
  void router.push({ name: 'podcast-library', params: { id: activeEpisode.libraryId }, query: { view: 'queue' } })
}

async function markPlayed() {
  try {
    await player.markPlayed()
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.markPlayed'))
  }
}

async function restartEpisode() {
  try {
    await player.restartEpisode()
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.restartEpisode'))
  }
}

async function togglePinnedEpisode() {
  try {
    await player.togglePinned()
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.updatePinned'))
  }
}

async function requestDownload() {
  try {
    await player.requestDownload()
    toast.success(t('podcast.messages.downloadQueued'))
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.queueDownload'))
  }
}

async function removeDownload() {
  try {
    await player.removeDownload()
    toast.success(t('podcast.messages.downloadRemoved'))
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.removeDownload'))
  }
}

async function addCurrentEpisodeToQueue() {
  const activeEpisode = player.episode.value
  if (!activeEpisode) return
  try {
    await player.addToQueue()
    void announce(t('podcast.announce.queued', { title: activeEpisode.title }))
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.addToQueue'))
  }
}

async function removeQueueItem(episodeId: number, title: string) {
  try {
    await player.removeFromQueue(episodeId)
    void announce(t('podcast.announce.unqueued', { title }))
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.removeFromQueue'))
  }
}

async function removeCurrentEpisodeFromQueue() {
  const activeEpisode = player.episode.value
  if (!activeEpisode) return
  await removeQueueItem(activeEpisode.id, activeEpisode.title)
}

function toggleDescription() {
  descriptionExpanded.value = !descriptionExpanded.value
}

/** Only meaningful while clamped; expanding removes the clamp, so the last collapsed measurement is what keeps the toggle visible. */
function measureDescriptionOverflow() {
  const body = descriptionBody.value
  if (!body || descriptionExpanded.value) return
  descriptionOverflows.value = body.scrollHeight > body.clientHeight + 1
}

async function retryEpisode() {
  await player.loadEpisode(episodeId.value, false)
}
</script>

<template>
  <main class="min-h-full px-3 pb-20 sm:px-5 lg:px-8">
    <div class="mx-auto w-full max-w-[86rem]">
      <Button variant="ghost" size="sm" class="-ml-2 mt-5 gap-1.5 text-muted-foreground hover:text-foreground" @click="goBack">
        <ArrowLeft :size="15" /> {{ t('podcast.fullPlayer.backToPodcast') }}
      </Button>

      <div v-if="player.loading.value && !player.episode.value" class="mt-5" role="status" aria-live="polite">
        <span class="sr-only">{{ t('podcast.fullPlayer.loading') }}</span>
        <div class="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] 2xl:gap-7">
          <section class="overflow-hidden rounded-3xl border border-border bg-card">
            <div class="grid items-center gap-5 p-5 sm:p-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-7 lg:p-7">
              <Skeleton class="aspect-square w-full max-w-[13rem] rounded-2xl max-lg:mx-auto" />
              <div class="min-w-0 space-y-3">
                <Skeleton class="h-3 w-24" />
                <Skeleton class="h-4 w-40" />
                <Skeleton class="h-7 w-3/4" />
                <Skeleton class="h-4 w-48" />
                <div class="flex flex-wrap gap-2 pt-2">
                  <Skeleton v-for="index in 4" :key="index" class="h-8 w-28 rounded-lg" />
                </div>
              </div>
            </div>
            <div class="space-y-4 border-t border-border bg-muted/20 px-5 py-5 sm:px-6 lg:px-7">
              <Skeleton class="h-2 w-full rounded-full" />
              <div class="flex items-center justify-center gap-2">
                <Skeleton v-for="index in 4" :key="index" class="size-10 rounded-full" />
                <Skeleton class="size-14 rounded-full" />
              </div>
            </div>
          </section>
          <div class="space-y-4">
            <Skeleton v-for="index in 2" :key="index" class="h-40 w-full rounded-2xl" />
          </div>
        </div>
      </div>
      <!-- Only a failure that left us with no episode deserves the whole page. A stream that failed
           on an episode we did load still has a title, artwork and actions worth showing, and
           replacing them leaves the reader unable to tell which episode even broke. -->
      <div
        v-else-if="player.error.value && !player.episode.value"
        class="mx-auto mt-16 max-w-lg rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm text-destructive"
        role="alert"
      >
        <p>{{ player.error.value }}</p>
        <Button variant="outline" size="sm" class="mt-3 border-destructive/40 text-destructive hover:bg-destructive/10" @click="retryEpisode">
          {{ t('podcast.fullPlayer.tryAgain') }}
        </Button>
      </div>

      <div v-else-if="player.episode.value" class="mt-5 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_21rem] 2xl:gap-7">
        <section class="relative min-w-0 overflow-hidden rounded-3xl border border-border bg-card shadow-[var(--elevation-md)]">
          <img
            v-if="artworkSrc"
            :src="artworkSrc"
            alt=""
            class="absolute inset-0 h-full w-full scale-125 object-cover blur-3xl transition-opacity duration-700 motion-reduce:transition-none"
            :class="player.isPlaying.value ? 'opacity-35' : 'opacity-15'"
            aria-hidden="true"
          />
          <div class="absolute inset-0 bg-card/80" aria-hidden="true" />

          <div class="relative grid items-center gap-5 p-5 sm:p-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-7 lg:p-7">
            <div class="aspect-square w-full max-w-[13rem] overflow-hidden rounded-2xl bg-muted shadow-[var(--elevation-lg)] max-lg:mx-auto">
              <PodcastArtwork :src="artworkSrc" :reset-key="player.episode.value?.podcastId ?? null" class="h-full w-full" icon-class="h-12 w-12" />
            </div>

            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{{ t('podcast.fullPlayer.nowListening') }}</p>
              <p class="mt-2 truncate text-sm font-medium text-muted-foreground">{{ player.episode.value.podcastTitle }}</p>
              <h1 class="mt-1.5 max-w-3xl text-balance font-serif text-xl font-semibold leading-tight tracking-tight sm:text-2xl 2xl:text-3xl">
                {{ player.episode.value.title }}
              </h1>
              <p v-if="player.episode.value.subtitle" class="mt-2 line-clamp-2 text-sm text-muted-foreground">
                {{ player.episode.value.subtitle }}
              </p>
              <p v-if="seasonEpisodeLabel" class="mt-2 text-sm font-medium text-foreground">{{ seasonEpisodeLabel }}</p>
              <div class="mt-3 flex flex-wrap items-center gap-2 text-sm tabular-nums text-muted-foreground">
                <span>{{ formatPodcastDate(player.episode.value.publishedAt) }}</span>
                <span aria-hidden="true">·</span>
                <span>{{ formatPodcastDuration(headerDurationSeconds) }}</span>
                <Badge v-if="episodeTypeLabel" variant="secondary">{{ episodeTypeLabel }}</Badge>
              </div>

              <div
                v-if="player.error.value"
                class="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="alert"
                data-testid="podcast-full-player-error"
              >
                <p class="min-w-0">{{ player.error.value }}</p>
                <Button
                  variant="outline"
                  size="sm"
                  class="ml-auto shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                  @click="retryEpisode"
                >
                  {{ t('podcast.fullPlayer.tryAgain') }}
                </Button>
              </div>

              <div class="mt-5 flex flex-wrap items-center gap-2" data-testid="podcast-episode-actions">
                <span class="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium" :class="mediaStatusClasses">
                  <CheckCircle2 v-if="player.episode.value.mediaStatus === 'local'" class="h-3.5 w-3.5" />
                  <Clock3 v-else-if="player.episode.value.mediaStatus === 'queued'" class="h-3.5 w-3.5" />
                  <LoaderCircle
                    v-else-if="player.episode.value.mediaStatus === 'downloading'"
                    class="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                  />
                  <AlertCircle v-else-if="player.episode.value.mediaStatus === 'failed'" class="h-3.5 w-3.5" />
                  <WifiOff v-else-if="player.episode.value.mediaStatus === 'unavailable'" class="h-3.5 w-3.5" />
                  <Wifi v-else class="h-3.5 w-3.5" />
                  {{ mediaStatusLabel }}
                  <template v-if="player.episode.value.localSizeBytes"> · {{ formatBytes(player.episode.value.localSizeBytes) }}</template>
                </span>

                <Button v-if="!player.episode.value.finished" type="button" @click="markPlayed">
                  <Check class="size-4" /> {{ t('podcast.actions.markPlayed') }}
                </Button>

                <span class="inline-flex items-center gap-2">
                  <Button v-if="player.episode.value.queued" type="button" variant="outline" @click="removeCurrentEpisodeFromQueue">
                    <ListMusic class="size-4" /> {{ t('podcast.actions.removeFromQueue') }}
                  </Button>
                  <Button v-else type="button" variant="outline" @click="addCurrentEpisodeToQueue">
                    <ListMusic class="size-4" /> {{ t('podcast.actions.addToQueue') }}
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger as-child>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        class="text-muted-foreground hover:text-foreground"
                        :aria-label="t('podcast.actions.episodeActions')"
                      >
                        <MoreHorizontal :size="18" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" class="w-56">
                      <DropdownMenuItem v-if="canQueueDownload" @click="requestDownload">
                        <Download />
                        {{ player.episode.value.mediaStatus === 'failed' ? t('podcast.fullPlayer.retry') : t('podcast.actions.download') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem v-if="canRemoveDownload" @click="removeDownload">
                        <Trash2 />
                        {{ t('podcast.actions.removeDownload') }}
                      </DropdownMenuItem>
                      <DropdownMenuItem @click="togglePinnedEpisode">
                        <PinOff v-if="player.episode.value.pinned" />
                        <Pin v-else />
                        {{ player.episode.value.pinned ? t('podcast.actions.unpin') : t('podcast.actions.pin') }}
                      </DropdownMenuItem>
                      <template v-if="canRestart">
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" @click="restartEpisode">
                          <RotateCcw />
                          {{ t('podcast.fullPlayer.restart') }}
                        </DropdownMenuItem>
                      </template>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </div>
            </div>
          </div>

          <div class="relative border-t border-border bg-muted/20 px-5 py-5 sm:px-6 lg:px-7">
            <div class="flex items-center gap-3 text-xs font-medium tabular-nums text-muted-foreground">
              <span class="shrink-0">{{ formatPlaybackClock(player.currentTime.value) }}</span>
              <MediaScrubber
                class="min-w-0 flex-1"
                :current="player.currentTime.value"
                :duration="playbackDuration"
                :buffered="player.bufferedRanges.value"
                :markers="scrubberMarkers"
                :ariaLabel="t('podcast.player.episodePosition')"
                :ariaValueText="seekValueText"
                :tooltip="scrubberTooltip"
                @seek="player.seekTo"
              />
              <Button
                v-if="playbackDuration"
                type="button"
                variant="ghost"
                size="sm"
                class="h-8 shrink-0 px-2 tabular-nums text-muted-foreground hover:text-foreground"
                :aria-label="t('podcast.player.toggleTimeDisplay')"
                @click="toggleTimeDisplay"
              >
                <template v-if="timeDisplay === 'remaining'">{{
                  t('podcast.labels.remainingClock', { time: formatPlaybackClock(remainingDuration) })
                }}</template>
                <template v-else>{{ formatPlaybackClock(playbackDuration) }}</template>
              </Button>
              <span v-else class="shrink-0">{{ t('podcast.labels.durationUnavailable') }}</span>
            </div>

            <div class="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <MediaTransport
                size="lg"
                pulse
                :playing="player.isPlaying.value"
                :pending="isPlaybackPending"
                :has-previous="Boolean(player.previousQueueItem.value)"
                :has-next="Boolean(player.nextQueueItem.value)"
                :skip-back-seconds="player.skipBackwardSeconds.value"
                :skip-forward-seconds="player.skipForwardSeconds.value"
                :labels="transportLabels"
                @toggle="player.togglePlayback"
                @previous="player.playPrevious"
                @next="player.playNext"
                @skip-back="seekBackward"
                @skip-forward="seekForward"
              />

              <div class="flex flex-wrap items-center justify-center gap-1 sm:justify-end">
                <Popover>
                  <PopoverTrigger as-child>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      class="h-9 gap-1.5 font-semibold tabular-nums text-muted-foreground hover:text-foreground"
                      :aria-label="t('podcast.fullPlayer.choosePlaybackSpeed')"
                    >
                      <span class="font-normal">{{ t('podcast.fullPlayer.speed') }}</span>
                      {{ t('podcast.fullPlayer.speedValue', { rate: formatNumber(player.playbackRate.value) }) }}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" class="w-64 p-2">
                    <p class="px-2 pb-1.5 text-xs font-semibold text-foreground">{{ t('podcast.fullPlayer.playbackSpeed') }}</p>
                    <div class="grid grid-cols-3 gap-1">
                      <button
                        v-for="option in playbackRateOptions"
                        :key="option.rate"
                        type="button"
                        class="h-9 rounded-lg text-xs font-medium tabular-nums hover:bg-muted outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                        :class="player.playbackRate.value === option.rate ? 'bg-primary/10 text-primary' : 'text-foreground'"
                        @click="selectPlaybackRate(option.rate)"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                    <div class="mt-2 flex items-center justify-between border-t border-border px-2 pt-2">
                      <span class="text-xs text-muted-foreground">{{ t('podcast.fullPlayer.fineTuneSpeed') }}</span>
                      <div class="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          :disabled="player.playbackRate.value <= 0.5"
                          :aria-label="t('podcast.fullPlayer.decreaseSpeed')"
                          @click="decreasePlaybackRate"
                        >
                          <Minus :size="14" />
                        </Button>
                        <span class="w-12 text-center text-xs font-semibold tabular-nums">
                          {{ t('podcast.fullPlayer.speedValue', { rate: formatNumber(player.playbackRate.value) }) }}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          :disabled="player.playbackRate.value >= 3"
                          :aria-label="t('podcast.fullPlayer.increaseSpeed')"
                          @click="increasePlaybackRate"
                        >
                          <Plus :size="14" />
                        </Button>
                      </div>
                    </div>
                    <div v-if="player.hasPlaybackRateOverride.value" class="mt-2 border-t border-border pt-2">
                      <p class="px-2 text-[11px] text-muted-foreground">{{ t('podcast.fullPlayer.showSpeedOverride') }}</p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="mt-1 w-full justify-start text-primary hover:bg-primary/10 hover:text-primary"
                        @click="player.clearPlaybackRateOverride"
                      >
                        {{ t('podcast.fullPlayer.clearSpeedOverride') }}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger as-child>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      class="h-9 gap-1.5"
                      :class="hasActiveSleepSetting ? 'text-warning hover:text-warning' : 'text-muted-foreground hover:text-foreground'"
                      :aria-label="t('podcast.fullPlayer.sleepTimer')"
                    >
                      <Timer :size="16" />
                      <span>{{ sleepLabel }}</span>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" class="w-60 p-2">
                    <p class="px-2 pb-1.5 text-xs font-semibold text-foreground">{{ t('podcast.fullPlayer.sleepTimer') }}</p>
                    <div class="space-y-1">
                      <Button
                        v-for="option in sleepMinuteOptions"
                        :key="option.minutes"
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start"
                        @click="setSleepMinutes(option.minutes)"
                      >
                        {{ option.label }}
                      </Button>
                      <Button
                        v-if="player.episode.value.chapters.length > 0"
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start"
                        @click="setSleepAtChapterEnd"
                      >
                        {{ t('podcast.fullPlayer.endOfChapter') }}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" class="w-full justify-start" @click="setSleepAtEpisodeEnd">
                        {{ t('podcast.fullPlayer.endOfEpisode') }}
                      </Button>
                      <Button
                        v-if="player.sleepRemainingSeconds.value !== null"
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start"
                        :aria-label="t('podcast.fullPlayer.extendSleepLabel', { count: SLEEP_EXTEND_MINUTES })"
                        @click="extendSleepTimer"
                      >
                        <Plus class="size-3.5" />
                        {{ t('podcast.fullPlayer.extendSleep', { count: SLEEP_EXTEND_MINUTES }) }}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        class="w-full justify-start"
                        :class="!hasActiveSleepSetting ? 'text-primary' : ''"
                        @click="clearSleepTimer"
                      >
                        {{ t('podcast.fullPlayer.off') }}
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                <span v-if="player.sleepRemainingSeconds.value !== null" class="sr-only" role="status" data-testid="podcast-sleep-remaining">
                  {{ sleepLabel }}
                </span>
                <MediaVolumeControl
                  class="hidden w-44 xl:flex"
                  variant="inline"
                  :volume="player.volume.value"
                  @update:volume="setVolume"
                  @toggle-mute="toggleMute"
                />
                <!-- The popover variant's root is a renderless Popover, so responsive classes must sit on a wrapper. -->
                <span class="inline-flex xl:hidden">
                  <MediaVolumeControl variant="popover" :volume="player.volume.value" @update:volume="setVolume" @toggle-mute="toggleMute" />
                </span>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      class="rounded-full text-muted-foreground hover:text-foreground"
                      :aria-label="t('podcast.shortcuts.open')"
                      @click="openShortcuts"
                    >
                      <Keyboard :size="16" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ t('podcast.shortcuts.open') }}</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </section>

        <section
          v-if="sanitizedDescription"
          class="rounded-3xl border border-border bg-card px-5 py-6 shadow-[var(--elevation-xs)] sm:px-7 sm:py-7 xl:col-start-1"
        >
          <h2 class="font-serif text-xl font-semibold tracking-tight">{{ t('podcast.fullPlayer.aboutEpisode') }}</h2>
          <div class="relative">
            <div
              id="podcast-episode-description"
              ref="descriptionBody"
              class="prose mt-4 max-w-3xl text-sm leading-6 text-muted-foreground"
              :class="descriptionExpanded ? '' : 'max-h-44 overflow-hidden'"
              v-html="sanitizedDescription"
            />
            <div
              v-if="!descriptionExpanded && descriptionOverflows"
              class="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-linear-to-t from-card to-transparent"
              aria-hidden="true"
            />
          </div>
          <Button
            v-if="descriptionOverflows"
            type="button"
            variant="ghost"
            class="mt-2 w-full"
            :aria-expanded="descriptionExpanded"
            aria-controls="podcast-episode-description"
            @click="toggleDescription"
          >
            {{ descriptionExpanded ? t('podcast.fullPlayer.showLess') : t('podcast.fullPlayer.showMore') }}
          </Button>
        </section>

        <aside class="flex flex-col gap-4 xl:sticky xl:top-5 xl:col-start-2 xl:row-start-1 xl:row-span-2">
          <section class="rounded-2xl border border-border bg-card shadow-[var(--elevation-xs)]">
            <header class="flex items-center justify-between gap-3 px-4 py-3.5">
              <div class="flex min-w-0 items-center gap-2.5">
                <ListMusic class="h-4 w-4 shrink-0 text-muted-foreground" />
                <div class="min-w-0">
                  <h2 class="font-serif text-base font-semibold">{{ t('podcast.library.upNext') }}</h2>
                  <p v-if="player.queueTotal.value" class="text-xs tabular-nums text-muted-foreground">{{ queueSummary }}</p>
                </div>
              </div>
              <!-- Styled as a link but standing alone rather than inside a sentence, so it gets no
                   inline-target exemption and its 20px text height was the whole hit area. The
                   padding reaches into the header's own, and the matching negative margin keeps the
                   text exactly where it was, so the target grows without anything moving. -->
              <Button type="button" variant="link" size="sm" class="-my-2 h-auto shrink-0 px-0 py-2" @click="openQueue">
                {{ t('podcast.fullPlayer.openQueue') }}
              </Button>
            </header>
            <PodcastQueueList
              v-if="player.upcomingQueueItems.value.length"
              class="border-t border-border p-2"
              density="compact"
              show-position
              :items="player.upcomingQueueItems.value"
              :next-position="nextQueuePosition"
              :active-episode-id="player.episode.value.id"
              :is-playing="player.isPlaying.value"
            />
            <p v-else class="border-t border-border px-4 py-4 text-sm leading-5 text-muted-foreground">{{ t('podcast.fullPlayer.queueClear') }}</p>
          </section>

          <section v-if="player.episode.value.chapters.length" class="rounded-2xl border border-border bg-card shadow-[var(--elevation-xs)]">
            <header class="flex items-center justify-between gap-3 px-4 py-3.5">
              <div class="flex items-center gap-2.5">
                <h2 class="font-serif text-base font-semibold">{{ t('podcast.fullPlayer.chapters') }}</h2>
                <Badge variant="secondary" class="text-[11px] tabular-nums">
                  {{ player.episode.value.chapters.length }}
                </Badge>
              </div>
              <div class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="text-muted-foreground hover:text-foreground"
                  :aria-label="t('podcast.fullPlayer.previousChapter')"
                  @click="player.previousChapter"
                >
                  <ChevronLeft :size="15" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="text-muted-foreground hover:text-foreground"
                  :aria-label="t('podcast.fullPlayer.nextChapter')"
                  @click="player.nextChapter"
                >
                  <ChevronRight :size="15" />
                </Button>
              </div>
            </header>
            <div ref="chapterList" class="relative max-h-72 overflow-y-auto border-t border-border p-2">
              <div
                v-for="(chapter, index) in player.episode.value.chapters"
                :key="`${chapter.startSeconds}:${chapter.title}`"
                class="relative flex items-center gap-1 overflow-hidden rounded-lg transition-colors hover:bg-muted"
                :class="player.activeChapterIndex.value === index ? 'bg-muted text-foreground' : ''"
                :aria-current="player.activeChapterIndex.value === index ? 'true' : undefined"
                :data-chapter-index="index"
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  @click="seekChapter(chapter)"
                >
                  <span class="line-clamp-2">{{ chapter.title }}</span>
                  <span class="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    <span class="block font-medium text-foreground">{{ formatPlaybackClock(chapter.startSeconds) }}</span>
                    <span class="block">{{ formatPlaybackClock(chapterDuration(chapter, index)) }}</span>
                  </span>
                </button>
                <a
                  v-if="chapter.url"
                  :href="chapter.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                  :aria-label="t('podcast.fullPlayer.openChapterLink', { title: chapter.title })"
                >
                  <ExternalLink :size="14" />
                </a>
                <span
                  v-if="player.activeChapterIndex.value === index"
                  class="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-primary"
                  :style="{ width: `${chapterProgress(index)}%` }"
                  aria-hidden="true"
                />
              </div>
            </div>
          </section>

          <PodcastBookmarksPanel />

          <section v-if="player.episode.value.transcripts.length" class="rounded-2xl border border-border bg-card shadow-[var(--elevation-xs)]">
            <header class="flex items-center gap-2.5 px-4 py-3.5">
              <FileText class="h-4 w-4 text-muted-foreground" />
              <h2 class="font-serif text-base font-semibold">{{ t('podcast.fullPlayer.transcripts') }}</h2>
            </header>
            <div class="space-y-1 border-t border-border p-2">
              <a
                v-for="(transcript, index) in player.episode.value.transcripts"
                :key="`${transcript.url}:${index}`"
                :href="transcript.url"
                target="_blank"
                rel="noopener noreferrer"
                class="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm hover:bg-muted outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              >
                <span>
                  {{ transcript.language || t('podcast.fullPlayer.transcript') }}
                  <span v-if="transcript.type" class="ml-1 text-xs text-muted-foreground">{{ transcript.type }}</span>
                </span>
                <ExternalLink class="h-4 w-4 shrink-0 text-muted-foreground" />
              </a>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </main>
</template>
