import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { PodcastAcquisitionPolicy, PodcastDirectoryResult, PodcastFeedPreview } from '@bookorbit/types'
import { apiJson, apiSend, jsonBody } from '@/lib/api-json'
import { createRequestGeneration } from '@/lib/async'

const DIRECTORY_SEARCH_DEBOUNCE_MS = 300

export function usePodcastFeedAdd(libraryId: Ref<number>) {
  const { t } = useI18n()
  const feedUrl = ref('')
  const preview = ref<PodcastFeedPreview | null>(null)
  const previewError = ref<string | null>(null)
  const previewing = ref(false)
  const previewedFeedUrl = ref('')
  const directoryQuery = ref('')
  const directoryResults = ref<PodcastDirectoryResult[]>([])
  const directorySearching = ref(false)
  const directoryError = ref<string | null>(null)
  const directorySearched = ref(false)
  const acquisitionPolicy = ref<PodcastAcquisitionPolicy>('remote_only')
  const autoDownloadLimit = ref(3)
  const autoDownloadWindowDays = ref(30)
  const saving = ref(false)
  const previewMetadata = computed(() => [preview.value?.language, preview.value?.podcastType].filter(Boolean).join(' · '))

  let directoryDebounceTimer: ReturnType<typeof setTimeout> | null = null
  const previewGeneration = createRequestGeneration()

  function reset() {
    feedUrl.value = ''
    preview.value = null
    previewError.value = null
    previewedFeedUrl.value = ''
    directoryQuery.value = ''
    directoryResults.value = []
    directoryError.value = null
    directorySearched.value = false
    acquisitionPolicy.value = 'remote_only'
    autoDownloadLimit.value = 3
    autoDownloadWindowDays.value = 30
  }

  async function searchDirectory() {
    const requestedQuery = directoryQuery.value.trim()
    if (!requestedQuery) {
      directoryResults.value = []
      directoryError.value = null
      directorySearched.value = false
      return
    }
    directorySearching.value = true
    directoryError.value = null
    try {
      const results = await apiJson<PodcastDirectoryResult[]>(
        `/api/v1/podcast-search?q=${encodeURIComponent(requestedQuery)}&limit=25`,
        undefined,
        'podcast.errors.directorySearch',
      )
      if (directoryQuery.value.trim() !== requestedQuery) return
      directoryResults.value = results
      directorySearched.value = true
    } catch (reason) {
      if (directoryQuery.value.trim() !== requestedQuery) return
      directoryResults.value = []
      directorySearched.value = true
      directoryError.value = reason instanceof Error ? reason.message : t('podcast.errors.directorySearch')
    } finally {
      directorySearching.value = false
    }
  }

  function selectDirectoryResult(result: PodcastDirectoryResult): number | null {
    if (result.existingPodcastId !== null) return result.existingPodcastId
    feedUrl.value = result.feedUrl
    preview.value = null
    previewedFeedUrl.value = ''
    void previewFeed()
    return null
  }

  function directoryResultLabel(result: PodcastDirectoryResult): string | undefined {
    return result.existingPodcastId === null ? undefined : t('podcast.library.openExistingShow', { title: result.title })
  }

  async function previewFeed() {
    const requestedUrl = feedUrl.value.trim()
    if (!requestedUrl) return
    const activeGeneration = previewGeneration.begin()
    previewing.value = true
    previewError.value = null
    try {
      const result = await apiJson<PodcastFeedPreview>(
        `/api/v1/podcast-libraries/${libraryId.value}/feed-preview`,
        jsonBody('POST', { feedUrl: requestedUrl }),
        'podcast.errors.feedPreview',
      )
      if (!ownsPreviewFor(activeGeneration, requestedUrl)) return
      preview.value = result
      previewedFeedUrl.value = requestedUrl
    } catch (reason) {
      if (!ownsPreviewFor(activeGeneration, requestedUrl)) return
      previewError.value = reason instanceof Error ? reason.message : t('podcast.errors.feedPreview')
    } finally {
      // The spinner belongs to the newest request even when the field has moved on, so an
      // abandoned URL still stops it rather than leaving it running forever.
      if (previewGeneration.isCurrent(activeGeneration)) previewing.value = false
    }
  }

  /** A result may only be shown while it is both the newest request and still the typed URL. */
  function ownsPreviewFor(activeGeneration: number, requestedUrl: string): boolean {
    return previewGeneration.isCurrent(activeGeneration) && feedUrl.value.trim() === requestedUrl
  }

  async function addFeed(): Promise<boolean> {
    if (!preview.value || previewedFeedUrl.value !== feedUrl.value.trim()) return false
    if (acquisitionPolicy.value === 'newest' && (!Number.isInteger(autoDownloadLimit.value) || autoDownloadLimit.value < 1)) {
      toast.error(t('podcast.errors.invalidEpisodeLimit'))
      return false
    }
    if (acquisitionPolicy.value === 'window' && (!Number.isInteger(autoDownloadWindowDays.value) || autoDownloadWindowDays.value < 1)) {
      toast.error(t('podcast.errors.invalidEpisodeWindow'))
      return false
    }
    saving.value = true
    try {
      const payload: Record<string, unknown> = { source: 'feed', feedUrl: feedUrl.value.trim(), acquisitionPolicy: acquisitionPolicy.value }
      if (acquisitionPolicy.value === 'newest') payload.autoDownloadLimit = autoDownloadLimit.value
      if (acquisitionPolicy.value === 'window') payload.autoDownloadWindowDays = autoDownloadWindowDays.value
      await apiSend(`/api/v1/podcast-libraries/${libraryId.value}/podcasts`, jsonBody('POST', payload), 'podcast.errors.addPodcast')
      toast.success(t('podcast.messages.podcastAdded'))
      return true
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t('podcast.errors.addPodcast'))
      return false
    } finally {
      saving.value = false
    }
  }

  watch(feedUrl, () => {
    if (feedUrl.value.trim() === previewedFeedUrl.value) return
    preview.value = null
    previewError.value = null
    previewedFeedUrl.value = ''
  })

  watch(directoryQuery, () => {
    if (directoryDebounceTimer) clearTimeout(directoryDebounceTimer)
    directoryDebounceTimer = setTimeout(() => {
      directoryDebounceTimer = null
      void searchDirectory()
    }, DIRECTORY_SEARCH_DEBOUNCE_MS)
  })

  onScopeDispose(() => {
    if (directoryDebounceTimer) clearTimeout(directoryDebounceTimer)
  })

  return {
    feedUrl,
    preview,
    previewError,
    previewing,
    previewedFeedUrl,
    directoryQuery,
    directoryResults,
    directorySearching,
    directoryError,
    directorySearched,
    acquisitionPolicy,
    autoDownloadLimit,
    autoDownloadWindowDays,
    saving,
    previewMetadata,
    reset,
    searchDirectory,
    selectDirectoryResult,
    directoryResultLabel,
    previewFeed,
    addFeed,
  }
}
