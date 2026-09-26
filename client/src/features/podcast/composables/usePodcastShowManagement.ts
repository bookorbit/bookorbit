import { computed, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type {
  PodcastAcquisitionPolicy,
  PodcastArtworkResult,
  PodcastBulkActionResult,
  PodcastBulkDownloadResult,
  PodcastDownloadCleanup,
  PodcastListItem,
  PodcastMetadataUpdateResult,
  PodcastNotificationMode,
  PodcastPage,
  PodcastPurgePreview,
  PodcastSummary,
} from '@bookorbit/types'
import { PODCAST_NOTIFICATION_MODES } from '@bookorbit/types'
import { api } from '@/lib/api'
import { apiError, jsonBody } from '@/lib/api-json'
import { formatBytes } from '@/lib/formatting'
import { formatNumber } from '@/i18n/formatters'
import { usePodcastPlayer } from './usePodcastPlayer'
import { usePodcastDownloadBatches } from './usePodcastDownloadBatches'

export interface PodcastShowSettingsInput {
  /** `manual` is deliberately absent: the settings sheet never offers it. */
  acquisitionPolicy: Exclude<PodcastAcquisitionPolicy, 'manual'>
  autoDownloadLimit: number
  autoDownloadWindowDays: number
  downloadCleanup: PodcastDownloadCleanup
  downloadCleanupDelayHours: number
  refreshIntervalMinutes: number
}

const DOWNLOAD_LATEST_OPTIONS = [1, 3, 5, 10, 20, 50] as const

export type PodcastShowManagement = ReturnType<typeof usePodcastShowManagement>

/** The dropdown hands back an untyped value, so the shared list is the authority on what is valid. */
function isNotificationMode(value: unknown): value is PodcastNotificationMode {
  return (PODCAST_NOTIFICATION_MODES as readonly unknown[]).includes(value)
}

export function usePodcastShowManagement(
  podcastId: Ref<number>,
  show: Ref<PodcastSummary | null>,
  reload: () => Promise<void>,
  onDeleted: () => void,
) {
  const { t } = useI18n()
  const player = usePodcastPlayer()
  const podcastDownloads = usePodcastDownloadBatches()
  const settingsOpen = ref(false)
  const manageOpen = ref(false)
  const editDetailsOpen = ref(false)
  const pendingRequests = ref(0)
  const notificationMode = ref<PodcastNotificationMode>('off')
  const mergeCandidates = ref<PodcastListItem[]>([])
  const selectedMergeSource = ref<PodcastListItem | null>(null)
  const deletePreview = ref<PodcastPurgePreview | null>(null)
  const deleting = ref(false)
  const bulkAction = ref<'play' | 'queue' | 'played' | 'download' | 'remove' | null>(null)
  const downloadLatestCount = ref(10)
  const confirmRemoveDownloads = ref(false)

  const requestPending = computed(() => pendingRequests.value > 0)
  const bulkPending = computed(() => bulkAction.value !== null)
  const deleteNeedsTypedConfirmation = computed(() => (deletePreview.value?.bytes ?? 0) > 0)
  const deleteDescription = computed(() => {
    const preview = deletePreview.value
    const current = show.value
    if (!preview || !current) return ''
    const values = { title: current.title, episodes: formatNumber(current.episodeCount) }
    return deleteNeedsTypedConfirmation.value
      ? t('podcast.show.confirmDeleteWithDownloads', { ...values, files: formatNumber(preview.files), size: formatBytes(preview.bytes) })
      : t('podcast.show.confirmDelete', values)
  })

  /** Callers hand over the response itself, so this keeps `api` rather than reading the body here. */
  async function request(path: string, init: RequestInit | undefined, fallbackKey: string): Promise<Response | null> {
    pendingRequests.value++
    try {
      const response = await api(path, init)
      if (response.ok) return response
      toast.error((await apiError(response, fallbackKey)).message)
    } catch {
      toast.error(t(fallbackKey))
    } finally {
      pendingRequests.value--
    }
    return null
  }

  async function runShowBulkAction<TResult extends PodcastBulkActionResult = PodcastBulkActionResult>(
    action: Exclude<typeof bulkAction.value, null>,
    path: string,
    init: RequestInit,
  ): Promise<TResult | null> {
    bulkAction.value = action
    try {
      const response = await request(path, init, 'podcast.errors.bulkAction')
      if (!response) return null
      return (await response.json()) as TResult
    } finally {
      bulkAction.value = null
    }
  }

  async function queueAllEpisodes() {
    const result = await runShowBulkAction('queue', `/api/v1/podcasts/${podcastId.value}/queue-all`, { method: 'POST' })
    if (!result) return
    toast.success(t('podcast.messages.bulkQueued', { completed: formatNumber(result.completed), skipped: formatNumber(result.skipped) }))
    await reload()
  }

  async function playAllEpisodes() {
    const result = await runShowBulkAction('play', `/api/v1/podcasts/${podcastId.value}/queue-all`, { method: 'POST' })
    if (result?.firstEpisodeId) await player.playInline(result.firstEpisodeId)
  }

  async function runPrimaryAction() {
    const recommendation = show.value?.playbackRecommendation
    if (recommendation) {
      await player.playInline(recommendation.episodeId)
      return
    }
    await playAllEpisodes()
  }

  async function markAllEpisodesPlayed() {
    const result = await runShowBulkAction('played', `/api/v1/podcasts/${podcastId.value}/mark-all-played`, { method: 'POST' })
    if (!result) return
    toast.success(t('podcast.messages.bulkMarkedPlayed', { count: formatNumber(result.completed) }))
    await reload()
  }

  async function downloadLatestEpisodes() {
    const result = await runShowBulkAction<PodcastBulkDownloadResult>(
      'download',
      `/api/v1/podcasts/${podcastId.value}/download-latest`,
      jsonBody('POST', { count: downloadLatestCount.value }),
    )
    if (!result) return
    void podcastDownloads.track(result.batchId)
    toast.success(t('podcast.messages.bulkDownloadsQueued', { count: formatNumber(result.completed) }))
  }

  async function downloadLatestEpisodesByCount(count: number) {
    downloadLatestCount.value = count
    await downloadLatestEpisodes()
  }

  function requestRemoveAllDownloads() {
    confirmRemoveDownloads.value = true
  }

  function cancelRemoveAllDownloads() {
    confirmRemoveDownloads.value = false
  }

  async function removeAllDownloads() {
    const result = await runShowBulkAction('remove', `/api/v1/podcasts/${podcastId.value}/downloads`, { method: 'DELETE' })
    if (!result) return
    confirmRemoveDownloads.value = false
    if (result.failed > 0) {
      toast.error(
        t('podcast.messages.bulkDownloadsRemovedWithFailures', { completed: formatNumber(result.completed), failed: formatNumber(result.failed) }),
      )
    } else {
      toast.success(t('podcast.messages.bulkDownloadsRemoved', { count: formatNumber(result.completed) }))
    }
    await reload()
  }

  async function follow() {
    const current = show.value
    if (!current) return
    const response = await request(
      `/api/v1/podcasts/${podcastId.value}/follow`,
      jsonBody('POST', { notificationMode: notificationMode.value }),
      'podcast.errors.follow',
    )
    if (!response) return
    current.followed = true
    current.notificationMode = notificationMode.value
  }

  async function unfollow() {
    const current = show.value
    if (!current) return
    const response = await request(`/api/v1/podcasts/${podcastId.value}/follow`, { method: 'DELETE' }, 'podcast.errors.unfollow')
    if (!response) return
    current.followed = false
    notificationMode.value = 'off'
  }

  async function updateNotificationMode() {
    const current = show.value
    if (!current?.followed) return
    const previousMode = current.notificationMode
    await follow()
    if (current.notificationMode !== notificationMode.value) notificationMode.value = previousMode
  }

  async function handleNotificationModeUpdate(value: unknown) {
    if (!isNotificationMode(value)) return
    notificationMode.value = value
    await updateNotificationMode()
  }

  async function refresh() {
    const response = await request(`/api/v1/podcasts/${podcastId.value}/refresh`, { method: 'POST' }, 'podcast.errors.refresh')
    if (response) toast.success(t('podcast.messages.refreshQueued'))
  }

  function openSettings() {
    settingsOpen.value = true
  }

  function closeSettings() {
    settingsOpen.value = false
  }

  function handleSettingsOpenChange(open: boolean) {
    settingsOpen.value = open
  }

  function openEditDetails() {
    settingsOpen.value = false
    editDetailsOpen.value = true
  }

  function handleEditDetailsOpenChange(open: boolean) {
    editDetailsOpen.value = open
  }

  function applyMetadataUpdate(result: PodcastMetadataUpdateResult) {
    const current = show.value
    if (!current) return
    show.value = {
      ...current,
      title: result.title,
      author: result.author,
      description: result.description,
      siteUrl: result.siteUrl,
      language: result.language,
      explicit: result.explicit,
      categories: result.categories,
      lockedFields: result.lockedFields,
    }
  }

  function applyArtworkUpdate(result: PodcastArtworkResult) {
    const current = show.value
    if (!current) return
    show.value = { ...current, imageUrl: result.imageUrl, artworkUpdatedAt: result.artworkUpdatedAt }
  }

  function openManage() {
    settingsOpen.value = false
    cancelDelete()
    clearMergeSelection()
    manageOpen.value = true
  }

  function closeManage() {
    manageOpen.value = false
    cancelDelete()
    clearMergeSelection()
  }

  function handleManageOpenChange(open: boolean) {
    if (open) openManage()
    else closeManage()
  }

  function clearMergeSelection() {
    selectedMergeSource.value = null
    mergeCandidates.value = []
  }

  async function saveSettings(input: PodcastShowSettingsInput) {
    const feedSettings = show.value?.origin !== 'local'
    if (
      feedSettings &&
      (!Number.isInteger(input.refreshIntervalMinutes) || input.refreshIntervalMinutes < 5 || input.refreshIntervalMinutes > 10080)
    ) {
      toast.error(t('podcast.errors.invalidRefresh'))
      return
    }
    if (
      feedSettings &&
      input.acquisitionPolicy === 'newest' &&
      (!Number.isInteger(input.autoDownloadLimit) || input.autoDownloadLimit < 1 || input.autoDownloadLimit > 10000)
    ) {
      toast.error(t('podcast.errors.invalidEpisodeLimit'))
      return
    }
    if (
      feedSettings &&
      input.acquisitionPolicy === 'window' &&
      (!Number.isInteger(input.autoDownloadWindowDays) || input.autoDownloadWindowDays < 1 || input.autoDownloadWindowDays > 3650)
    ) {
      toast.error(t('podcast.errors.invalidEpisodeWindow'))
      return
    }
    if (
      input.downloadCleanup === 'after_finished' &&
      (!Number.isInteger(input.downloadCleanupDelayHours) || input.downloadCleanupDelayHours < 0 || input.downloadCleanupDelayHours > 8760)
    ) {
      toast.error(t('podcast.errors.invalidCleanupDelay'))
      return
    }
    const body: Record<string, unknown> = {
      downloadCleanup: input.downloadCleanup,
      ...(feedSettings ? { acquisitionPolicy: input.acquisitionPolicy, refreshIntervalMinutes: input.refreshIntervalMinutes } : {}),
    }
    if (feedSettings && input.acquisitionPolicy === 'newest') body.autoDownloadLimit = input.autoDownloadLimit
    if (feedSettings && input.acquisitionPolicy === 'window') body.autoDownloadWindowDays = input.autoDownloadWindowDays
    if (input.downloadCleanup === 'after_finished') body.downloadCleanupDelayHours = input.downloadCleanupDelayHours
    const response = await request(`/api/v1/podcasts/${podcastId.value}/config`, jsonBody('PATCH', body), 'podcast.errors.updatePodcast')
    if (!response) return
    closeSettings()
    await reload()
  }

  async function archive() {
    const response = await request(`/api/v1/podcasts/${podcastId.value}/archive`, { method: 'POST' }, 'podcast.errors.archive')
    if (response && show.value) show.value.archivedAt = new Date().toISOString()
  }

  async function restore() {
    const response = await request(`/api/v1/podcasts/${podcastId.value}/restore`, { method: 'POST' }, 'podcast.errors.restore')
    if (response && show.value) show.value.archivedAt = null
  }

  async function prepareDelete() {
    const response = await request(`/api/v1/podcasts/${podcastId.value}/purge-preview`, undefined, 'podcast.errors.prepareDelete')
    if (!response) return
    try {
      deletePreview.value = (await response.json()) as PodcastPurgePreview
    } catch {
      toast.error(t('podcast.errors.prepareDelete'))
    }
  }

  function cancelDelete() {
    if (!deleting.value) deletePreview.value = null
  }

  async function deleteShow() {
    const current = show.value
    if (!current || deleting.value) return
    deleting.value = true
    try {
      if (!current.archivedAt) {
        const archived = await request(`/api/v1/podcasts/${podcastId.value}/archive`, { method: 'POST' }, 'podcast.errors.archive')
        if (!archived) return
        current.archivedAt = new Date().toISOString()
      }
      const purged = await request(`/api/v1/podcasts/${podcastId.value}/purge`, { method: 'POST' }, 'podcast.errors.deleteShow')
      if (!purged) return
      deletePreview.value = null
      toast.success(t('podcast.messages.showDeleted', { title: current.title }))
      closeManage()
      onDeleted()
    } finally {
      deleting.value = false
    }
  }

  async function searchMergeCandidates(query: string) {
    const current = show.value
    if (!current || !query.trim()) return
    const params = new URLSearchParams({ q: query.trim(), page: '0', size: '20' })
    const response = await request(`/api/v1/podcast-libraries/${current.libraryId}/podcasts?${params}`, undefined, 'podcast.errors.loadPodcast')
    if (!response) return
    const result: PodcastPage<PodcastListItem> = await response.json()
    mergeCandidates.value = result.items.filter((candidate) => candidate.id !== podcastId.value)
  }

  function selectMergeCandidate(candidate: PodcastListItem) {
    selectedMergeSource.value = candidate
  }

  function cancelMerge() {
    selectedMergeSource.value = null
  }

  async function merge() {
    const source = selectedMergeSource.value
    if (!source) return
    const response = await request(
      `/api/v1/podcasts/${podcastId.value}/merge`,
      jsonBody('POST', { sourcePodcastId: source.id }),
      'podcast.errors.merge',
    )
    if (!response) return
    toast.success(t('podcast.messages.mergeQueued'))
    clearMergeSelection()
  }

  watch(
    show,
    (current) => {
      notificationMode.value = current?.notificationMode ?? 'off'
    },
    { immediate: true },
  )

  return {
    settingsOpen,
    manageOpen,
    editDetailsOpen,
    notificationMode,
    mergeCandidates,
    selectedMergeSource,
    deletePreview,
    deleting,
    bulkAction,
    bulkPending,
    requestPending,
    confirmRemoveDownloads,
    deleteNeedsTypedConfirmation,
    deleteDescription,
    downloadLatestOptions: DOWNLOAD_LATEST_OPTIONS,
    queueAllEpisodes,
    runPrimaryAction,
    markAllEpisodesPlayed,
    downloadLatestEpisodesByCount,
    requestRemoveAllDownloads,
    cancelRemoveAllDownloads,
    removeAllDownloads,
    follow,
    unfollow,
    handleNotificationModeUpdate,
    refresh,
    openSettings,
    handleSettingsOpenChange,
    openEditDetails,
    handleEditDetailsOpenChange,
    applyMetadataUpdate,
    applyArtworkUpdate,
    openManage,
    closeManage,
    handleManageOpenChange,
    saveSettings,
    archive,
    restore,
    prepareDelete,
    cancelDelete,
    deleteShow,
    searchMergeCandidates,
    selectMergeCandidate,
    cancelMerge,
    merge,
  }
}
