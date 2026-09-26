import { ref, type ComputedRef, type Ref } from 'vue'
import { vi } from 'vitest'
import type {
  PodcastDownloadCompleteEvent,
  PodcastBulkActionResult,
  PodcastDownloadProgressEvent,
  PodcastEpisodeListItem,
  PodcastFeedHealth,
  PodcastImportProgressEvent,
  PodcastListItem,
  PodcastQueueItem,
  PodcastRefreshCompleteEvent,
  PodcastRetentionEvictedEvent,
  PodcastShowDiscoveredEvent,
} from '@bookorbit/types'
import type { PodcastPlayer } from '../composables/usePodcastPlayer'
import type { PodcastListLane } from '../composables/podcast-list-lane'
import type { usePodcasts } from '../composables/usePodcasts'
import type { PodcastShowManagement } from '../composables/usePodcastShowManagement'

/**
 * The stand-ins podcast specs kept rebuilding: a sheet that renders its slots, a `usePodcastEvents`
 * whose callbacks a test can fire, and the two browser media shims jsdom does not provide.
 */

/** Renders a shared-UI wrapper as a plain element so its slot content is queryable. */
export function passthrough(tag = 'div') {
  return { template: `<${tag}><slot /></${tag}>` }
}

/** Every reka-ui `Sheet` part, flattened. Spread into `global.stubs`. */
export function sheetStubs(): Record<string, { template: string }> {
  return {
    Sheet: passthrough('div'),
    SheetContent: passthrough('div'),
    SheetHeader: passthrough('div'),
    SheetTitle: passthrough('h2'),
    SheetDescription: passthrough('p'),
    SheetFooter: passthrough('div'),
  }
}

export interface PodcastEventCallbacks {
  downloadProgress: ((event: PodcastDownloadProgressEvent) => void) | null
  downloadComplete: ((event: PodcastDownloadCompleteEvent) => void) | null
  refreshComplete: ((event: PodcastRefreshCompleteEvent) => void) | null
  importProgress: ((event: PodcastImportProgressEvent) => void) | null
  retentionEvicted: ((event: PodcastRetentionEvictedEvent) => void) | null
  showDiscovered: ((event: PodcastShowDiscoveredEvent) => void) | null
}

/**
 * Captures the callbacks the composable under test registers so a spec can drive a socket event
 * without a socket. Build it inside `vi.hoisted` and return it from the `vi.mock` factory.
 */
export function mockPodcastEvents() {
  const callbacks: PodcastEventCallbacks = {
    downloadProgress: null,
    downloadComplete: null,
    refreshComplete: null,
    importProgress: null,
    retentionEvicted: null,
    showDiscovered: null,
  }
  const connected = ref(false)
  const downloadProgress = ref(new Map<number, PodcastDownloadProgressEvent>())
  const importProgress = ref(new Map<number, PodcastImportProgressEvent>())
  const subscribeLibrary = vi.fn<(libraryId: number) => void>()

  function capture<K extends keyof PodcastEventCallbacks>(key: K) {
    return (callback: NonNullable<PodcastEventCallbacks[K]>) => {
      callbacks[key] = callback
      return () => {
        callbacks[key] = null
      }
    }
  }

  return {
    callbacks,
    connected,
    downloadProgress,
    importProgress,
    subscribeLibrary,
    usePodcastEvents: () => ({
      connected,
      downloadProgress,
      importProgress,
      subscribeLibrary,
      onDownloadProgress: capture('downloadProgress'),
      onDownloadComplete: capture('downloadComplete'),
      onRefreshComplete: capture('refreshComplete'),
      onImportProgress: capture('importProgress'),
      onRetentionEvicted: capture('retentionEvicted'),
      onShowDiscovered: capture('showDiscovered'),
    }),
  }
}

export interface StubbedMediaSession {
  handlers: Map<MediaSessionAction, MediaSessionActionHandler | null>
  metadata: MediaMetadataInit | null
  playbackState: MediaSessionPlaybackState
  positionStates: Array<MediaPositionState | null>
}

