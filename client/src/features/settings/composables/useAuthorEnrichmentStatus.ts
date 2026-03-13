import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import type { AuthorEnrichmentStatus } from '@projectx/types'
import { getAccessToken } from '@/lib/api'

const status = ref<AuthorEnrichmentStatus>({
  queued: 0,
  processing: 0,
  rateLimited: 0,
  failed: 0,
  done: 0,
  total: 0,
})
const socketConnected = ref(true)
let socket: Socket | null = null

function getSocket(): Socket {
  if (!socket) {
    socket = io('/authors-enrichment', {
      auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    socket.on('author-enrichment:status', (data: AuthorEnrichmentStatus) => {
      status.value = data
    })

    socket.on('connect', () => {
      socketConnected.value = true
    })

    socket.on('disconnect', () => {
      socketConnected.value = false
    })
  }
  return socket
}

export function useAuthorEnrichmentStatus() {
  function subscribe() {
    getSocket()
  }

  return { status, socketConnected, subscribe }
}
