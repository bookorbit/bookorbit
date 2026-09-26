import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { PodcastCreateResult, PodcastImportReport, PodcastImportScanStatus } from '@bookorbit/types'
import { apiJson, apiSend, jsonBody } from '@/lib/api-json'
import { createCoalescedFetch, createRequestGeneration } from '@/lib/async'
import { usePodcastEvents } from './usePodcastEvents'

/** How often a running scan is re-read. Events nudge it sooner; this is the floor for a lost event. */
const POLL_INTERVAL_MS = 2000

/**
 * Drives the local-file import: start a run, follow it, and hold the review decisions the user
 * makes about ambiguous files until they apply them.
 */
export function usePodcastImport(libraryId: Ref<number>) {
  const { t } = useI18n()
  const events = usePodcastEvents()

  const status = ref<PodcastImportScanStatus>({ job: null, report: null })
  const loading = ref(false)
  const starting = ref(false)
  const error = ref<string | null>(null)
  /** File path (relative to the library folder) to the episode the user picked for it. */
  const resolutions = ref<Map<string, number>>(new Map())
  const subscribingFeedUrl = ref<string | null>(null)
  const subscribedFeedUrls = ref<Set<string>>(new Set())
  const creatingFolderPath = ref<string | null>(null)
  const createdFolderPaths = ref<Set<string>>(new Set())

  let pollTimer: ReturnType<typeof setInterval> | null = null
  const refreshGeneration = createRequestGeneration()

  const job = computed(() => status.value.job)
  const report = computed<PodcastImportReport | null>(() => status.value.report)
  const running = computed(() => job.value?.status === 'queued' || job.value?.status === 'processing')
  const progressPercent = computed(() => {
    const total = job.value?.progressTotal ?? 0
    if (!total) return 0
    return Math.min(100, Math.round(((job.value?.progressCurrent ?? 0) / total) * 100))
  })
  /** A report only describes what is on disk now, so applying is offered only for a dry run's findings. */
  const canApply = computed(() => Boolean(report.value?.dryRun) && !running.value && (report.value?.counts.matched ?? 0) > 0)

  const refresh = createCoalescedFetch(async (): Promise<void> => {
    const activeGeneration = refreshGeneration.current()
    const requestedLibraryId = libraryId.value
    loading.value = true
    try {
      const latest = await apiJson<PodcastImportScanStatus>(
        `/api/v1/podcast-libraries/${requestedLibraryId}/import-scan/latest`,
        undefined,
        'podcast.import.errors.status',
      )
      // A read started before a library switch describes the library the user just left.
      if (!refreshGeneration.isCurrent(activeGeneration)) return
      status.value = latest
      error.value = null
    } catch (reason) {
      if (!refreshGeneration.isCurrent(activeGeneration)) return
      error.value = reason instanceof Error ? reason.message : t('podcast.import.errors.status')
    } finally {
      if (refreshGeneration.isCurrent(activeGeneration)) {
        loading.value = false
        syncPolling()
      }
    }
  })

  async function start(options: { dryRun: boolean; podcastId?: number }): Promise<boolean> {
    if (starting.value || running.value) return false
    starting.value = true
    error.value = null
    try {
      const body: Record<string, unknown> = { dryRun: options.dryRun }
      if (options.podcastId !== undefined) body.podcastId = options.podcastId
      if (!options.dryRun && resolutions.value.size > 0) {
        body.resolutions = [...resolutions.value].map(([path, episodeId]) => ({ path, episodeId }))
      }
      await apiSend(`/api/v1/podcast-libraries/${libraryId.value}/import-scan`, jsonBody('POST', body), 'podcast.import.errors.start')
      // The report on file still describes the previous run; drop it so the sheet shows progress
      // rather than stale findings.
      status.value = { job: null, report: null }
      // A read opened before the POST would answer with the pre-start job, so this one cannot join it.
      refresh.clear()
      await refresh()
      return true
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : t('podcast.import.errors.start')
      return false
    } finally {
      starting.value = false
    }
  }

  /**
   * Subscribes to a feed the scan found beside the files. The show exists as soon as this returns;
   * its episodes follow in the background, which is why the sheet asks for another scan rather than
   * claiming the show is already complete.
   */
  async function subscribeToFeed(feedUrl: string): Promise<boolean> {
    if (subscribingFeedUrl.value) return false
    subscribingFeedUrl.value = feedUrl
    try {
      await apiSend(
        `/api/v1/podcast-libraries/${libraryId.value}/podcasts`,
        jsonBody('POST', { source: 'feed', feedUrl }),
        'podcast.import.errors.subscribe',
      )
      subscribedFeedUrls.value = new Set(subscribedFeedUrls.value).add(feedUrl)
      toast.success(t('podcast.import.messages.subscribed'))
      return true
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t('podcast.import.errors.subscribe'))
      return false
    } finally {
      subscribingFeedUrl.value = null
    }
  }

  /** Turns a folder that belongs to no feed into a show of its own, on the same background terms. */
  async function createLocalShow(folderPath: string): Promise<boolean> {
    if (creatingFolderPath.value) return false
    creatingFolderPath.value = folderPath
    try {
      const result = await apiJson<PodcastCreateResult>(
        `/api/v1/podcast-libraries/${libraryId.value}/podcasts`,
        jsonBody('POST', { source: 'folder', folderPath }),
        'podcast.import.errors.createLocalShow',
      )
      createdFolderPaths.value = new Set(createdFolderPaths.value).add(folderPath)
      toast.success(result.created ? t('podcast.import.messages.localShowCreated') : t('podcast.import.messages.localShowUpdated'))
      return true
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t('podcast.import.errors.createLocalShow'))
      return false
    } finally {
      creatingFolderPath.value = null
    }
  }

  function resolveFile(path: string, episodeId: number | null): void {
    const next = new Map(resolutions.value)
    if (episodeId === null) next.delete(path)
    else next.set(path, episodeId)
    resolutions.value = next
  }

  function clearResolutions(): void {
    resolutions.value = new Map()
  }

  /** Automatic re-reads stand down while one is open, so a slow response cannot stack them up. */
  function refreshUnlessInFlight(): void {
    if (refresh.inFlight()) return
    void refresh()
  }

  function syncPolling(): void {
    if (running.value && !pollTimer) pollTimer = setInterval(refreshUnlessInFlight, POLL_INTERVAL_MS)
    else if (!running.value && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  function stopPolling(): void {
    if (!pollTimer) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  events.onImportProgress((event) => {
    if (event.kind !== 'local_files' || event.libraryId !== libraryId.value) return
    refreshUnlessInFlight()
  })

  watch(libraryId, () => {
    // Invalidates any open read so the previous library's report cannot land on the new one.
    refreshGeneration.invalidate()
    status.value = { job: null, report: null }
    error.value = null
    loading.value = false
    clearResolutions()
    subscribedFeedUrls.value = new Set()
    createdFolderPaths.value = new Set()
    stopPolling()
  })

  onScopeDispose(stopPolling)

  return {
    status,
    job,
    report,
    loading,
    starting,
    running,
    error,
    resolutions,
    subscribingFeedUrl,
    subscribedFeedUrls,
    creatingFolderPath,
    createdFolderPaths,
    progressPercent,
    canApply,
    refresh,
    start,
    subscribeToFeed,
    createLocalShow,
    resolveFile,
    clearResolutions,
    stopPolling,
  }
}