/**
 * jsdom implements neither `navigator.mediaSession` nor `MediaMetadata`. `unsupported` makes
 * `setActionHandler` throw for those actions, the way a browser missing them does.
 */
export function stubMediaSession(unsupported = new Set<MediaSessionAction>()): StubbedMediaSession {
  const stub: StubbedMediaSession = { handlers: new Map(), metadata: null, playbackState: 'none', positionStates: [] }
  vi.stubGlobal(
    'MediaMetadata',
    class {
      constructor(init: MediaMetadataInit) {
        Object.assign(this, init)
      }
    },
  )
  Object.defineProperty(navigator, 'mediaSession', {
    configurable: true,
    value: {
      get playbackState() {
        return stub.playbackState
      },
      set playbackState(value: MediaSessionPlaybackState) {
        stub.playbackState = value
      },
      get metadata() {
        return stub.metadata
      },
      set metadata(value: MediaMetadataInit | null) {
        stub.metadata = value
      },
      setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
        if (unsupported.has(action)) throw new DOMException('Unsupported action')
        stub.handlers.set(action, handler)
      },
      setPositionState(position?: MediaPositionState) {
        stub.positionStates.push(position ?? null)
      },
    },
  })
  return stub
}

/** jsdom reports an empty `TimeRanges` for every media element; the engine reads its ranges off it. */
export function stubBufferedRanges(node: HTMLAudioElement, ranges: Array<{ start: number; end: number }>): void {
  Object.defineProperty(node, 'buffered', {
    configurable: true,
    get: () =>
      ({
        length: ranges.length,
        start: (index: number) => ranges[index]!.start,
        end: (index: number) => ranges[index]!.end,
      }) as TimeRanges,
  })
}

/** A composable's shape with every `computed` relaxed to a writable ref, so a spec can set it. */
type Settable<T> = { [K in keyof T]: T[K] extends ComputedRef<infer V> ? Ref<V> : T[K] }

/**
 * The player exposes several members as `computed`, which a spec has to be able to set. This is the
 * same shape with those relaxed to writable refs.
 */
export type PodcastPlayerStub = Settable<PodcastPlayer>

/**
 * A complete stand-in for the player, typed against its own return so a rename in the composable
 * breaks the stub at compile time rather than at runtime inside an unrelated test. Overrides replace
 * any member; the rest are inert refs and no-op spies.
 */
