import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import { api, getAccessToken } from '@/lib/api'
import type { BookBucketSummary } from '@projectx/types'

const summary = ref<BookBucketSummary>({ pending: 0, ready: 0, error: 0, total: 0 })
const loading = ref(false)
const socketConnected = ref(true)
let socket: Socket | null = null
const changeListeners = new Set<() => void>()
let fetchPromise: Promise<void> | null = null
let loaded = false

function requestSummary(markLoading: boolean): Promise<void> {
  if (fetchPromise) return fetchPromise
  if (markLoading) loading.value = true
  fetchPromise = api('/api/v1/book-bucket/summary')
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
    socket = io('/book-bucket', {
      auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    socket.on('book-bucket:summary', (data: BookBucketSummary) => {
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

export function useBookBucketSummary() {
  async function fetchSummary(force = false): Promise<void> {
    if (!force && loaded) return
    return requestSummary(true)
  }

  function subscribe() {
    getSocket()
  }

  function onBookBucketChange(fn: () => void) {
    changeListeners.add(fn)
    return () => changeListeners.delete(fn)
  }

  return { summary, loading, socketConnected, fetchSummary, subscribe, onBookBucketChange }
}
