import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type {
  PodcastEpisodeFilter,
  PodcastEpisodeListItem,
  PodcastEpisodeSort,
  PodcastEpisodeSummary,
  PodcastPage,
  PodcastSummary,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { createRequestGeneration } from '@/lib/async'
import { useInfiniteScrollSentinel } from '@/composables/useInfiniteScrollSentinel'
import { usePodcastEvents } from './usePodcastEvents'
import { usePodcastAnnouncer } from './usePodcastAnnouncer'
import { PODCAST_EPISODE_FILTER_IDS, PODCAST_EPISODE_SORT_IDS, parsePodcastEpisodeSort } from '../lib/podcast-episode-filters'

const EPISODE_PAGE_SIZE = 100
const SEARCH_DEBOUNCE_MS = 300

export function usePodcastShowPage(podcastId: Ref<number>, fetchLibraries: () => Promise<unknown>) {
  const route = useRoute()
  const router = useRouter()
  const { t } = useI18n()
  const podcastEvents = usePodcastEvents()
  const { announce } = usePodcastAnnouncer()
  const show = ref<PodcastSummary | null>(null)
  const episodes = ref<PodcastEpisodeListItem[]>([])
  const totalEpisodes = ref(0)
  const episodePage = ref(0)
  const loading = ref(true)
  const loadingMore = ref(false)
  const loadError = ref<string | null>(null)
  const refreshResult = ref<{ newEpisodes: number; error: string | null } | null>(null)
  const episodeSearch = ref(typeof route.query.q === 'string' ? route.query.q : '')
  const episodeFilter = ref<PodcastEpisodeFilter>(parseEpisodeFilter(route.query.filter))
  const episodeSort = ref<PodcastEpisodeSort>(parsePodcastEpisodeSort(route.query.sort))
  const publishedFrom = ref(typeof route.query.from === 'string' ? route.query.from : '')
  const publishedTo = ref(typeof route.query.to === 'string' ? route.query.to : '')

  const loadGeneration = createRequestGeneration()
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

  const hasDateRange = computed(() => Boolean(publishedFrom.value || publishedTo.value))
  const hasMoreEpisodes = computed(() => !loading.value && episodes.value.length < totalEpisodes.value)
  const episodeListBusy = computed(() => loading.value || loadingMore.value)
  const distinctSeasons = computed(
    () => new Set(episodes.value.map((episode) => episode.season).filter((season): season is string => Boolean(season))),
  )
  const episodeScrollerItems = computed(() => {
    if (distinctSeasons.value.size <= 1) {
      return episodes.value.map((episode) => ({ kind: 'episode' as const, id: `episode-${episode.id}`, episode }))
    }
    const items: ({ kind: 'season'; id: string; season: string } | { kind: 'episode'; id: string; episode: PodcastEpisodeListItem })[] = []
    let previousSeason: string | null = null
    for (const episode of episodes.value) {
      if (episode.season && episode.season !== previousSeason) {
        items.push({ kind: 'season', id: `season-${episode.season}-${episode.id}`, season: episode.season })
      }
      items.push({ kind: 'episode', id: `episode-${episode.id}`, episode })
      previousSeason = episode.season
    }
    return items
  })

  const { sentinel } = useInfiniteScrollSentinel({ loadMore: loadMoreEpisodes, hasMore: hasMoreEpisodes, loading: episodeListBusy })

  async function load(append = false) {
    const activePodcastId = podcastId.value
    const activeGeneration = loadGeneration.begin()
    const needsShow = show.value?.id !== activePodcastId
    if (append && needsShow) return
    if (needsShow) {
      loading.value = true
      loadError.value = null
      show.value = null
      episodes.value = []
      totalEpisodes.value = 0
      episodePage.value = 0
    } else {
      loadingMore.value = true
    }
    const requestedPage = append ? episodePage.value + 1 : 0
    try {
      if (!Number.isInteger(activePodcastId) || activePodcastId <= 0) throw new Error(t('podcast.errors.podcastNotFound'))
      let activeShow = show.value
      if (needsShow) {
        const showResponse = await api(`/api/v1/podcasts/${activePodcastId}`)
        if (!showResponse.ok) throw new Error(t('podcast.errors.podcastNotFound'))
        activeShow = await showResponse.json()
        if (!loadGeneration.isCurrent(activeGeneration)) return
      }
      if (!activeShow) throw new Error(t('podcast.errors.podcastNotFound'))
      const params = new URLSearchParams({
        page: String(requestedPage),
        size: String(EPISODE_PAGE_SIZE),
        filter: episodeFilter.value,
        sort: episodeSort.value,
        podcastId: String(activePodcastId),
      })
      if (episodeSearch.value.trim()) params.set('q', episodeSearch.value.trim())
      if (publishedFrom.value) params.set('publishedFrom', publishedFrom.value)
      if (publishedTo.value) params.set('publishedTo', publishedTo.value)
      const episodesResponse = await api(`/api/v1/podcast-libraries/${activeShow.libraryId}/episodes?${params}`)
      if (!episodesResponse.ok) throw new Error(t('podcast.errors.loadEpisodes'))
      const result: PodcastPage<PodcastEpisodeListItem> = await episodesResponse.json()
      if (!loadGeneration.isCurrent(activeGeneration)) return
      if (needsShow) {
        show.value = activeShow
        podcastEvents.subscribeLibrary(activeShow.libraryId)
      }
      episodes.value = append ? [...episodes.value, ...result.items] : result.items
      totalEpisodes.value = result.total
      episodePage.value = requestedPage
    } catch (reason) {
      if (!loadGeneration.isCurrent(activeGeneration)) return
      const message = reason instanceof Error ? reason.message : t('podcast.errors.loadPodcast')
      if (needsShow) loadError.value = message
      toast.error(message)
    } finally {
      if (loadGeneration.isCurrent(activeGeneration)) {
        if (needsShow) loading.value = false
        else loadingMore.value = false
      }
    }
  }

  async function loadMoreEpisodes() {
    await load(true)
  }

  async function applyEpisodeFilters() {
    await updateEpisodeQuery()
  }

  async function selectEpisodeFilter(filter: PodcastEpisodeFilter) {
    if (episodeFilter.value === filter) return
    episodeFilter.value = filter
    await updateEpisodeQuery()
  }

  async function selectEpisodeSort(value: unknown) {
    if (typeof value !== 'string' || !PODCAST_EPISODE_SORT_IDS.has(value as PodcastEpisodeSort)) return
    if (episodeSort.value === value) return
    episodeSort.value = value as PodcastEpisodeSort
    await updateEpisodeQuery()
  }

  async function clearDateRange() {
    if (!hasDateRange.value) return
    publishedFrom.value = ''
    publishedTo.value = ''
    await updateEpisodeQuery()
  }

  async function clearEpisodeSearch() {
    if (!episodeSearch.value) return
    episodeSearch.value = ''
    await updateEpisodeQuery()
  }

  function cancelSearchDebounce() {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }

  async function updateEpisodeQuery() {
    cancelSearchDebounce()
    if (publishedFrom.value && publishedTo.value && publishedFrom.value > publishedTo.value) {
      toast.error(t('podcast.errors.invalidDateRange'))
      return
    }
    await router.replace({
      query: {
        q: episodeSearch.value.trim() || undefined,
        filter: episodeFilter.value === 'latest' ? undefined : episodeFilter.value,
        sort: episodeSort.value === 'newest' ? undefined : episodeSort.value,
        from: publishedFrom.value || undefined,
        to: publishedTo.value || undefined,
      },
    })
  }

  function applyEpisodeMetadata(updated: PodcastEpisodeSummary) {
    const row = episodes.value.find((episode) => episode.id === updated.id)
    if (!row) return
    row.title = updated.title
    row.season = updated.season
    row.episode = updated.episode
    row.explicit = updated.explicit
    row.publishedAt = updated.publishedAt
    row.durationSeconds = updated.durationSeconds
  }

  async function initialize() {
    episodeSearch.value = typeof route.query.q === 'string' ? route.query.q : ''
    episodeFilter.value = parseEpisodeFilter(route.query.filter)
    episodeSort.value = parsePodcastEpisodeSort(route.query.sort)
    publishedFrom.value = typeof route.query.from === 'string' ? route.query.from : ''
    publishedTo.value = typeof route.query.to === 'string' ? route.query.to : ''
    await Promise.all([fetchLibraries().catch(() => toast.error(t('podcast.errors.libraryAccess'))), load()])
  }

  function retryLoad() {
    void initialize()
  }

  watch([podcastId, () => route.query.q, () => route.query.filter, () => route.query.sort, () => route.query.from, () => route.query.to], retryLoad, {
    immediate: true,
  })

  watch(episodeSearch, (value) => {
    cancelSearchDebounce()
    const applied = typeof route.query.q === 'string' ? route.query.q : ''
    if (value.trim() === applied.trim()) return
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null
      void updateEpisodeQuery()
    }, SEARCH_DEBOUNCE_MS)
  })

  podcastEvents.onDownloadProgress((event) => {
    if (event.podcastId !== podcastId.value) return
    const episode = episodes.value.find((item) => item.id === event.episodeId)
    if (episode) episode.mediaStatus = event.status
  })

  podcastEvents.onDownloadComplete((event) => {
    if (event.podcastId !== podcastId.value) return
    const episode = episodes.value.find((item) => item.id === event.episodeId)
    if (!episode) return
    episode.mediaStatus = event.mediaStatus
    episode.localSizeBytes = event.localSizeBytes
    const key = event.mediaStatus === 'local' ? 'podcast.announce.downloadReady' : 'podcast.announce.downloadFailed'
    void announce(t(key, { title: episode.title }))
  })

  podcastEvents.onRetentionEvicted((event) => {
    if (event.podcastId !== podcastId.value) return
    const episode = episodes.value.find((item) => item.id === event.episodeId)
    if (show.value) show.value.downloadedCount = Math.max(0, show.value.downloadedCount - 1)
    if (!episode || episode.mediaStatus !== 'local') return
    episode.mediaStatus = 'remote'
    episode.localSizeBytes = null
    const key = event.reason === 'played' ? 'podcast.announce.evictedPlayed' : 'podcast.announce.evictedSpace'
    void announce(t(key, { title: episode.title }))
  })

  podcastEvents.onRefreshComplete((event) => {
    if (event.podcastId !== podcastId.value || !show.value) return
    show.value.consecutiveFailures = event.consecutiveFailures
    show.value.episodeCount += event.newEpisodes
    totalEpisodes.value += event.newEpisodes
    refreshResult.value = { newEpisodes: event.newEpisodes, error: event.lastError }
    if (event.newEpisodes > 0) void load()
  })

  onScopeDispose(cancelSearchDebounce)

  return {
    show,
    episodes,
    totalEpisodes,
    loading,
    loadingMore,
    loadError,
    refreshResult,
    episodeSearch,
    episodeFilter,
    episodeSort,
    publishedFrom,
    publishedTo,
    hasDateRange,
    hasMoreEpisodes,
    episodeListBusy,
    episodeScrollerItems,
    sentinel,
    downloadProgress: podcastEvents.downloadProgress,
    load,
    loadMoreEpisodes,
    applyEpisodeFilters,
    selectEpisodeFilter,
    selectEpisodeSort,
    clearDateRange,
    clearEpisodeSearch,
    updateEpisodeQuery,
    applyEpisodeMetadata,
    initialize,
    retryLoad,
  }
}

function parseEpisodeFilter(value: unknown): PodcastEpisodeFilter {
  return typeof value === 'string' && PODCAST_EPISODE_FILTER_IDS.has(value as PodcastEpisodeFilter) ? (value as PodcastEpisodeFilter) : 'latest'
}
