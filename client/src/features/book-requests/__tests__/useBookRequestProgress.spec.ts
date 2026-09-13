import { mount } from '@vue/test-utils'
import { computed, defineComponent, nextTick, watchEffect } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { BookRequestDownloadStatus, BookRequestItem, BookRequestProgressEvent } from '@bookorbit/types'

const { socketHandlers, socketMock } = vi.hoisted(() => {
  const socketHandlers = new Map<string, (payload: never) => void>()
  const socketMock = {
    on: vi.fn<(event: string, handler: (payload: never) => void) => void>((event, handler) => {
      socketHandlers.set(event, handler)
    }),
    disconnect: vi.fn<() => void>(),
  }
  return { socketHandlers, socketMock }
})

vi.mock('@/lib/socket', () => ({ createAuthenticatedSocket: vi.fn<() => typeof socketMock>(() => socketMock) }))

import { useBookRequestProgress } from '../composables/useBookRequestProgress'

function progress(requestId: number): BookRequestProgressEvent {
  return {
    requestId,
    downloadId: requestId * 10,
    status: 'downloading',
    progressPercent: 25,
    downloadedBytes: 25,
    totalBytes: 100,
  }
}

function settledRow(requestId: number, status: BookRequestDownloadStatus, downloadId = requestId * 10): Pick<BookRequestItem, 'id' | 'download'> {
  return { id: requestId, download: { id: downloadId, status } as BookRequestItem['download'] }
}

/** Mounts a component that hands the composable straight back, so a test can drive it directly. */
function mountProgress() {
  let api!: ReturnType<typeof useBookRequestProgress>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useBookRequestProgress()
        return {}
      },
      template: '<div />',
    }),
  )
  return { api, wrapper }
}

describe('useBookRequestProgress', () => {
  it('does not invalidate a request-specific consumer for another request tick', async () => {
    let renders = 0
    const wrapper = mount(
      defineComponent({
        setup() {
          const { progressByRequest } = useBookRequestProgress()
          const current = computed(() => progressByRequest.value[7])
          watchEffect(() => {
            void current.value
            renders++
          })
          return {}
        },
        template: '<div />',
      }),
    )

    expect(renders).toBe(1)

    socketHandlers.get('book-requests:progress')?.(progress(8) as never)
    await nextTick()
    expect(renders).toBe(1)

    socketHandlers.get('book-requests:progress')?.(progress(7) as never)
    await nextTick()
    expect(renders).toBe(2)

    wrapper.unmount()
  })

  it('drops a tick once the fetched row shows the same attempt has settled', async () => {
    const { api, wrapper } = mountProgress()

    socketHandlers.get('book-requests:progress')?.(progress(7) as never)
    await nextTick()
    expect(api.progressByRequest.value[7]).toBeDefined()

    api.pruneSettledProgress([settledRow(7, 'imported')])
    expect(api.progressByRequest.value[7]).toBeUndefined()

    wrapper.unmount()
  })

  /** A fetch that started before a fresh grab describes the previous attempt, not the live one. */
  it('keeps a tick that belongs to a newer attempt than the fetched row', async () => {
    const { api, wrapper } = mountProgress()

    socketHandlers.get('book-requests:progress')?.(progress(7) as never)
    await nextTick()

    api.pruneSettledProgress([settledRow(7, 'failed', 999)])
    expect(api.progressByRequest.value[7]).toBeDefined()

    api.pruneSettledProgress([settledRow(7, 'downloading')])
    expect(api.progressByRequest.value[7]).toBeDefined()

    wrapper.unmount()
  })

  it('forgets a request the moment a terminal tick arrives for it', async () => {
    const { api, wrapper } = mountProgress()

    socketHandlers.get('book-requests:progress')?.(progress(7) as never)
    await nextTick()

    socketHandlers.get('book-requests:progress')?.({ ...progress(7), status: 'failed' } as never)
    await nextTick()
    expect(api.progressByRequest.value[7]).toBeUndefined()

    wrapper.unmount()
  })

  /**
   * The server replays nothing, so every event that landed while the socket was down is gone. A
   * laptop that slept or a server restarted mid-transfer leaves rows reading "downloading 97%"
   * until somebody changes a filter or reloads, which for an approver with a pinned tab is the
   * ordinary case rather than an edge one.
   */
  describe('after a dropped connection', () => {
    function mountListener() {
      const listener = vi.fn<() => void>()
      const wrapper = mount(
        defineComponent({
          setup() {
            useBookRequestProgress().onRequestsChanged(listener)
            return {}
          },
          template: '<div />',
        }),
      )
      return { listener, wrapper }
    }

    it('refetches when the socket comes back', () => {
      const { listener, wrapper } = mountListener()

      socketHandlers.get('disconnect')?.(undefined as never)
      socketHandlers.get('connect')?.(undefined as never)

      expect(listener).toHaveBeenCalledTimes(1)

      wrapper.unmount()
    })

    /** Every page fetches on mount, so answering the first connect would only fetch everything twice. */
    it('does not refetch on the first connect', () => {
      const { listener, wrapper } = mountListener()

      socketHandlers.get('connect')?.(undefined as never)

      expect(listener).not.toHaveBeenCalled()

      wrapper.unmount()
    })

    it('refetches once per drop rather than once per connect event', () => {
      const { listener, wrapper } = mountListener()

      socketHandlers.get('disconnect')?.(undefined as never)
      socketHandlers.get('connect')?.(undefined as never)
      socketHandlers.get('connect')?.(undefined as never)

      expect(listener).toHaveBeenCalledTimes(1)

      wrapper.unmount()
    })

    it('refetches when the first connection succeeds after an earlier attempt failed', () => {
      const { listener, wrapper } = mountListener()

      socketHandlers.get('connect_error')?.(new Error('server unavailable') as never)
      socketHandlers.get('connect')?.(undefined as never)

      expect(listener).toHaveBeenCalledTimes(1)

      wrapper.unmount()
    })
  })

  it('stops calling a change listener once its scope is gone', () => {
    const listener = vi.fn<() => void>()
    let api!: ReturnType<typeof useBookRequestProgress>
    const wrapper = mount(
      defineComponent({
        setup() {
          api = useBookRequestProgress()
          api.onRequestsChanged(listener)
          return {}
        },
        template: '<div />',
      }),
    )

    socketHandlers.get('book-requests:changed')?.(undefined as never)
    expect(listener).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    socketHandlers.get('book-requests:changed')?.(undefined as never)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
