import { getCurrentScope, onScopeDispose, ref } from 'vue'
import { type Socket } from 'socket.io-client'
import type {
  PodcastDownloadCompleteEvent,
  PodcastDownloadProgressEvent,
  PodcastImportProgressEvent,
  PodcastRefreshCompleteEvent,
  PodcastRetentionEvictedEvent,
  PodcastShowDiscoveredEvent,
} from '@bookorbit/types'
import { createAuthenticatedSocket } from '@/lib/socket'

type DownloadProgressCallback = (event: PodcastDownloadProgressEvent) => void
type DownloadCompleteCallback = (event: PodcastDownloadCompleteEvent) => void
type RefreshCompleteCallback = (event: PodcastRefreshCompleteEvent) => void
type ImportProgressCallback = (event: PodcastImportProgressEvent) => void
type RetentionEvictedCallback = (event: PodcastRetentionEvictedEvent) => void
type ShowDiscoveredCallback = (event: PodcastShowDiscoveredEvent) => void

let socket: Socket | null = null
const connected = ref(false)
const subscribedLibraries = new Set<number>()
const downloadProgress = ref<Map<number, PodcastDownloadProgressEvent>>(new Map())
const importProgress = ref<Map<number, PodcastImportProgressEvent>>(new Map())
const downloadProgressCallbacks = new Set<DownloadProgressCallback>()
const downloadCompleteCallbacks = new Set<DownloadCompleteCallback>()
const refreshCompleteCallbacks = new Set<RefreshCompleteCallback>()
const importProgressCallbacks = new Set<ImportProgressCallback>()
const retentionEvictedCallbacks = new Set<RetentionEvictedCallback>()
const showDiscoveredCallbacks = new Set<ShowDiscoveredCallback>()

function getSocket(): Socket {
  if (socket) return socket
  const connection = createAuthenticatedSocket('/podcasts', { autoConnect: true })
  socket = connection
  connection.on('connect', () => {
    connected.value = true
    for (const libraryId of subscribedLibraries) connection.emit('subscribe:library', libraryId)
  })
  socket.on('disconnect', () => {
    connected.value = false
    downloadProgress.value = new Map()
    importProgress.value = new Map()
  })
  socket.on('podcast:download:progress', (event: PodcastDownloadProgressEvent) => {
    downloadProgress.value = new Map(downloadProgress.value).set(event.episodeId, event)
    for (const callback of downloadProgressCallbacks) callback(event)
  })
  socket.on('podcast:download:complete', (event: PodcastDownloadCompleteEvent) => {
    const next = new Map(downloadProgress.value)
    next.delete(event.episodeId)
    downloadProgress.value = next
    for (const callback of downloadCompleteCallbacks) callback(event)
  })
  socket.on('podcast:refresh:complete', (event: PodcastRefreshCompleteEvent) => {
    for (const callback of refreshCompleteCallbacks) callback(event)
  })
  socket.on('podcast:import:progress', (event: PodcastImportProgressEvent) => {
    importProgress.value = new Map(importProgress.value).set(event.libraryId, event)
    for (const callback of importProgressCallbacks) callback(event)
  })
  socket.on('podcast:show:discovered', (event: PodcastShowDiscoveredEvent) => {
    for (const callback of showDiscoveredCallbacks) callback(event)
  })
  socket.on('podcast:retention:evicted', (event: PodcastRetentionEvictedEvent) => {
    for (const callback of retentionEvictedCallbacks) callback(event)
  })
  return socket
}

/** Scope rather than instance: a composable used inside a bare `effectScope` has no instance to unmount. */
function registerCallback<T>(callbacks: Set<(event: T) => void>, callback: (event: T) => void): () => void {
  callbacks.add(callback)
  const cleanup = () => callbacks.delete(callback)
  if (getCurrentScope()) onScopeDispose(cleanup)
  return cleanup
}

/**
 * Drops the previous user's socket along with the rooms it had joined: the room grants access to a
 * library's events, and the next user may not have it. The next consumer opens a fresh connection,
 * which re-authenticates with the new token.
 */
function resetForUserChange(): void {
  subscribedLibraries.clear()
  downloadProgress.value = new Map()
  importProgress.value = new Map()
  connected.value = false
  socket?.disconnect()
  socket = null
}

export function usePodcastEvents() {
  getSocket()

  function subscribeLibrary(libraryId: number): void {
    if (!Number.isInteger(libraryId) || libraryId <= 0) return
    subscribedLibraries.add(libraryId)
    getSocket().emit('subscribe:library', libraryId)
  }

  return {
    resetForUserChange,
    connected,
    downloadProgress,
    importProgress,
    subscribeLibrary,
    onDownloadProgress: (callback: DownloadProgressCallback) => registerCallback(downloadProgressCallbacks, callback),
    onDownloadComplete: (callback: DownloadCompleteCallback) => registerCallback(downloadCompleteCallbacks, callback),
    onRefreshComplete: (callback: RefreshCompleteCallback) => registerCallback(refreshCompleteCallbacks, callback),
    onShowDiscovered: (callback: ShowDiscoveredCallback) => registerCallback(showDiscoveredCallbacks, callback),
    onImportProgress: (callback: ImportProgressCallback) => registerCallback(importProgressCallbacks, callback),
    onRetentionEvicted: (callback: RetentionEvictedCallback) => registerCallback(retentionEvictedCallbacks, callback),
  }
}
