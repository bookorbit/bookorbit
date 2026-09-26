import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { LocationQueryRaw } from 'vue-router'
import type { PodcastEpisodeFilter, PodcastSort } from '@bookorbit/types'
import { PODCAST_EPISODE_FILTER_IDS, parsePodcastEpisodeSort } from '../lib/podcast-episode-filters'
import { BUILT_IN_PLAYLIST_IDS, usePodcastPlaylists } from './usePodcastPlaylists'
import { usePodcasts } from './usePodcasts'

export type PodcastLibraryViewId = 'shows' | 'episodes' | 'playlists' | 'queue' | 'health'

const VIEW_IDS = new Set<PodcastLibraryViewId>(['shows', 'episodes', 'playlists', 'queue', 'health'])
const SHOW_SORTS = new Set<PodcastSort>(['title', 'recent', 'unplayed'])
const SEARCH_DEBOUNCE_MS = 300

/** Which lane backs each tab. Playlists and episodes read the same list through different filters. */
const VIEW_LANES: Record<PodcastLibraryViewId, 'shows' | 'episodes' | 'queue' | 'health'> = {
  shows: 'shows',
  episodes: 'episodes',
  playlists: 'episodes',
  queue: 'queue',
  health: 'health',
}

/**
 * The library page's state, all of it derived from the route rather than mirrored into refs beside
 * it. The route is the only writable copy: selecting a tab, a filter or a sort is a `router.replace`,
 * and everything downstream recomputes. The one exception is the search field, which holds the
 * user's keystrokes until the debounce pushes them into the query.
 */
