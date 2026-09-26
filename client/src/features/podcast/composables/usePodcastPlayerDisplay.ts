import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MediaTransportLabels } from '@/components/media/types'
import { formatPlaybackClock } from '../lib/podcast-format'
import { usePodcastPlayer } from './usePodcastPlayer'

/** How many minutes the "extend" control adds to a running sleep timer. */
export const SLEEP_EXTEND_MINUTES = 5

/**
 * What the full player and the mini player both have to say about the same playback. They render
 * very differently, but the numbers, the transport labels and the sleep-timer wording behind them
 * are one derivation.
 */
export function usePodcastPlayerDisplay() {
  const player = usePodcastPlayer()
  const { t } = useI18n()

  const activeEpisode = computed(() => player.episode.value)
  /** The engine's duration once loaded, falling back to the feed's until then. */
  const playbackDuration = computed(() => player.duration.value || activeEpisode.value?.durationSeconds || 0)
  const remainingDuration = computed(() => Math.max(0, playbackDuration.value - player.currentTime.value))
  /** Buffering and autoplay both mean "sound is coming"; the surfaces show one spinner for the pair. */
  const isPlaybackPending = computed(() => player.isAutoplayPending.value || player.isBuffering.value)
  const activeChapterTitle = computed(() => activeEpisode.value?.chapters[player.activeChapterIndex.value]?.title ?? null)
  const hasActiveSleepSetting = computed(() => player.sleepTimerMinutes.value !== null || player.sleepEndMode.value !== null)

  const seekValueText = computed(() => {
    const values = { elapsed: formatPlaybackClock(player.currentTime.value), duration: formatPlaybackClock(playbackDuration.value) }
    const chapter = activeChapterTitle.value
    return chapter ? t('podcast.player.positionValueWithChapter', { ...values, chapter }) : t('podcast.player.positionValue', values)
  })

  /** Queue navigation is worded differently from show navigation, so the previous/next labels follow the source. */
  const transportLabels = computed<MediaTransportLabels>(() => ({
    play: t('podcast.actions.play'),
    pause: t('podcast.actions.pause'),
    previous: player.navigationSource.value === 'queue' ? t('podcast.fullPlayer.previousQueued') : t('podcast.player.previousEpisode'),
    next: player.navigationSource.value === 'queue' ? t('podcast.fullPlayer.nextQueued') : t('podcast.player.nextEpisode'),
    back: t('podcast.player.backSeconds', { count: player.skipBackwardSeconds.value }),
    forward: t('podcast.player.forwardSeconds', { count: player.skipForwardSeconds.value }),
  }))

  const sleepRemainingMinutes = computed(() =>
    player.sleepRemainingSeconds.value === null ? null : Math.ceil(player.sleepRemainingSeconds.value / 60),
  )

  /** The end-of-x branches, which read the same wherever the timer is shown. */
  function sleepEndLabel(): string {
    if (player.sleepEndMode.value === 'chapter') return t('podcast.fullPlayer.endOfChapter')
    if (player.sleepEndMode.value === 'episode') return t('podcast.fullPlayer.endOfEpisode')
    return ''
  }

  /** The full player's control label: an abbreviated countdown, naming the feature when nothing is set. */
  const sleepLabel = computed(() => {
    if (sleepRemainingMinutes.value !== null) return t('podcast.fullPlayer.sleepRemaining', { count: sleepRemainingMinutes.value })
    return sleepEndLabel() || t('podcast.fullPlayer.sleep')
  })

  /** The mini player's badge: a spelled-out countdown, and empty rather than named when nothing is set. */
  const sleepStatusLabel = computed(() => {
    if (sleepRemainingMinutes.value !== null) return t('podcast.fullPlayer.sleepMinutes', { count: sleepRemainingMinutes.value })
    return sleepEndLabel()
  })

  function extendSleepTimer() {
    player.extendSleepTimer(SLEEP_EXTEND_MINUTES)
  }

  return {
    activeEpisode,
    playbackDuration,
    remainingDuration,
    isPlaybackPending,
    activeChapterTitle,
    hasActiveSleepSetting,
    seekValueText,
    transportLabels,
    sleepLabel,
    sleepStatusLabel,
    extendSleepTimer,
  }
}