export function createPlayerStub(overrides: Partial<PodcastPlayerStub> = {}): PodcastPlayerStub {
  const stub: PodcastPlayerStub = {
    episode: ref(null),
    bookmarks: ref([]),
    loading: ref(false),
    error: ref(null),
    isPlaying: ref(false),
    isAutoplayPending: ref(false),
    isBuffering: ref(false),
    bufferedRanges: ref([]),
    currentTime: ref(0),
    duration: ref(0),
    playbackRate: ref(1),
    volume: ref(1),
    hasPlaybackRateOverride: ref(false),
    skipBackwardSeconds: ref(15),
    skipForwardSeconds: ref(30),
    bookmarkTitle: ref(''),
    bookmarkNote: ref(''),
    progressPercent: ref(0),
    previousQueueItem: ref(null),
    nextQueueItem: ref(null),
    upcomingQueueItems: ref([]),
    queuePosition: ref(null),
    queueTotal: ref(0),
    navigationSource: ref(null),
    sleepRemainingSeconds: ref(null),
    sleepEndMode: ref(null),
    sleepTimerMinutes: ref(null),
    activeChapterIndex: ref(-1),
    loadEpisode: vi.fn<PodcastPlayer['loadEpisode']>(async () => undefined),
    playInline: vi.fn<PodcastPlayer['playInline']>(async () => undefined),
    togglePlayback: vi.fn<PodcastPlayer['togglePlayback']>(),
    seekTo: vi.fn<PodcastPlayer['seekTo']>(),
    setPlaybackRate: vi.fn<PodcastPlayer['setPlaybackRate']>(),
    cyclePlaybackRate: vi.fn<PodcastPlayer['cyclePlaybackRate']>(),
    stepPlaybackRate: vi.fn<PodcastPlayer['stepPlaybackRate']>(),
    clearPlaybackRateOverride: vi.fn<PodcastPlayer['clearPlaybackRateOverride']>(),
    setVolume: vi.fn<PodcastPlayer['setVolume']>(),
    toggleMute: vi.fn<PodcastPlayer['toggleMute']>(),
    loadPreferences: vi.fn<PodcastPlayer['loadPreferences']>(async () => undefined),
    resetPreferences: vi.fn<PodcastPlayer['resetPreferences']>(),
    skipBackward: vi.fn<PodcastPlayer['skipBackward']>(),
    skipForward: vi.fn<PodcastPlayer['skipForward']>(),
    setSleepTimer: vi.fn<PodcastPlayer['setSleepTimer']>(),
    setSleepAtEnd: vi.fn<PodcastPlayer['setSleepAtEnd']>(),
    extendSleepTimer: vi.fn<PodcastPlayer['extendSleepTimer']>(),
    clearSleepTimer: vi.fn<PodcastPlayer['clearSleepTimer']>(),
    previousChapter: vi.fn<PodcastPlayer['previousChapter']>(),
    nextChapter: vi.fn<PodcastPlayer['nextChapter']>(),
    markPlayed: vi.fn<PodcastPlayer['markPlayed']>(async () => undefined),
    restartEpisode: vi.fn<PodcastPlayer['restartEpisode']>(async () => undefined),
    togglePinned: vi.fn<PodcastPlayer['togglePinned']>(async () => undefined),
    createBookmark: vi.fn<PodcastPlayer['createBookmark']>(async () => undefined),
    updateBookmark: vi.fn<PodcastPlayer['updateBookmark']>(async () => undefined),
    deleteBookmark: vi.fn<PodcastPlayer['deleteBookmark']>(async () => undefined),
    requestDownload: vi.fn<PodcastPlayer['requestDownload']>(async () => undefined),
    removeDownload: vi.fn<PodcastPlayer['removeDownload']>(async () => undefined),
    addToQueue: vi.fn<PodcastPlayer['addToQueue']>(async () => undefined),
    queueEpisodeNext: vi.fn<PodcastPlayer['queueEpisodeNext']>(async () => undefined),
    removeFromQueue: vi.fn<PodcastPlayer['removeFromQueue']>(async () => undefined),
    playPrevious: vi.fn<PodcastPlayer['playPrevious']>(async () => undefined),
    playNext: vi.fn<PodcastPlayer['playNext']>(async () => undefined),
    clearPlayer: vi.fn<PodcastPlayer['clearPlayer']>(async () => undefined),
    resetForUserChange: vi.fn<PodcastPlayer['resetForUserChange']>(async () => undefined),
    subscribeToEpisodeChanges: vi.fn<PodcastPlayer['subscribeToEpisodeChanges']>(() => () => true),
    dispose: vi.fn<PodcastPlayer['dispose']>(),
  }
  return Object.assign(stub, overrides)
}

type PodcastsComposable = ReturnType<typeof usePodcasts>

function laneStub<TItem>(items: TItem[] = []): Settable<PodcastListLane<TItem>> {
  return {
    items: ref(items) as Ref<TItem[]>,
    total: ref(items.length),
    page: ref(0),
    loading: ref(false),
    loadingMore: ref(false),
    busy: ref(false),
    error: ref(null),
    initialized: ref(true),
    hasMore: ref(false),
    load: vi.fn<PodcastListLane<TItem>['load']>(async () => undefined),
    reset: vi.fn<PodcastListLane<TItem>['reset']>(),
  }
}

export type PodcastsStub = Settable<Omit<PodcastsComposable, 'lanes'>> & {
  lanes: { [K in keyof PodcastsComposable['lanes']]: Settable<PodcastsComposable['lanes'][K]> }
}

