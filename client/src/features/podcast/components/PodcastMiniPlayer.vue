<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useMediaQuery } from '@vueuse/core'
import { ChevronDown, ListMusic, LoaderCircle, Maximize2, Pause, Play, Timer, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import MediaScrubber from '@/components/media/MediaScrubber.vue'
import MediaTransport from '@/components/media/MediaTransport.vue'
import MediaVolumeControl from '@/components/media/MediaVolumeControl.vue'
import { formatNumber } from '@/i18n/formatters'
import PodcastArtwork from './PodcastArtwork.vue'
import PodcastQueueList from './PodcastQueueList.vue'
import { usePodcastPlayer } from '../composables/usePodcastPlayer'
import { SLEEP_EXTEND_MINUTES, usePodcastPlayerDisplay } from '../composables/usePodcastPlayerDisplay'
import { PODCAST_EPISODE_ACTIONS, usePodcastEpisodeListActions } from '../composables/usePodcastEpisodeListActions'
import { formatPlaybackClock } from '../lib/podcast-format'
import { shouldShowPodcastMiniPlayer } from '../lib/podcast-player-visibility'

type PlayerMode = 'expanded' | 'compact'

const STORAGE_KEY = 'bookorbit:podcast-mini-player-mode'
const COMPACT_BY_DEFAULT_QUERY = '(max-width: 767px)'
const CLEARANCE_CSS_VAR = '--podcast-mini-player-clearance'
const MIN_CLEARANCE_GAP_PX = 12

const router = useRouter()
const route = useRoute()
const player = usePodcastPlayer()
provide(PODCAST_EPISODE_ACTIONS, usePodcastEpisodeListActions())
const { t } = useI18n()
const {
  activeEpisode,
  playbackDuration,
  remainingDuration,
  isPlaybackPending,
  hasActiveSleepSetting,
  seekValueText,
  transportLabels,
  sleepStatusLabel,
  extendSleepTimer,
} = usePodcastPlayerDisplay()
const isVisible = computed(() => shouldShowPodcastMiniPlayer(route, Boolean(activeEpisode.value)))
const prefersCompact = useMediaQuery(COMPACT_BY_DEFAULT_QUERY)
const storedMode = ref<PlayerMode | null>(readStoredMode())
// Without a stored preference the mode follows the viewport, so a resize or rotation re-derives it.
const isCompact = computed(() => (storedMode.value === null ? prefersCompact.value : storedMode.value === 'compact'))
const showQueue = ref(false)
const playbackRateLabel = computed(() =>
  t('podcast.fullPlayer.speedValue', {
    rate: formatNumber(player.playbackRate.value),
  }),
)
const sleepAriaLabel = computed(() => t('podcast.player.sleepActive', { value: sleepStatusLabel.value }))
const playbackAnnouncement = computed(() => {
  const episode = player.episode.value
  if (!episode) return ''
  const key = player.isPlaying.value ? 'playingAnnouncement' : 'pausedAnnouncement'
  return t(`podcast.player.${key}`, { title: episode.title, podcast: episode.podcastTitle })
})
const compactBufferedSegments = computed(() => {
  const duration = playbackDuration.value
  if (duration <= 0) return []
  return player.bufferedRanges.value
    .map((range) => {
      const start = Math.min(100, Math.max(0, (range.start / duration) * 100))
      const end = Math.min(100, Math.max(0, (range.end / duration) * 100))
      return { start, end }
    })
    .filter((range) => range.end > range.start)
})
const rootRef = ref<HTMLElement | null>(null)

let resizeObserver: ResizeObserver | null = null

function readStoredMode(): PlayerMode | null {
  try {
    const mode = localStorage.getItem(STORAGE_KEY)
    return mode === 'expanded' || mode === 'compact' ? mode : null
  } catch {
    return null
  }
}

function selectMode(mode: PlayerMode) {
  storedMode.value = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    return
  }
}

function collapsePlayer() {
  selectMode('compact')
}

function expandPlayer() {
  selectMode('expanded')
}

/**
 * Publishes the player's occupied height so scrollable content and floating surfaces can clear it.
 * Measured rather than estimated: the height changes with mode, the queue disclosure and error state.
 */
function setClearance(pixels: number) {
  if (typeof document === 'undefined') return
  const clamped = Number.isFinite(pixels) ? Math.max(0, Math.ceil(pixels)) : 0
  document.documentElement.style.setProperty(CLEARANCE_CSS_VAR, `${clamped}px`)
}

function updateClearance() {
  if (typeof window === 'undefined') return
  const root = rootRef.value
  if (!root || !isVisible.value) {
    setClearance(0)
    return
  }
  const rect = root.getBoundingClientRect()
  if (rect.height <= 0 || rect.width <= 0) {
    setClearance(0)
    return
  }
  setClearance(window.innerHeight - rect.top + MIN_CLEARANCE_GAP_PX)
}

