import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import type { MigrationProgressEvent } from '@bookorbit/types'
import { getAccessToken } from '@/lib/api'

let socket: Socket | null = null
const progressMap = ref<Map<number, MigrationProgressEvent>>(new Map())
const subscribedRuns = new Set<number>()

function getSocket(): Socket {
  if (!socket) {
    socket = io('/migration', {
      auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
      autoConnect: true,
    })

    socket.on('migration:progress', (event: MigrationProgressEvent) => {
      progressMap.value.set(event.runId, event)
      progressMap.value = new Map(progressMap.value)
    })

    socket.on('disconnect', () => {
      progressMap.value = new Map()
    })

    socket.on('connect', () => {
      for (const runId of subscribedRuns) {
        socket!.emit('subscribe:run', runId)
      }
    })
  }
  return socket
}

export function useMigrationProgress() {
  function subscribeRun(runId: number): void {
    subscribedRuns.add(runId)
    getSocket().emit('subscribe:run', runId)
  }

  function unsubscribeRun(runId: number): void {
    subscribedRuns.delete(runId)
    progressMap.value.delete(runId)
    progressMap.value = new Map(progressMap.value)
  }

  function getProgress(runId: number): MigrationProgressEvent | undefined {
    return progressMap.value.get(runId)
  }

  function isRunning(runId: number): boolean {
    return progressMap.value.get(runId)?.state === 'running'
  }

  return { subscribeRun, unsubscribeRun, getProgress, isRunning, progressMap }
}