export interface PodcastsStubSeed {
  shows?: PodcastListItem[]
  episodes?: PodcastEpisodeListItem[]
  queue?: PodcastQueueItem[]
  health?: PodcastFeedHealth[]
}

/**
 * A stand-in for `usePodcasts`, typed against its own return. The library view is the only consumer,
 * and its spec used to hand-maintain a forty-field mirror that compiled fine after every rename.
 */
export function createPodcastsStub(seed: PodcastsStubSeed = {}, overrides: Partial<PodcastsStub> = {}): PodcastsStub {
  const lanes: PodcastsStub['lanes'] = {
    shows: laneStub<PodcastListItem>(seed.shows ?? []),
    episodes: laneStub<PodcastEpisodeListItem>(seed.episodes ?? []),
    queue: laneStub<PodcastQueueItem>(seed.queue ?? []),
    health: laneStub<PodcastFeedHealth>(seed.health ?? []),
  }

  const stub: PodcastsStub = {
    lanes,
    shows: lanes.shows.items,
    episodes: lanes.episodes.items,
    queue: lanes.queue.items,
    health: lanes.health.items,
    downloadProgress: ref(new Map()),
    totalShows: lanes.shows.total,
    totalEpisodes: lanes.episodes.total,
    totalHealth: lanes.health.total,
    totalQueue: lanes.queue.total,
    queueDurationSeconds: ref(0),
    episodeDurationSeconds: ref(0),
    playlistRules: ref(null),
    filter: ref('latest'),
    showSort: ref('title'),
    episodeSort: ref('newest'),
    search: ref(''),
    followedOnly: ref(false),
    missingOnly: ref(false),
    hasMoreShows: lanes.shows.hasMore,
    hasMoreEpisodes: lanes.episodes.hasMore,
    hasMoreHealth: lanes.health.hasMore,
    hasMoreQueue: lanes.queue.hasMore,
    loadShows: vi.fn<PodcastsComposable['loadShows']>(async () => undefined),
    loadEpisodes: vi.fn<PodcastsComposable['loadEpisodes']>(async () => undefined),
    loadQueue: vi.fn<PodcastsComposable['loadQueue']>(async () => undefined),
    loadHealth: vi.fn<PodcastsComposable['loadHealth']>(async () => undefined),
    queuePlaylistEpisodes: vi.fn<PodcastsComposable['queuePlaylistEpisodes']>(async (): Promise<PodcastBulkActionResult> => ({
      completed: 0,
      failed: 0,
      skipped: 0,
    })),
    follow: vi.fn<PodcastsComposable['follow']>(async () => undefined),
    unfollow: vi.fn<PodcastsComposable['unfollow']>(async () => undefined),
    addToQueue: vi.fn<PodcastsComposable['addToQueue']>(async () => undefined),
    removeFromQueue: vi.fn<PodcastsComposable['removeFromQueue']>(async () => undefined),
    setPinned: vi.fn<PodcastsComposable['setPinned']>(async () => undefined),
    applyEpisodeMetadata: vi.fn<PodcastsComposable['applyEpisodeMetadata']>(),
  }
  return Object.assign(stub, overrides)
}

export type PodcastShowManagementStub = Settable<PodcastShowManagement>

/**
 * A stand-in for `usePodcastShowManagement`, typed against its own return so the manage sheet's
 * spec cannot drift from the composable the view actually hands it.
 */
