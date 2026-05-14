import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  getAccessToken: vi.fn<() => string | null>().mockReturnValue('test-token'),
}))

type SocketEventHandler = (...args: unknown[]) => void

interface MockSocket {
  on: ReturnType<typeof vi.fn>
  emit: ReturnType<typeof vi.fn>
  _handlers: Record<string, SocketEventHandler>
  _trigger: (event: string, ...args: unknown[]) => void
}

function createMockSocket(): MockSocket {
  const handlers: Record<string, SocketEventHandler> = {}
  const socket: MockSocket = {
    on: vi.fn<(event: string, handler: SocketEventHandler) => void>((event, handler) => {
      handlers[event] = handler
    }),
    emit: vi.fn<(...args: unknown[]) => void>(),
    _handlers: handlers,
    _trigger: (event: string, ...args: unknown[]) => handlers[event]?.(...args),
  }
  return socket
}

let mockSocket: MockSocket

vi.mock('socket.io-client', () => ({
  io: vi.fn<() => MockSocket>(() => mockSocket),
}))

beforeEach(async () => {
  mockSocket = createMockSocket()
  vi.resetModules()
})

async function importUseMigrationProgress() {
  const mod = await import('./useMigrationProgress')
  return mod.useMigrationProgress
}

describe('useMigrationProgress', () => {
  describe('subscribeRun', () => {
    it('emits subscribe:run with the runId', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { subscribeRun } = useMigrationProgress()
      subscribeRun(42)
      expect(mockSocket.emit).toHaveBeenCalledWith('subscribe:run', 42)
    })

    it('emits subscribe:run for each runId subscribed', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { subscribeRun } = useMigrationProgress()
      subscribeRun(1)
      subscribeRun(2)
      expect(mockSocket.emit).toHaveBeenCalledWith('subscribe:run', 1)
      expect(mockSocket.emit).toHaveBeenCalledWith('subscribe:run', 2)
    })
  })

  describe('unsubscribeRun', () => {
    it('removes the runId from the progress map', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { subscribeRun, unsubscribeRun, progressMap } = useMigrationProgress()

      subscribeRun(10)
      mockSocket._trigger('migration:progress', {
        runId: 10,
        state: 'running',
        currentStage: null,
        totals: { processed: 5, imported: 0, skipped: 0, unresolved: 0, failed: 0 },
        metrics: [],
      })

      expect(progressMap.value.has(10)).toBe(true)
      unsubscribeRun(10)
      expect(progressMap.value.has(10)).toBe(false)
    })

    it('is safe to call for a runId that was never subscribed', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { unsubscribeRun, progressMap } = useMigrationProgress()
      expect(() => unsubscribeRun(999)).not.toThrow()
      expect(progressMap.value.has(999)).toBe(false)
    })
  })

  describe('getProgress', () => {
    it('returns undefined when no progress event received', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { getProgress } = useMigrationProgress()
      expect(getProgress(1)).toBeUndefined()
    })

    it('returns the progress event after migration:progress is received', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { subscribeRun, getProgress } = useMigrationProgress()
      subscribeRun(7)
      const event = {
        runId: 7,
        state: 'running' as const,
        currentStage: null,
        totals: { processed: 10, imported: 0, skipped: 0, unresolved: 0, failed: 0 },
        metrics: [],
      }
      mockSocket._trigger('migration:progress', event)
      expect(getProgress(7)).toEqual(event)
    })
  })

  describe('isRunning', () => {
    it('returns false when no progress event received', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { isRunning } = useMigrationProgress()
      expect(isRunning(5)).toBe(false)
    })

    it('returns true when progress state is running', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { subscribeRun, isRunning } = useMigrationProgress()
      subscribeRun(5)
      mockSocket._trigger('migration:progress', {
        runId: 5,
        state: 'running',
        currentStage: null,
        totals: { processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 },
        metrics: [],
      })
      expect(isRunning(5)).toBe(true)
    })

    it('returns false when progress state is completed', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { subscribeRun, isRunning } = useMigrationProgress()
      subscribeRun(5)
      mockSocket._trigger('migration:progress', {
        runId: 5,
        state: 'completed',
        currentStage: null,
        totals: { processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 },
        metrics: [],
      })
      expect(isRunning(5)).toBe(false)
    })
  })

  describe('socket events', () => {
    it('clears progressMap on disconnect', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { subscribeRun, progressMap } = useMigrationProgress()
      subscribeRun(1)
      mockSocket._trigger('migration:progress', {
        runId: 1,
        state: 'running',
        currentStage: null,
        totals: { processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 },
        metrics: [],
      })
      expect(progressMap.value.size).toBe(1)
      mockSocket._trigger('disconnect')
      expect(progressMap.value.size).toBe(0)
    })

    it('re-subscribes all runs on reconnect', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { subscribeRun } = useMigrationProgress()
      subscribeRun(1)
      subscribeRun(2)
      mockSocket.emit.mockClear()
      mockSocket._trigger('connect')
      expect(mockSocket.emit).toHaveBeenCalledWith('subscribe:run', 1)
      expect(mockSocket.emit).toHaveBeenCalledWith('subscribe:run', 2)
    })

    it('overwrites previous progress event for the same runId', async () => {
      const useMigrationProgress = await importUseMigrationProgress()
      const { subscribeRun, getProgress } = useMigrationProgress()
      subscribeRun(3)
      const totals = { processed: 0, imported: 0, skipped: 0, unresolved: 0, failed: 0 }
      mockSocket._trigger('migration:progress', { runId: 3, state: 'running', currentStage: null, totals: { ...totals, processed: 10 }, metrics: [] })
      mockSocket._trigger('migration:progress', { runId: 3, state: 'running', currentStage: null, totals: { ...totals, processed: 20 }, metrics: [] })
      expect(getProgress(3)?.totals.processed).toBe(20)
    })
  })
})