function attachResizeObserver() {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (typeof ResizeObserver === 'undefined' || !rootRef.value) return
  resizeObserver = new ResizeObserver(updateClearance)
  resizeObserver.observe(rootRef.value)
}

onMounted(() => {
  if (typeof window !== 'undefined') window.addEventListener('resize', updateClearance)

  watch(
    rootRef,
    () => {
      attachResizeObserver()
      void nextTick(updateClearance)
    },
    { immediate: true },
  )
})

onUnmounted(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (typeof window !== 'undefined') window.removeEventListener('resize', updateClearance)
  setClearance(0)
})

function openPlayer() {
  const episode = player.episode.value
  if (!episode) return
  void router.push({ name: 'podcast-player', params: { episodeId: episode.id } })
}

async function closePlayer() {
  const episodeId = activeEpisode.value?.id
  if (!episodeId) return
  await player.clearPlayer()
  toast.success(t('podcast.messages.playerClosed'), {
    action: {
      label: t('common.undo'),
      onClick: () => void player.loadEpisode(episodeId, false),
    },
  })
}

function toggleQueue() {
  showQueue.value = !showQueue.value
}

function retryPlayback() {
  const episode = activeEpisode.value
  if (episode) void player.playInline(episode.id)
}
</script>

<template>
  <section
    v-if="isVisible && activeEpisode"
    ref="rootRef"
    class="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 overflow-hidden border border-border bg-card/95 shadow-[var(--elevation-xl)] backdrop-blur"
    :class="isCompact ? 'rounded-full md:inset-x-auto md:right-6 md:w-80' : 'rounded-2xl md:inset-x-auto md:right-6 md:w-[28rem]'"
    :aria-label="t('podcast.player.miniPlayer')"
    data-podcast-mini-player
  >
    <!-- Tracks the play state as well as the episode: bound to the title alone it read "Playing"
         while paused, and pausing or resuming announced nothing at all. -->
    <p class="sr-only" aria-live="polite">
      {{ playbackAnnouncement }}
    </p>
    <template v-if="isCompact">
      <div data-testid="podcast-super-mini-player" class="flex h-14 items-center gap-2 px-2">
        <button
          class="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-muted outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          :aria-label="t('podcast.player.openFullPlayer')"
          @click="openPlayer"
        >
          <PodcastArtwork
            :src="activeEpisode?.podcastImageUrl"
            :reset-key="activeEpisode?.podcastId ?? null"
            class="h-full w-full"
            icon-class="w-5"
          />
        </button>
        <button
          class="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          :aria-label="t('podcast.player.openFullPlayer')"
          @click="openPlayer"
        >
          <span class="block truncate text-xs font-medium text-muted-foreground">{{ activeEpisode.podcastTitle }}</span>
          <span class="block truncate text-sm font-semibold text-foreground">{{ activeEpisode.title }}</span>
        </button>
        <span class="hidden text-xs tabular-nums text-muted-foreground sm:inline">{{ formatPlaybackClock(player.currentTime.value) }}</span>
        <Button
          size="icon-lg"
          class="shrink-0 rounded-full shadow-[var(--elevation-xs)]"
          :aria-label="player.isPlaying.value ? t('podcast.actions.pause') : t('podcast.actions.play')"
          @click="player.togglePlayback"
        >
          <LoaderCircle v-if="isPlaybackPending" class="size-4 animate-spin motion-reduce:animate-none" />
          <Pause v-else-if="player.isPlaying.value" class="size-4 fill-current" />
          <Play v-else class="ml-0.5 size-4 fill-current" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
          :aria-label="t('podcast.player.expandMiniPlayer')"
          @click="expandPlayer"
        >
          <Maximize2 :size="16" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="shrink-0 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          :aria-label="t('podcast.player.stopAndClose')"
          @click="closePlayer"
        >
          <X :size="16" />
        </Button>
      </div>
      <div
        v-if="playbackDuration"
        dir="ltr"
        class="relative h-1 overflow-hidden bg-muted"
        role="progressbar"
        :aria-label="t('podcast.player.episodePosition')"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="Math.round(player.progressPercent.value)"
        :aria-valuetext="seekValueText"
      >
        <div
          v-for="range in compactBufferedSegments"
          :key="`${range.start}-${range.end}`"
          class="absolute inset-y-0 bg-primary/25"
          :style="{ left: `${range.start}%`, width: `${range.end - range.start}%` }"
          aria-hidden="true"
          data-testid="podcast-mini-player-buffered"
        />
        <div class="absolute inset-y-0 left-0 bg-primary" :style="{ width: `${player.progressPercent.value}%` }" />
      </div>
    </template>

    <template v-else>
      <div data-testid="podcast-expanded-mini-player">
        <div class="flex items-center gap-3 p-3 pb-2">
          <button
            class="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-muted outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            :aria-label="t('podcast.player.openFullPlayer')"
            @click="openPlayer"
          >
            <PodcastArtwork
              :src="activeEpisode?.podcastImageUrl"
              :reset-key="activeEpisode?.podcastId ?? null"
              class="h-full w-full"
              icon-class="w-6"
            />
          </button>
          <button
            class="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            :aria-label="t('podcast.player.openFullPlayer')"
            @click="openPlayer"
          >
            <span class="block truncate text-xs font-medium text-muted-foreground">{{ activeEpisode.podcastTitle }}</span>
            <span class="mt-0.5 block truncate text-sm font-semibold text-foreground">{{ activeEpisode.title }}</span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            class="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            :aria-label="t('podcast.player.collapseMiniPlayer')"
            @click="collapsePlayer"
          >
            <ChevronDown :size="16" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            :aria-label="t('podcast.player.openFullPlayer')"
            @click="openPlayer"
          >
            <Maximize2 :size="16" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            class="shrink-0 rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            :aria-label="t('podcast.player.stopAndClose')"
            @click="closePlayer"
          >
            <X :size="16" />
          </Button>
        </div>

        <div class="grid grid-cols-[3.5rem_1fr_3.5rem] items-center gap-2 px-3 pb-2">
          <span class="text-xs tabular-nums text-muted-foreground">{{ formatPlaybackClock(player.currentTime.value) }}</span>
          <MediaTransport
            size="md"
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
            @skip-back="player.skipBackward"
            @skip-forward="player.skipForward"
          />
          <span class="text-right text-xs tabular-nums text-muted-foreground">{{
            t('podcast.labels.remainingClock', { time: formatPlaybackClock(remainingDuration) })
          }}</span>
        </div>

        <div v-if="playbackDuration" class="px-3">
          <MediaScrubber
            size="sm"
            :current="player.currentTime.value"
            :duration="playbackDuration"
            :buffered="player.bufferedRanges.value"
            :ariaLabel="t('podcast.player.episodePosition')"
            :ariaValueText="seekValueText"
            @seek="player.seekTo"
          />
        </div>
        <div class="flex flex-wrap items-center gap-1 border-t border-border px-3 py-2">
          <div class="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="font-semibold tabular-nums text-muted-foreground hover:text-foreground"
              :aria-label="t('podcast.fullPlayer.cyclePlaybackSpeed')"
              @click="player.cyclePlaybackRate"
            >
              {{ playbackRateLabel }}
            </Button>
            <Popover v-if="hasActiveSleepSetting">
              <PopoverTrigger as-child>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="gap-1.5 font-medium text-warning hover:bg-warning/10 hover:text-warning"
                  :aria-label="sleepAriaLabel"
                >
                  <Timer class="size-3.5" aria-hidden="true" />
                  <span class="tabular-nums">{{ sleepStatusLabel }}</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" class="w-48 p-2">
                <Button
                  v-if="player.sleepRemainingSeconds.value !== null"
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="w-full justify-start"
                  :aria-label="t('podcast.fullPlayer.extendSleepLabel', { count: SLEEP_EXTEND_MINUTES })"
                  @click="extendSleepTimer"
                >
                  <span aria-hidden="true">+</span>
                  {{ t('podcast.fullPlayer.sleepMinutes', { count: SLEEP_EXTEND_MINUTES }) }}
                </Button>
                <Button type="button" variant="ghost" size="sm" class="w-full justify-start" @click="player.clearSleepTimer">
                  {{ t('podcast.fullPlayer.off') }}
                </Button>
              </PopoverContent>
            </Popover>
          </div>
          <div class="ms-auto flex items-center gap-1">
            <MediaVolumeControl variant="popover" :volume="player.volume.value" @update:volume="player.setVolume" @toggle-mute="player.toggleMute" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="text-muted-foreground hover:text-foreground"
              :aria-expanded="showQueue"
              @click="toggleQueue"
            >
              <ListMusic class="h-4 w-4" />
              {{ t('podcast.library.upNext') }}
              <span class="tabular-nums">{{ player.upcomingQueueItems.value.length }}</span>
            </Button>
          </div>
        </div>
        <PodcastQueueList
          v-if="showQueue && player.upcomingQueueItems.value.length"
          class="max-h-52 overflow-y-auto border-t border-border p-2"
          density="compact"
          :items="player.upcomingQueueItems.value"
          :active-episode-id="activeEpisode.id"
          :is-playing="player.isPlaying.value"
        />
      </div>
    </template>
    <div v-if="player.error.value" class="border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">
      <p>{{ player.error.value }}</p>
      <Button type="button" variant="link" size="sm" class="mt-1 h-auto p-0 text-destructive" @click="retryPlayback">
        {{ t('common.retry') }}
      </Button>
    </div>
  </section>
</template>
