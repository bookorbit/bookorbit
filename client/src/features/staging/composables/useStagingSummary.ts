import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import { api, getAccessToken } from '@/lib/api'
import type { StagingSummary } from '@projectx/types'

const summary = ref<StagingSummary>({ pending: 0, ready: 0, error: 0, total: 0 })
const loading = ref(false)
const socketConnected = ref(true)
let socket: Socket | null = null
const changeListeners = new Set<() => void>()
let fetchPromise: Promise<void> | null = null
let loaded = false

async function restFetchSummary() {
  if (fetchPromise) return fetchPromise
  try {
    const res = await api('/api/v1/staging/summary')
    if (res.ok) summary.value = await res.json()
  } catch {
    // best-effort refresh on reconnect
  }
}

function getSocket(): Socket {
  if (!socket) {
    socket = io('/staging', {
      auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    socket.on('staging:summary', (data: StagingSummary) => {
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

export function useStagingSummary() {
  async function fetchSummary(): Promise<void> {
    if (loaded) return
    if (fetchPromise) return fetchPromise
    loading.value = true
    fetchPromise = api('/api/v1/staging/summary')
      .then(async (res) => {
        if (res.ok) {
          summary.value = await res.json()
          loaded = true
        }
      })
      .finally(() => {
        loading.value = false
        fetchPromise = null
      })
    return fetchPromise
  }

  function subscribe() {
    getSocket()
  }

  function onStagingChange(fn: () => void) {
    changeListeners.add(fn)
    return () => changeListeners.delete(fn)
  }

  return { summary, loading, socketConnected, fetchSummary, subscribe, onStagingChange }
}
