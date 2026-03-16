import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import type { BookMetadataFetchStatusEvent } from '@projectx/types'
import { getAccessToken } from '@/lib/api'

const status = ref<BookMetadataFetchStatusEvent>({
  queued: 0,
  processing: 0,
  failed: 0,
  paused: false,
  sessionTotal: 0,
  sessionDone: 0,
  currentItemName: null,
})
const socketConnected = ref(true)
let socket: Socket | null = null

function getSocket(): Socket {
  if (!socket) {
    socket = io('/book-metadata-fetch', {
      auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    socket.on('book-metadata-fetch:status', (data: BookMetadataFetchStatusEvent) => {
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

export function useBookMetadataFetchStatus() {
  function subscribe() {
    getSocket()
  }

  return { status, socketConnected, subscribe }
}

export function disconnectBookMetadataFetchSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  status.value = { queued: 0, processing: 0, failed: 0, paused: false, sessionTotal: 0, sessionDone: 0, currentItemName: null }
  socketConnected.value = true
}
