import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import type { CoverRefreshedEvent, CoverRefreshProgressEvent, ScanProgressEvent } from '@projectx/types'
import { getAccessToken } from '@/lib/api'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'

let socket: Socket | null = null
const progressMap = ref<Map<number, ScanProgressEvent>>(new Map())
const coverRefreshMap = ref<Map<number, CoverRefreshProgressEvent>>(new Map())
const subscribedLibraries = new Set<number>()

function getSocket(): Socket {
  if (!socket) {
    // Use a callback so getAccessToken() is called at (re)connect time, not just once at creation.
    socket = io('/scan', {
      auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
      autoConnect: true,
    })

    socket.on('scan:progress', (event: ScanProgressEvent) => {
      progressMap.value.set(event.libraryId, event)
      progressMap.value = new Map(progressMap.value)
      if (event.status !== 'running') {
        // Keep the final event for a short time so UI can show completion, then clear.
        setTimeout(() => {
          progressMap.value.delete(event.libraryId)
          progressMap.value = new Map(progressMap.value)
        }, 3000)
      }
    })

    socket.on('cover:refresh:progress', (event: CoverRefreshProgressEvent) => {
      coverRefreshMap.value = new Map(coverRefreshMap.value).set(event.libraryId, event)
      if (event.status === 'completed') {
        setTimeout(() => {
          coverRefreshMap.value.delete(event.libraryId)
          coverRefreshMap.value = new Map(coverRefreshMap.value)
        }, 3000)
      }
    })

    socket.on('cover:refreshed', (event: CoverRefreshedEvent) => {
      useCoverVersions().bumpVersion(event.bookId)
    })

    socket.on('disconnect', () => {
      // Clear stale progress bars but keep subscribedLibraries so we can re-subscribe on reconnect.
      progressMap.value = new Map()
    })

    socket.on('connect', () => {
      // Re-subscribe to all libraries after reconnect (server-side rooms are per-socket).
      for (const id of subscribedLibraries) {
        socket!.emit('subscribe:library', id)
      }
    })
  }
  return socket
}

export { getSocket }

export function useScanProgress() {
  function subscribeLibrary(libraryId: number): void {
    if (subscribedLibraries.has(libraryId)) return
    subscribedLibraries.add(libraryId)
    getSocket().emit('subscribe:library', libraryId)
  }

  function getProgress(libraryId: number): ScanProgressEvent | undefined {
    return progressMap.value.get(libraryId)
  }

  function isScanning(libraryId: number): boolean {
    return progressMap.value.get(libraryId)?.status === 'running'
  }

  function getCoverRefreshProgress(libraryId: number): CoverRefreshProgressEvent | undefined {
    return coverRefreshMap.value.get(libraryId)
  }

  function isRefreshingCovers(libraryId: number): boolean {
    return coverRefreshMap.value.get(libraryId)?.status === 'running'
  }

  return { subscribeLibrary, getProgress, isScanning, progressMap, getCoverRefreshProgress, isRefreshingCovers, coverRefreshMap }
}
