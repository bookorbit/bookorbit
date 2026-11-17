import { defineComponent, h, ref, type Ref } from 'vue'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerFeature, StoryGuideStatus, StoryGuidesAppInfo } from '@bookorbit/types'
import type * as StoryGuideApi from '../api/story-guide.api'
import type { StoryGuideWatcher } from '../lib/story-guide-socket'

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  features: [] as string[],
  storyGuides: null as StoryGuidesAppInfo | null,
  ensureAppInfo: vi.fn<() => Promise<void>>(),
  toastError: vi.fn<(message: string) => void>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => mocks.permissions.has(name) }),
}))

vi.mock('@/features/settings/composables/useAppInfo', async () => {
  const { ref } = await import('vue')
  return {
    useAppInfo: () => ({
      ensureAppInfo: mocks.ensureAppInfo,
      supportsFeature: (feature: ServerFeature) => mocks.features.includes(feature),
      storyGuides: ref(mocks.storyGuides),
    }),
  }
})

const socket = vi.hoisted(() => ({
  watchers: new Map<number, StoryGuideWatcher>(),
  unwatched: [] as number[],
}))

vi.mock('../lib/story-guide-socket', () => ({
  watchStoryGuide: (bookId: number, watcher: StoryGuideWatcher) => {
    socket.watchers.set(bookId, watcher)
    return () => {
      socket.unwatched.push(bookId)
      socket.watchers.delete(bookId)
    }
  },
}))

vi.mock('vue-sonner', () => ({ toast: { error: mocks.toastError, success: vi.fn<(message: string) => void>() } }))

vi.mock('../api/story-guide.api', () => ({
  getStoryGuideStatus: vi.fn<typeof StoryGuideApi.getStoryGuideStatus>(),
  buildStoryGuide: vi.fn<typeof StoryGuideApi.buildStoryGuide>(),
  retryStoryGuide: vi.fn<typeof StoryGuideApi.retryStoryGuide>(),
  cancelStoryGuide: vi.fn<typeof StoryGuideApi.cancelStoryGuide>(),
  deleteStoryGuide: vi.fn<typeof StoryGuideApi.deleteStoryGuide>(),
}))

import { ApiError } from '@/lib/api-json'
import * as storyGuideApi from '../api/story-guide.api'
import { useStoryGuideStatus } from './useStoryGuideStatus'

const getStatus = vi.mocked(storyGuideApi.getStoryGuideStatus)

function status(overrides: Partial<StoryGuideStatus> = {}): StoryGuideStatus {
  return {
    fileId: 812,
    textKey: 'a'.repeat(64),
    canManage: true,
    build: { allowed: true },
    guide: null,
    job: null,
    estimate: { words: 98_000, minutes: 6, cost: 0.1 },
    ...overrides,
  }
}

const RUNNING = status({ job: { kind: 'build', state: 'running', phase: 'lines', done: 3, total: 30, minutesLeft: 5 } })
const GUIDE = { builtAt: '2026-11-09T18:20:00.000Z', coverage: 1, format: 1, outdated: false, modelsChanged: false }

function fresh(value: StoryGuideStatus, etag = '"e1"') {
  return { kind: 'fresh' as const, status: value, etag }
}

function mountStatus(bookId: Ref<number> = ref(7)) {
  let api!: ReturnType<typeof useStoryGuideStatus>
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useStoryGuideStatus(bookId)
        return () => h('div')
      },
    }),
  )
  return { wrapper, api: () => api, bookId }
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

// A component left mounted keeps hearing `visibilitychange` and would ask during the next test.
enableAutoUnmount(afterEach)