export function createShowManagementStub(overrides: Partial<PodcastShowManagementStub> = {}): PodcastShowManagementStub {
  const stub: PodcastShowManagementStub = {
    settingsOpen: ref(false),
    manageOpen: ref(true),
    editDetailsOpen: ref(false),
    notificationMode: ref('off'),
    mergeCandidates: ref([]),
    selectedMergeSource: ref(null),
    deletePreview: ref(null),
    deleting: ref(false),
    bulkAction: ref(null),
    bulkPending: ref(false),
    requestPending: ref(false),
    confirmRemoveDownloads: ref(false),
    deleteNeedsTypedConfirmation: ref(false),
    deleteDescription: ref(''),
    downloadLatestOptions: [1, 3, 5, 10, 20, 50],
    queueAllEpisodes: vi.fn<PodcastShowManagement['queueAllEpisodes']>(async () => undefined),
    runPrimaryAction: vi.fn<PodcastShowManagement['runPrimaryAction']>(async () => undefined),
    markAllEpisodesPlayed: vi.fn<PodcastShowManagement['markAllEpisodesPlayed']>(async () => undefined),
    downloadLatestEpisodesByCount: vi.fn<PodcastShowManagement['downloadLatestEpisodesByCount']>(async () => undefined),
    requestRemoveAllDownloads: vi.fn<PodcastShowManagement['requestRemoveAllDownloads']>(),
    cancelRemoveAllDownloads: vi.fn<PodcastShowManagement['cancelRemoveAllDownloads']>(),
    removeAllDownloads: vi.fn<PodcastShowManagement['removeAllDownloads']>(async () => undefined),
    follow: vi.fn<PodcastShowManagement['follow']>(async () => undefined),
    unfollow: vi.fn<PodcastShowManagement['unfollow']>(async () => undefined),
    handleNotificationModeUpdate: vi.fn<PodcastShowManagement['handleNotificationModeUpdate']>(async () => undefined),
    refresh: vi.fn<PodcastShowManagement['refresh']>(async () => undefined),
    openSettings: vi.fn<PodcastShowManagement['openSettings']>(),
    handleSettingsOpenChange: vi.fn<PodcastShowManagement['handleSettingsOpenChange']>(),
    openEditDetails: vi.fn<PodcastShowManagement['openEditDetails']>(),
    handleEditDetailsOpenChange: vi.fn<PodcastShowManagement['handleEditDetailsOpenChange']>(),
    applyMetadataUpdate: vi.fn<PodcastShowManagement['applyMetadataUpdate']>(),
    applyArtworkUpdate: vi.fn<PodcastShowManagement['applyArtworkUpdate']>(),
    openManage: vi.fn<PodcastShowManagement['openManage']>(),
    closeManage: vi.fn<PodcastShowManagement['closeManage']>(),
    handleManageOpenChange: vi.fn<PodcastShowManagement['handleManageOpenChange']>(),
    saveSettings: vi.fn<PodcastShowManagement['saveSettings']>(async () => undefined),
    archive: vi.fn<PodcastShowManagement['archive']>(async () => undefined),
    restore: vi.fn<PodcastShowManagement['restore']>(async () => undefined),
    prepareDelete: vi.fn<PodcastShowManagement['prepareDelete']>(async () => undefined),
    cancelDelete: vi.fn<PodcastShowManagement['cancelDelete']>(),
    deleteShow: vi.fn<PodcastShowManagement['deleteShow']>(async () => undefined),
    searchMergeCandidates: vi.fn<PodcastShowManagement['searchMergeCandidates']>(async () => undefined),
    selectMergeCandidate: vi.fn<PodcastShowManagement['selectMergeCandidate']>(),
    cancelMerge: vi.fn<PodcastShowManagement['cancelMerge']>(),
    merge: vi.fn<PodcastShowManagement['merge']>(async () => undefined),
  }
  return Object.assign(stub, overrides)
}

/**
 * `vue-virtual-scroller` rendering its slots, so a spec exercises the rows a view actually shows.
 * A `<div />` stub compiles and passes while covering nothing.
 */
export function virtualScrollerStubs() {
  return {
    DynamicScroller: {
      name: 'DynamicScroller',
      props: ['items'],
      template: '<div><slot v-for="(item, index) in items" :item="item" :index="index" :active="true" /></div>',
    },
    DynamicScrollerItem: { name: 'DynamicScrollerItem', template: '<div><slot /></div>' },
  }
}
