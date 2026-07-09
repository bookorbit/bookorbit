import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import { api, getAccessToken } from '@/lib/api'
import type { BookDockSummary } from '@bookorbit/types'

const summary = ref<BookDockSummary>({ pending: 0, ready: 0, error: 0, total: 0, paused: false })
const loading = ref(false)
const socketConnected = ref(true)
let socket: Socket | null = null
const changeListeners = new Set<() => void>()
let fetchPromise: Promise<void> | null = null
let loaded = false

function requestSummary(markLoading: boolean): Promise<void> {
  if (fetchPromise) return fetchPromise
  if (markLoading) loading.value = true
  fetchPromise = api('/api/v1/book-dock/summary')
    .then(async (res) => {
      if (res.ok) {
        summary.value = await res.json()
        loaded = true
      }
    })
    .catch(() => {
      // best-effort refresh on reconnect
    })
    .finally(() => {
      if (markLoading) loading.value = false
      fetchPromise = null
    })
  return fetchPromise
}

async function restFetchSummary() {
  return requestSummary(false)
}

function getSocket(): Socket {
  if (!socket) {
    socket = io('/book-dock', {
      auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    socket.on('book-dock:summary', (data: BookDockSummary) => {
      summary.value = data
      for (const fn of changeListeners) fn()
    })

    socket.on('connect', () => {
      socketConnected.value = true
      restFetchSummary()
    })

    socket.on('disconnect', () => {
      socketConnected.value = false
    })
  }
  return socket
}

export function useBookDockSummary() {
  async function fetchSummary(force = false): Promise<void> {
    if (!force && loaded) return
    return requestSummary(true)
  }

  function subscribe() {
    getSocket()
  }

  function onBookDockChange(fn: () => void) {
    changeListeners.add(fn)
    return () => changeListeners.delete(fn)
  }

  return { summary, loading, socketConnected, fetchSummary, subscribe, onBookDockChange }
}