describe('useStoryGuideStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.permissions = new Set(['library_generate_story_guide'])
    mocks.features = ['story-guides']
    mocks.storyGuides = { building: true, served: true }
    mocks.ensureAppInfo.mockResolvedValue()
    socket.watchers.clear()
    socket.unwatched = []
    setVisibility('visible')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('asks nothing for someone who cannot build story guides', async () => {
    mocks.permissions = new Set()
    const { api } = mountStatus()
    await flushPromises()
    expect(mocks.ensureAppInfo).not.toHaveBeenCalled()
    expect(getStatus).not.toHaveBeenCalled()
    expect(api().presentation.value.menu).toEqual([])
  })

  it('asks nothing of a server that does not advertise story guides', async () => {
    mocks.features = ['story-edits']
    mocks.storyGuides = null
    mountStatus()
    await flushPromises()
    expect(mocks.ensureAppInfo).toHaveBeenCalledOnce()
    expect(getStatus).not.toHaveBeenCalled()
  })

  it('asks nothing of a server that neither builds guides nor has any', async () => {
    mocks.storyGuides = { building: false, served: false }
    mountStatus()
    await flushPromises()
    expect(getStatus).not.toHaveBeenCalled()
  })

  it.each([
    ['builds guides', { building: true, served: false }],
    ['has guides', { building: false, served: true }],
    ['says nothing either way', null],
  ])('asks a server that %s, letting it pick the file', async (_label, info) => {
    mocks.storyGuides = info
    getStatus.mockResolvedValue(fresh(status()))
    const { api } = mountStatus()
    await flushPromises()
    expect(getStatus).toHaveBeenCalledWith(7, null, null)
    expect(api().presentation.value.menu).toEqual(['build'])
  })

  it('shows nothing when the status route is missing', async () => {
    getStatus.mockResolvedValue({ kind: 'missing' })
    const { api } = mountStatus()
    await flushPromises()
    expect(api().status.value).toBeNull()
    expect(api().presentation.value).toEqual({ rows: [], menu: [], builtNote: null })
  })

  it('does not poll a book with nothing building', async () => {
    getStatus.mockResolvedValue(fresh(status({ guide: GUIDE })))
    mountStatus()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(getStatus).toHaveBeenCalledOnce()
  })

  it('polls while building with the last ETag, backing off while nothing changes and stopping when the guide is ready', async () => {
    getStatus.mockResolvedValueOnce(fresh(RUNNING, '"e1"')).mockResolvedValue({ kind: 'not-modified' })
    const { api } = mountStatus()
    await flushPromises()
    expect(getStatus).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(4_999)
    expect(getStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(getStatus).toHaveBeenLastCalledWith(7, null, '"e1"')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(getStatus).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(getStatus).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(40_000)
    expect(getStatus).toHaveBeenCalledTimes(5)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getStatus).toHaveBeenCalledTimes(6)

    const moved = status({ job: { kind: 'build', state: 'running', phase: 'lines', done: 9, total: 30, minutesLeft: 3 } })
    getStatus.mockResolvedValueOnce(fresh(moved, '"e2"'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getStatus).toHaveBeenCalledTimes(7)
    expect(api().presentation.value.rows[0]).toMatchObject({ kind: 'progress', minutesLeft: 3 })

    getStatus.mockResolvedValueOnce(fresh(status({ guide: GUIDE }), '"e3"'))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(getStatus).toHaveBeenCalledTimes(8)
    expect(api().presentation.value.menu).toEqual(['rebuild', 'delete'])
    await vi.advanceTimersByTimeAsync(120_000)
    expect(getStatus).toHaveBeenCalledTimes(8)
  })

  it('stops polling while the page is hidden, and asks at once when a build is still going on its return', async () => {
    getStatus.mockResolvedValueOnce(fresh(RUNNING)).mockResolvedValue({ kind: 'not-modified' })
    mountStatus()
    await flushPromises()
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(120_000)
    expect(getStatus).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await flushPromises()
    expect(getStatus).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(getStatus).toHaveBeenCalledTimes(3)
  })

  it('watches the book once it has a status, and stops when the page leaves or moves to another book', async () => {
    getStatus.mockResolvedValue(fresh(status()))
    const { wrapper, bookId } = mountStatus()
    expect(socket.watchers.has(7)).toBe(false)
    await flushPromises()
    expect(socket.watchers.has(7)).toBe(true)
    bookId.value = 8
    await flushPromises()
    expect(socket.unwatched).toEqual([7])
    expect(socket.watchers.has(8)).toBe(true)
    wrapper.unmount()
    expect(socket.unwatched).toEqual([7, 8])
  })

  it('does not watch for someone who cannot build story guides', async () => {
    mocks.permissions = new Set()
    mountStatus()
    await flushPromises()
    expect(socket.watchers.size).toBe(0)
  })

  it('asks at once when the socket says the book changed, and shows the answer', async () => {
    getStatus.mockResolvedValueOnce(fresh(status())).mockResolvedValueOnce(fresh(RUNNING, '"e2"'))
    const { api } = mountStatus()
    await flushPromises()
    socket.watchers.get(7)!.changed()
    await flushPromises()
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(getStatus).toHaveBeenLastCalledWith(7, null, '"e1"')
    expect(api().status.value?.job?.state).toBe('running')
  })

  it('makes one more ask, not one per change, for changes heard while an ask is on its way', async () => {
    let answer!: (value: Awaited<ReturnType<typeof getStatus>>) => void
    getStatus
      .mockResolvedValueOnce(fresh(RUNNING))
      .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
      .mockResolvedValue({ kind: 'not-modified' })
    mountStatus()
    await flushPromises()
    const watcher = socket.watchers.get(7)!
    watcher.changed()
    watcher.changed()
    watcher.changed()
    expect(getStatus).toHaveBeenCalledTimes(2)
    answer({ kind: 'not-modified' })
    await flushPromises()
    expect(getStatus).toHaveBeenCalledTimes(3)
  })

  it('keeps a change heard while hidden for when the page is visible again', async () => {
    getStatus.mockResolvedValueOnce(fresh(status())).mockResolvedValue(fresh(RUNNING, '"e2"'))
    const { api } = mountStatus()
    await flushPromises()
    setVisibility('hidden')
    socket.watchers.get(7)!.changed()
    await flushPromises()
    expect(getStatus).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await flushPromises()
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(api().status.value?.job?.state).toBe('running')
  })

  it('polls only once a minute while the socket pushes, and quickly again when it stops', async () => {
    getStatus.mockResolvedValueOnce(fresh(RUNNING)).mockResolvedValue({ kind: 'not-modified' })
    mountStatus()
    await flushPromises()
    const watcher = socket.watchers.get(7)!
    watcher.live(true)
    await flushPromises()
    // Going live asks once to catch up.
    expect(getStatus).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(59_000)
    expect(getStatus).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(getStatus).toHaveBeenCalledTimes(3)
    watcher.live(false)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(getStatus).toHaveBeenCalledTimes(4)
  })

  it('asks on a queue change only while its own job is queued', async () => {
    const queued = status({ job: { kind: 'build', state: 'queued', position: 2 } })
    getStatus.mockResolvedValueOnce(fresh(status())).mockResolvedValueOnce(fresh(queued, '"e2"')).mockResolvedValue({ kind: 'not-modified' })
    mountStatus()
    await flushPromises()
    const watcher = socket.watchers.get(7)!
    watcher.queueChanged()
    await flushPromises()
    expect(getStatus).toHaveBeenCalledTimes(1)
    watcher.changed()
    await flushPromises()
    expect(getStatus).toHaveBeenCalledTimes(2)
    watcher.queueChanged()
    await flushPromises()
    expect(getStatus).toHaveBeenCalledTimes(3)
  })

  it('drops an answer older than one already shown', async () => {
    let slow!: (value: Awaited<ReturnType<typeof getStatus>>) => void
    getStatus
      .mockResolvedValueOnce(fresh(RUNNING))
      .mockImplementationOnce(() => new Promise((resolve) => (slow = resolve)))
      .mockResolvedValueOnce(fresh(status({ guide: GUIDE }), '"e3"'))
    const { api } = mountStatus()
    await flushPromises()
    // The poll's ask leaves first and is held; a pushed change then asks and is answered first.
    await vi.advanceTimersByTimeAsync(5_000)
    expect(getStatus).toHaveBeenCalledTimes(2)
    setVisibility('hidden')
    setVisibility('visible')
    await flushPromises()
    expect(getStatus).toHaveBeenCalledTimes(3)
    expect(api().status.value?.guide).toEqual(GUIDE)
    slow(fresh(RUNNING, '"e2"'))
    await flushPromises()
    expect(api().status.value?.guide).toEqual(GUIDE)
    expect(api().status.value?.job).toBeNull()
  })

  it('stops polling when the page leaves', async () => {
    getStatus.mockResolvedValueOnce(fresh(RUNNING)).mockResolvedValue({ kind: 'not-modified' })
    const { wrapper } = mountStatus()
    await flushPromises()
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(120_000)
    expect(getStatus).toHaveBeenCalledTimes(1)
  })

  it('asks once more after 3 seconds while the server is checking the book, then waits for the push', async () => {
    const checking = status({ build: { allowed: false, reason: 'checking' }, estimate: undefined })
    getStatus.mockResolvedValue(fresh(checking))
    const { api } = mountStatus()
    await flushPromises()
    socket.watchers.get(7)!.live(true)
    await flushPromises()
    expect(api().presentation.value.rows).toEqual([{ kind: 'checking' }])
    const asked = getStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(3_000)
    expect(getStatus).toHaveBeenCalledTimes(asked + 1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getStatus).toHaveBeenCalledTimes(asked + 1)

    getStatus.mockResolvedValue(fresh(status(), '"e2"'))
    socket.watchers.get(7)!.changed()
    await flushPromises()
    expect(api().presentation.value.rows).not.toContainEqual({ kind: 'checking' })
  })

  it('keeps asking, waiting twice as long each time, while checking with no socket push', async () => {
    const checking = status({ build: { allowed: false, reason: 'checking' }, estimate: undefined })
    getStatus.mockResolvedValue(fresh(checking))
    const { api } = mountStatus()
    await flushPromises()
    expect(getStatus).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(getStatus).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5_999)
    expect(getStatus).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(getStatus).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(getStatus).toHaveBeenCalledTimes(4)

    getStatus.mockResolvedValue(fresh(status(), '"e2"'))
    await vi.advanceTimersByTimeAsync(24_000)
    expect(getStatus).toHaveBeenCalledTimes(5)
    expect(api().presentation.value.rows).not.toContainEqual({ kind: 'checking' })
    await vi.advanceTimersByTimeAsync(120_000)
    expect(getStatus).toHaveBeenCalledTimes(5)
  })

  it('drops an answer for a book the page has left', async () => {
    let answerFirst!: (value: Awaited<ReturnType<typeof getStatus>>) => void
    getStatus.mockImplementationOnce(() => new Promise((resolve) => (answerFirst = resolve))).mockResolvedValueOnce(fresh(status({ fileId: 99 })))
    const bookId = ref(7)
    const { api } = mountStatus(bookId)
    await flushPromises()
    bookId.value = 8
    await flushPromises()
    answerFirst(fresh(status({ fileId: 1, guide: GUIDE })))
    await flushPromises()
    expect(getStatus).toHaveBeenLastCalledWith(8, null, null)
    expect(api().status.value?.fileId).toBe(99)
  })

  it('builds the file the status is about, shows the answer and starts polling', async () => {
    getStatus.mockResolvedValueOnce(fresh(status())).mockResolvedValue({ kind: 'not-modified' })
    const queued = status({ job: { kind: 'build', state: 'queued', position: 2 } })
    vi.mocked(storyGuideApi.buildStoryGuide).mockResolvedValue(queued)
    const { api } = mountStatus()
    await flushPromises()

    const sent = api().perform('build')
    expect(api().pending.value).toBe('build')
    await sent
    expect(storyGuideApi.buildStoryGuide).toHaveBeenCalledWith(7, 812, 'build')
    expect(api().pending.value).toBeNull()
    expect(api().presentation.value.rows).toEqual([{ kind: 'waiting', title: 'storyGuide', ahead: 1 }])

    await vi.advanceTimersByTimeAsync(5_000)
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(getStatus).toHaveBeenLastCalledWith(7, null, null)
  })

  it.each([
    ['update', 'buildStoryGuide', [7, 812, 'update']],
    ['rebuild', 'buildStoryGuide', [7, 812, 'rebuild']],
    ['retry', 'retryStoryGuide', [7, 812]],
    ['keepBuilding', 'retryStoryGuide', [7, 812]],
    ['cancelBuild', 'cancelStoryGuide', [7, 812]],
    ['dismiss', 'cancelStoryGuide', [7, 812]],
  ] as const)('sends %s through its route', async (action, route, args) => {
    getStatus.mockResolvedValue(fresh(status({ guide: GUIDE })))
    vi.mocked(storyGuideApi[route]).mockResolvedValue(status({ guide: GUIDE }))
    const { api } = mountStatus()
    await flushPromises()
    await api().perform(action)
    expect(storyGuideApi[route]).toHaveBeenCalledWith(...args)
  })

  it('deletes keeping fixes unless told otherwise', async () => {
    getStatus.mockResolvedValue(fresh(status({ guide: GUIDE })))
    vi.mocked(storyGuideApi.deleteStoryGuide).mockResolvedValue(status())
    const { api } = mountStatus()
    await flushPromises()
    await api().perform('delete')
    expect(storyGuideApi.deleteStoryGuide).toHaveBeenLastCalledWith(7, 812, 'keep')
    getStatus.mockResolvedValue(fresh(status({ guide: GUIDE })))
    await api().reload()
    await api().perform('delete', 'delete')
    expect(storyGuideApi.deleteStoryGuide).toHaveBeenLastCalledWith(7, 812, 'delete')
    expect(api().presentation.value.menu).toEqual(['build'])
  })

  it('says "Still the case" for a few seconds when Try again finds the same pause', async () => {
    const paused = status({ job: { kind: 'build', state: 'paused', reason: 'budget' } })
    getStatus.mockResolvedValue(fresh(paused))
    vi.mocked(storyGuideApi.retryStoryGuide).mockResolvedValue(paused)
    const { api } = mountStatus()
    await flushPromises()
    await api().perform('retry')
    expect(api().presentation.value.rows[0]).toMatchObject({ kind: 'notice', stillTheCase: true })
    await vi.advanceTimersByTimeAsync(4_000)
    expect(api().presentation.value.rows[0]).toMatchObject({ kind: 'notice', stillTheCase: false })
  })

  it('does not say "Still the case" when Try again resumed the build', async () => {
    getStatus.mockResolvedValue(fresh(status({ job: { kind: 'build', state: 'paused', reason: 'budget' } })))
    vi.mocked(storyGuideApi.retryStoryGuide).mockResolvedValue(RUNNING)
    const { api } = mountStatus()
    await flushPromises()
    await api().perform('retry')
    expect(api().presentation.value.rows[0]).toMatchObject({ kind: 'progress' })
  })

  it('reports a failed action and asks for the status again', async () => {
    getStatus
      .mockResolvedValueOnce(fresh(status({ guide: GUIDE })))
      .mockResolvedValueOnce(fresh(status({ canManage: false, guide: GUIDE, build: { allowed: false } })))
    vi.mocked(storyGuideApi.deleteStoryGuide).mockRejectedValue(new ApiError('Forbidden', 403, null, 'Forbidden'))
    const { api } = mountStatus()
    await flushPromises()
    await api().perform('delete')
    expect(mocks.toastError).toHaveBeenCalledWith("Couldn't delete the story guide.")
    expect(getStatus).toHaveBeenCalledTimes(2)
    expect(api().presentation.value).toEqual({ rows: [], menu: [], builtNote: null })
    expect(api().pending.value).toBeNull()
  })

  it('keeps a poll that left before an action from undoing its answer', async () => {
    let answerPoll!: (value: Awaited<ReturnType<typeof getStatus>>) => void
    getStatus.mockResolvedValueOnce(fresh(RUNNING)).mockImplementationOnce(() => new Promise((resolve) => (answerPoll = resolve)))
    vi.mocked(storyGuideApi.cancelStoryGuide).mockResolvedValue(status())
    const { api } = mountStatus()
    await flushPromises()
    await vi.advanceTimersByTimeAsync(5_000)
    await api().perform('cancelBuild')
    answerPoll(fresh(RUNNING, '"old"'))
    await flushPromises()
    expect(api().presentation.value.menu).toEqual(['build'])
  })
})
