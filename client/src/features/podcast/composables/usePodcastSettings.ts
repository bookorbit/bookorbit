import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Library, PodcastLibrarySettings, PodcastPlaybackPreferences } from '@bookorbit/types'
import { Permission } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { api } from '@/lib/api'
import { createRequestGeneration } from '@/lib/async'
import { usePodcastPlayer } from './usePodcastPlayer'

const GIB = 1024 ** 3

export function usePodcastSettings() {
  const { t } = useI18n()
  const { libraries, fetchLibraries } = useLibraries()
  const { hasPermission, isSuperuser } = usePermissions()
  const player = usePodcastPlayer()
  const podcastLibraries = computed(() => libraries.value.filter((library) => library.type === 'podcasts'))
  const selectedLibraryId = ref<number | null>(null)
  const playback = ref<PodcastPlaybackPreferences>({
    defaultPlaybackRate: 1,
    volume: 1,
    skipBackwardSeconds: 15,
    skipForwardSeconds: 30,
    podcastPlaybackRates: {},
  })
  const librarySettings = ref<PodcastLibrarySettings | null>(null)
  const quotaGb = ref('100')
  const freeSpaceGb = ref('5')
  const refreshMinutes = ref(60)
  const completionSeconds = ref(60)
  const loading = ref(false)
  const loadingLibrary = ref(false)
  const savingPlayback = ref(false)
  const savingLibrary = ref(false)
  const libraryRequestGeneration = createRequestGeneration()

  const selectedLibrary = computed<Library | null>(() => podcastLibraries.value.find((library) => library.id === selectedLibraryId.value) ?? null)
  const canEditLibrary = computed(
    () => hasPermission(Permission.PodcastManageRetention) && (isSuperuser.value || selectedLibrary.value?.accessLevel === 'owner'),
  )
  const canExportLibrary = computed(
    () => hasPermission(Permission.PodcastManageFeeds) && (isSuperuser.value || selectedLibrary.value?.accessLevel === 'owner'),
  )

  async function load(preferredLibraryId?: number): Promise<void> {
    loading.value = true
    try {
      const [response] = await Promise.all([api('/api/v1/user-preferences/podcast-playback'), fetchLibraries()])
      if (!response.ok) throw new Error(t('podcast.errors.loadPlaybackSettings'))
      const body: { settings: PodcastPlaybackPreferences } = await response.json()
      playback.value = { ...body.settings, podcastPlaybackRates: { ...body.settings.podcastPlaybackRates } }
      if (preferredLibraryId && podcastLibraries.value.some((library) => library.id === preferredLibraryId)) {
        selectedLibraryId.value = preferredLibraryId
      } else if (selectedLibraryId.value === null || !podcastLibraries.value.some((library) => library.id === selectedLibraryId.value)) {
        selectedLibraryId.value = podcastLibraries.value[0]?.id ?? null
      }
      await loadSelectedLibrary()
    } finally {
      loading.value = false
    }
  }

  async function selectLibrary(libraryId: number): Promise<void> {
    selectedLibraryId.value = libraryId
    await loadSelectedLibrary()
  }

  async function loadSelectedLibrary(): Promise<void> {
    const libraryId = selectedLibraryId.value
    const generation = libraryRequestGeneration.begin()
    librarySettings.value = null
    if (libraryId === null) return
    loadingLibrary.value = true
    try {
      const response = await api(`/api/v1/podcast-libraries/${libraryId}/settings`)
      if (!response.ok) throw new Error(t('podcast.errors.loadSettings'))
      const settings: PodcastLibrarySettings = await response.json()
      if (!libraryRequestGeneration.isCurrent(generation)) return
      librarySettings.value = settings
      quotaGb.value = (Number(settings.storageQuotaBytes) / GIB).toString()
      freeSpaceGb.value = (Number(settings.minimumFreeSpaceBytes) / GIB).toString()
      refreshMinutes.value = settings.defaultRefreshIntervalMinutes
      completionSeconds.value = settings.completionRemainingSeconds
    } finally {
      if (libraryRequestGeneration.isCurrent(generation)) loadingLibrary.value = false
    }
  }

  async function savePlayback(): Promise<void> {
    const settings = playback.value
    if (!Number.isFinite(settings.defaultPlaybackRate) || settings.defaultPlaybackRate < 0.5 || settings.defaultPlaybackRate > 3) {
      throw new Error(t('podcast.errors.invalidPlaybackRate'))
    }
    if (!Number.isFinite(settings.volume) || settings.volume < 0 || settings.volume > 1) {
      throw new Error(t('podcast.errors.invalidVolume'))
    }
    if (!Number.isInteger(settings.skipBackwardSeconds) || settings.skipBackwardSeconds < 5 || settings.skipBackwardSeconds > 120) {
      throw new Error(t('podcast.errors.invalidSkipBackward'))
    }
    if (!Number.isInteger(settings.skipForwardSeconds) || settings.skipForwardSeconds < 5 || settings.skipForwardSeconds > 120) {
      throw new Error(t('podcast.errors.invalidSkipForward'))
    }
    savingPlayback.value = true
    try {
      const response = await api('/api/v1/user-preferences/podcast-playback', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (!response.ok) throw new Error(t('podcast.settingsPage.playbackSaveFailed'))
      player.resetPreferences()
      await player.loadPreferences()
    } finally {
      savingPlayback.value = false
    }
  }

  async function saveLibrary(): Promise<void> {
    const libraryId = selectedLibraryId.value
    if (libraryId === null || !canEditLibrary.value) return
    const quota = Number(quotaGb.value)
    const reserve = Number(freeSpaceGb.value)
    if (!Number.isFinite(quota) || quota < 0 || !Number.isFinite(reserve) || reserve < 0) {
      throw new Error(t('podcast.errors.invalidStorage'))
    }
    if (!Number.isInteger(refreshMinutes.value) || refreshMinutes.value < 5 || refreshMinutes.value > 10080) {
      throw new Error(t('podcast.errors.invalidRefresh'))
    }
    if (!Number.isInteger(completionSeconds.value) || completionSeconds.value < 0 || completionSeconds.value > 3600) {
      throw new Error(t('podcast.errors.invalidCompletion'))
    }
    savingLibrary.value = true
    try {
      const response = await api(`/api/v1/podcast-libraries/${libraryId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storageQuotaBytes: String(Math.round(quota * GIB)),
          minimumFreeSpaceBytes: String(Math.round(reserve * GIB)),
          defaultRefreshIntervalMinutes: refreshMinutes.value,
          completionRemainingSeconds: completionSeconds.value,
        }),
      })
      if (!response.ok) throw new Error(t('podcast.errors.saveSettings'))
      librarySettings.value = await response.json()
    } finally {
      savingLibrary.value = false
    }
  }

  return {
    podcastLibraries,
    selectedLibraryId,
    selectedLibrary,
    playback,
    librarySettings,
    quotaGb,
    freeSpaceGb,
    refreshMinutes,
    completionSeconds,
    loading,
    loadingLibrary,
    savingPlayback,
    savingLibrary,
    canEditLibrary,
    canExportLibrary,
    load,
    selectLibrary,
    savePlayback,
    saveLibrary,
  }
}