export function usePodcastLibraryPage(libraryId: Ref<number>) {
  const route = useRoute()
  const router = useRouter()
  const podcast = usePodcasts(libraryId)
  const playlists = usePodcastPlaylists(libraryId)

  const currentView = computed(() => parseView(route.query.view))
  const episodeFilter = computed(() => parseEpisodeFilter(route.query.filter ?? route.query.view))
  const showSort = computed(() => parseShowSort(route.query.sort))
  const episodeSort = computed(() => parsePodcastEpisodeSort(route.query.sort))
  const followedOnly = computed(() => route.query.followed === '1')
  const missingOnly = computed(() => route.query.missing === '1')
  const searchQuery = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))
  const activePlaylistId = computed(() =>
    typeof route.query.playlist === 'string' && route.query.playlist ? route.query.playlist : BUILT_IN_PLAYLIST_IDS[0],
  )
  const activePlaylist = computed(() => playlists.findPlaylist(activePlaylistId.value))

  /**
   * The tab whose data is on screen, which lags the selected tab until its first page lands. Without
   * it, switching tabs would blank the list to an empty state before the new one has anything.
   */
  const renderedView = ref<PodcastLibraryViewId>(currentView.value)
  const searchInput = ref(searchQuery.value)
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

  const currentLane = computed(() => podcast.lanes[VIEW_LANES[currentView.value]])
  const renderedLane = computed(() => podcast.lanes[VIEW_LANES[renderedView.value]])

  const loadedCount = computed(() => renderedLane.value.items.value.length)
  const total = computed(() => renderedLane.value.total.value)
  const listBusy = computed(() => currentLane.value.busy.value)
  const loadingMore = computed(() => renderedLane.value.loadingMore.value)
  const renderedViewInitialized = computed(() => renderedLane.value.initialized.value)
  const currentHasMore = computed(() => currentLane.value.hasMore.value)
  const renderedHasMore = computed(() => renderedLane.value.hasMore.value)
  const error = computed(() => renderedLane.value.error.value)
  const isRefreshing = computed(() => renderedLane.value.loading.value && renderedViewInitialized.value)
  const showInitialSkeleton = computed(() => renderedLane.value.loading.value && !renderedViewInitialized.value)
  const showInitialError = computed(() => Boolean(error.value) && !renderedViewInitialized.value)
  const showRefreshError = computed(() => Boolean(error.value) && renderedViewInitialized.value)

  async function loadCurrentView(): Promise<void> {
    if (currentView.value === 'shows') return podcast.loadShows()
    if (currentView.value === 'queue') return podcast.loadQueue()
    if (currentView.value === 'health') return podcast.loadHealth()
    if (currentView.value === 'playlists') {
      const rules = activePlaylist.value?.rules
      if (!rules) return
      podcast.playlistRules.value = rules
      return podcast.loadEpisodes()
    }
    podcast.playlistRules.value = null
    podcast.filter.value = episodeFilter.value
    return podcast.loadEpisodes()
  }

  async function loadMoreCurrentView(): Promise<void> {
    if (currentView.value === 'shows') return podcast.loadShows(true)
    if (currentView.value === 'queue') return podcast.loadQueue(true)
    if (currentView.value === 'health') return podcast.loadHealth(true)
    return podcast.loadEpisodes(true)
  }

  function retryCurrentView(): void {
    void loadCurrentView()
  }

  /** Every navigation on this page is a query replace; the watcher below turns it back into a load. */
  function replaceQuery(patch: LocationQueryRaw): Promise<void> {
    return router.replace({ query: { ...route.query, ...patch } }).then(() => undefined)
  }

  async function selectView(view: PodcastLibraryViewId): Promise<void> {
    if (currentView.value === view) {
      await loadCurrentView()
      return
    }
    await replaceQuery({ view, filter: view === 'episodes' ? episodeFilter.value : undefined, sort: undefined })
  }

  async function selectSort(id: string): Promise<void> {
    if (currentView.value === 'shows') {
      const sort = parseShowSort(id)
      if (showSort.value === sort) return
      await replaceQuery({ sort: sort === 'title' ? undefined : sort })
      return
    }
    const sort = parsePodcastEpisodeSort(id)
    if (episodeSort.value === sort) return
    await replaceQuery({ sort: sort === 'newest' ? undefined : sort })
  }

  async function resetSort(): Promise<void> {
    await replaceQuery({ sort: undefined })
  }

  async function selectEpisodeFilter(filter: PodcastEpisodeFilter): Promise<void> {
    if (episodeFilter.value === filter) return
    await replaceQuery({ view: 'episodes', filter })
  }

  async function toggleFollowedOnly(): Promise<void> {
    await replaceQuery({ view: 'episodes', followed: followedOnly.value ? undefined : '1' })
  }

  async function toggleMissingOnly(): Promise<void> {
    await replaceQuery({ view: 'shows', missing: missingOnly.value ? undefined : '1' })
  }

  async function resetEpisodeFilters(): Promise<void> {
    await replaceQuery({ view: 'episodes', filter: undefined, followed: undefined })
  }

  async function selectPlaylist(id: string): Promise<void> {
    if (currentView.value === 'playlists' && activePlaylistId.value === id) return
    await replaceQuery({ view: 'playlists', filter: undefined, sort: undefined, playlist: id })
  }

  async function applySearch(value: string): Promise<void> {
    const q = value.trim()
    if (searchQuery.value === q) return
    await replaceQuery({ q: q || undefined })
  }

  async function clearSearch(): Promise<void> {
    if (searchInput.value.trim().length === 0) return
    searchInput.value = ''
    cancelSearchDebounce()
    await applySearch('')
  }

  function cancelSearchDebounce(): void {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }

  watch(searchInput, (value) => {
    cancelSearchDebounce()
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null
      void applySearch(value)
    }, SEARCH_DEBOUNCE_MS)
  })

  watch(
    [libraryId, currentView, episodeFilter, showSort, episodeSort, searchQuery, followedOnly, missingOnly, activePlaylistId],
    async () => {
      const requestedView = currentView.value
      podcast.showSort.value = showSort.value
      podcast.episodeSort.value = episodeSort.value
      podcast.search.value = searchQuery.value
      podcast.followedOnly.value = followedOnly.value
      podcast.missingOnly.value = missingOnly.value
      searchInput.value = searchQuery.value
      if (podcast.lanes[VIEW_LANES[requestedView]].initialized.value) renderedView.value = requestedView
      await loadCurrentView()
      if (currentView.value === requestedView) renderedView.value = requestedView
    },
    { immediate: true },
  )

  /** Saved playlists arrive after the first render, so a deep link to one loads once its rules resolve. */
  watch(
    () => playlists.loaded.value,
    (loaded) => {
      if (!loaded || currentView.value !== 'playlists') return
      if (!activePlaylist.value) void selectPlaylist(BUILT_IN_PLAYLIST_IDS[0])
      else if (!activePlaylist.value.builtIn) void loadCurrentView()
    },
  )

  onScopeDispose(cancelSearchDebounce)

  return {
    podcast,
    playlists,
    currentView,
    renderedView,
    episodeFilter,
    showSort,
    episodeSort,
    followedOnly,
    missingOnly,
    searchQuery,
    searchInput,
    activePlaylistId,
    activePlaylist,
    total,
    loadedCount,
    listBusy,
    loadingMore,
    renderedViewInitialized,
    currentHasMore,
    renderedHasMore,
    error,
    isRefreshing,
    showInitialSkeleton,
    showInitialError,
    showRefreshError,
    loadCurrentView,
    loadMoreCurrentView,
    retryCurrentView,
    selectView,
    selectSort,
    resetSort,
    selectEpisodeFilter,
    toggleFollowedOnly,
    toggleMissingOnly,
    resetEpisodeFilters,
    selectPlaylist,
    clearSearch,
  }
}

function parseView(value: unknown): PodcastLibraryViewId {
  const candidate = Array.isArray(value) ? value[0] : value
  // A filter id in the `view` slot is a link into the episodes tab pre-filtered, kept working for
  // bookmarks made before the two were separate query params.
  if (typeof candidate === 'string' && PODCAST_EPISODE_FILTER_IDS.has(candidate as PodcastEpisodeFilter)) return 'episodes'
  return typeof candidate === 'string' && VIEW_IDS.has(candidate as PodcastLibraryViewId) ? (candidate as PodcastLibraryViewId) : 'shows'
}

function parseEpisodeFilter(value: unknown): PodcastEpisodeFilter {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && PODCAST_EPISODE_FILTER_IDS.has(candidate as PodcastEpisodeFilter)
    ? (candidate as PodcastEpisodeFilter)
    : 'latest'
}

function parseShowSort(value: unknown): PodcastSort {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' && SHOW_SORTS.has(candidate as PodcastSort) ? (candidate as PodcastSort) : 'title'
}

export function isPodcastLibraryViewId(value: string): value is PodcastLibraryViewId {
  return VIEW_IDS.has(value as PodcastLibraryViewId)
}
