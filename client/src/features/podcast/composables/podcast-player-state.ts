import { computed, ref } from 'vue'
import type { PodcastBookmark, PodcastEpisodeSummary, PodcastPlaybackContext, PodcastPlaybackPreferences } from '@bookorbit/types'

export function createPodcastPlayerState(defaultPreferences: PodcastPlaybackPreferences) {
  const episode = ref<PodcastEpisodeSummary | null>(null)
  const playbackContext = ref<PodcastPlaybackContext | null>(null)
  const bookmarks = ref<PodcastBookmark[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isPlaying = ref(false)
  const isAutoplayPending = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const playbackRate = ref(defaultPreferences.defaultPlaybackRate)
  const volume = ref(defaultPreferences.volume)
  const defaultPlaybackRate = ref(defaultPreferences.defaultPlaybackRate)
  const skipBackwardSeconds = ref(defaultPreferences.skipBackwardSeconds)
  const skipForwardSeconds = ref(defaultPreferences.skipForwardSeconds)
  const podcastPlaybackRates = ref<Record<string, number>>({ ...defaultPreferences.podcastPlaybackRates })
  const bookmarkTitle = ref('')
  const bookmarkNote = ref('')
  const preferencesLoaded = ref(false)
  const downloadProgress = ref<{ receivedBytes: number; totalBytes: number | null } | null>(null)

  const progressPercent = computed(() => (duration.value > 0 ? Math.min(100, (currentTime.value / duration.value) * 100) : 0))
  const previousQueueItem = computed(() => playbackContext.value?.navigation.previous ?? null)
  const nextQueueItem = computed(() => playbackContext.value?.navigation.next ?? null)
  const upcomingQueueItems = computed(() => playbackContext.value?.queue.upcoming ?? [])
  const queuePosition = computed(() => playbackContext.value?.queue.position ?? null)
  const queueTotal = computed(() => playbackContext.value?.queue.total ?? 0)
  const navigationSource = computed(() => playbackContext.value?.navigation.source ?? null)
  const activeChapterIndex = computed(() => {
    const chapters = episode.value?.chapters ?? []
    for (let index = chapters.length - 1; index >= 0; index--) if (currentTime.value >= chapters[index]!.startSeconds) return index
    return -1
  })
  const hasPlaybackRateOverride = computed(() => {
    const podcastId = episode.value?.podcastId
    return podcastId ? String(podcastId) in podcastPlaybackRates.value : false
  })

  return {
    episode,
    playbackContext,
    bookmarks,
    loading,
    error,
    isPlaying,
    isAutoplayPending,
    currentTime,
    duration,
    playbackRate,
    volume,
    defaultPlaybackRate,
    skipBackwardSeconds,
    skipForwardSeconds,
    podcastPlaybackRates,
    bookmarkTitle,
    bookmarkNote,
    preferencesLoaded,
    downloadProgress,
    progressPercent,
    previousQueueItem,
    nextQueueItem,
    upcomingQueueItems,
    queuePosition,
    queueTotal,
    navigationSource,
    activeChapterIndex,
    hasPlaybackRateOverride,
  }
}
