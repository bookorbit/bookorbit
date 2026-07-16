import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { StorygraphBookSyncState, StorygraphSettings } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { api } from '@/lib/api'
import { useStorygraphSettings } from '../../composables/useStorygraphSettings'
import StorygraphBookSyncGridItem from '../StorygraphBookSyncGridItem.vue'

type ApiFn = (input: RequestInfo | URL, init?: RequestInit & { _isRetry?: boolean }) => Promise<Response>

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn<(...args: unknown[]) => boolean>(),
  settings: {
    value: null as StorygraphSettings | null,
  },
  bookStates: new Map<number, StorygraphBookSyncState>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mocks.hasPermission }),
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<ApiFn>(),
}))

const mockApi = vi.mocked(api)

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  } as unknown as Response
}

function makeSettings(overrides: Partial<StorygraphSettings> = {}): StorygraphSettings {
  return {
    cookiesConfigured: true,
    enabled: true,
    effectiveEnabled: true,
    disabledReason: null,
    bookSyncMode: 'all_eligible',
    autoSyncOnStatusChange: true,
    autoSyncOnProgressUpdate: true,
    lastSyncedAt: null,
    ...overrides,
  }
}

function makeBookState(overrides: Partial<StorygraphBookSyncState> = {}): StorygraphBookSyncState {
  return {
    bookId: 12,
    syncOverride: null,
    syncEnabled: true,
    canSyncNow: true,
    effectiveReason: null,
    lastSyncedAt: null,
    syncError: null,
    ...overrides,
  }
}

function setBookState(bookId: number, overrides: Partial<StorygraphBookSyncState> = {}): StorygraphBookSyncState {
  const state = { ...makeBookState({ bookId }), ...overrides }
  mocks.bookStates.set(bookId, state)
  return state
}

function getBookState(bookId: number): StorygraphBookSyncState {
  return mocks.bookStates.get(bookId) ?? setBookState(bookId)
}

function mountItem(bookId = 12) {
  return mount(StorygraphBookSyncGridItem, { props: { bookId } })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })
  return { promise, resolve }
}

describe('StorygraphBookSyncGridItem', () => {
  const { settings } = useStorygraphSettings()
  let wrappers: Array<{ unmount: () => void }> = []

  beforeEach(() => {
    vi.clearAllMocks()
    settings.value = null
    mocks.hasPermission.mockReturnValue(true)
    mocks.settings.value = makeSettings()
    mocks.bookStates.clear()
    setBookState(12)

    mockApi.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/storygraph/settings')) {
        return jsonResponse(mocks.settings.value)
      }

      const syncStateMatch = url.match(/\/storygraph\/books\/(\d+)\/sync-state$/)
      if (syncStateMatch) {
        const bookId = Number(syncStateMatch[1])
        if (init?.method === 'PATCH') {
          const body = typeof init.body === 'string' ? (JSON.parse(init.body) as { syncEnabled?: boolean }) : {}
          const current = getBookState(bookId)
          const nextState: StorygraphBookSyncState =
            mocks.settings.value?.bookSyncMode === 'selected_only'
              ? body.syncEnabled
                ? {
                    ...current,
                    syncOverride: 'included',
                    syncEnabled: true,
                    canSyncNow: true,
                    effectiveReason: null,
                    syncError: null,
                  }
                : {
                    ...current,
                    syncOverride: null,
                    syncEnabled: false,
                    canSyncNow: false,
                    effectiveReason: 'not_selected',
                    syncError: null,
                  }
              : body.syncEnabled
                ? {
                    ...current,
                    syncOverride: null,
                    syncEnabled: true,
                    canSyncNow: true,
                    effectiveReason: null,
                    syncError: null,
                  }
                : {
                    ...current,
                    syncOverride: 'excluded',
                    syncEnabled: false,
                    canSyncNow: false,
                    effectiveReason: 'excluded',
                    syncError: null,
                  }

          mocks.bookStates.set(bookId, nextState)
          return jsonResponse(nextState)
        }

        return jsonResponse(getBookState(bookId))
      }

      const syncMatch = url.match(/\/storygraph\/books\/(\d+)\/sync$/)
      if (syncMatch) {
        const bookId = Number(syncMatch[1])
        const current = getBookState(bookId)
        const nextState: StorygraphBookSyncState = {
          ...current,
          syncEnabled: true,
          canSyncNow: false,
          effectiveReason: null,
          lastSyncedAt: '2024-02-01T15:30:00.000Z',
          syncError: null,
        }
        mocks.bookStates.set(bookId, nextState)
        return jsonResponse({ result: 'synced', state: nextState })
      }

      return jsonResponse({}, false)
    })
  })

  afterEach(() => {
    for (const wrapper of wrappers) wrapper.unmount()
    wrappers = []
  })

  it('shows the per-book sync state when Storygraph sync is enabled', async () => {
    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    expect(mockApi).toHaveBeenCalledWith('/api/v1/storygraph/settings')
    expect(mockApi).toHaveBeenCalledWith('/api/v1/storygraph/books/12/sync-state')
    expect(wrapper.text()).toContain('StoryGraph Sync')
    expect(wrapper.text()).toContain('Pending sync')
    expect(wrapper.text()).toContain('Sync now')
    expect(wrapper.findComponent(ToggleSwitch).props('modelValue')).toBe(true)
  })

  it('does not fetch per-book state when the user lacks Storygraph sync permission', async () => {
    mocks.hasPermission.mockReturnValue(false)

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()

    expect(wrapper.text()).toBe('')
    expect(mockApi).not.toHaveBeenCalledWith('/api/v1/storygraph/settings')
    expect(mockApi).not.toHaveBeenCalledWith('/api/v1/storygraph/books/12/sync-state')
  })

  it('does not fetch per-book state when global Storygraph sync is disabled', async () => {
    mocks.settings.value = makeSettings({ enabled: false, effectiveEnabled: false })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toBe('')
    expect(mockApi).toHaveBeenCalledWith('/api/v1/storygraph/settings')
    expect(mockApi).not.toHaveBeenCalledWith('/api/v1/storygraph/books/12/sync-state')
  })

  it('shows the last synced timestamp when the book has already synced', async () => {
    setBookState(12, {
      syncEnabled: true,
      canSyncNow: false,
      lastSyncedAt: '2024-02-01T15:30:00.000Z',
    })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('Synced')
    expect(wrapper.text()).toContain('2024')
    expect(wrapper.findAll('button').some((button) => button.text().includes('Sync now'))).toBe(false)
  })

  it('shows the stored sync error for a book', async () => {
    setBookState(12, {
      syncEnabled: false,
      syncOverride: 'excluded',
      canSyncNow: false,
      effectiveReason: 'excluded',
      syncError: 'timeout',
    })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('Error: timeout')
  })

  it('shows a load error when the per-book state cannot be fetched', async () => {
    mockApi.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/storygraph/settings')) return jsonResponse(mocks.settings.value)
      if (url.endsWith('/storygraph/books/12/sync-state')) return jsonResponse({}, false)
      return jsonResponse({}, false)
    })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('Unable to load StoryGraph sync state.')
  })

  it('waits for fresh settings before using shared Storygraph settings state', async () => {
    settings.value = makeSettings()
    mocks.settings.value = makeSettings({ enabled: false, effectiveEnabled: false })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toBe('')
    expect(mockApi).not.toHaveBeenCalledWith('/api/v1/storygraph/books/12/sync-state')
  })

  it('saves the per-book exclusion setting', async () => {
    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', false)
    await flushPromises()

    expect(mockApi).toHaveBeenCalledWith(
      '/api/v1/storygraph/books/12/sync-state',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ syncEnabled: false }),
      }),
    )
    expect(wrapper.text()).toContain('Excluded')
    expect(wrapper.findAll('button').some((button) => button.text().includes('Sync now'))).toBe(false)
  })

  it('rolls back the per-book exclusion setting when saving fails', async () => {
    mockApi.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/storygraph/settings')) return jsonResponse(mocks.settings.value)
      if (url.endsWith('/storygraph/books/12/sync-state') && init?.method === 'PATCH') return jsonResponse({ message: 'Forbidden' }, false)
      if (url.endsWith('/storygraph/books/12/sync-state')) return jsonResponse(getBookState(12))
      return jsonResponse({}, false)
    })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', false)
    await flushPromises()

    expect(wrapper.findComponent(ToggleSwitch).props('modelValue')).toBe(true)
    expect(wrapper.text()).toContain('Failed to save StoryGraph sync setting.')
    expect(wrapper.findAll('button').some((button) => button.text().includes('Sync now'))).toBe(true)
  })

  it('selects a book in selected-only mode and syncs it manually', async () => {
    mocks.settings.value = makeSettings({ bookSyncMode: 'selected_only' })
    setBookState(12, {
      syncEnabled: false,
      syncOverride: null,
      canSyncNow: false,
      effectiveReason: 'not_selected',
    })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    expect(wrapper.text()).toContain('Not selected')
    expect(wrapper.findAll('button').some((button) => button.text().includes('Sync now'))).toBe(false)

    wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', true)
    await flushPromises()

    expect(mockApi).toHaveBeenCalledWith(
      '/api/v1/storygraph/books/12/sync-state',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ syncEnabled: true }),
      }),
    )
    expect(wrapper.text()).toContain('Pending sync')
    expect(wrapper.text()).toContain('Sync now')

    const syncNowButton = wrapper.findAll('button').find((button) => button.text().includes('Sync now'))
    expect(syncNowButton).toBeDefined()
    await syncNowButton!.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(mockApi).toHaveBeenCalledWith('/api/v1/storygraph/books/12/sync', { method: 'POST' })
    expect(wrapper.text()).toContain('Synced')
  })

  it('shows toggle ON with "Will sync when reading starts" for an unread book in all_eligible mode', async () => {
    setBookState(12, {
      syncEnabled: false,
      syncOverride: null,
      canSyncNow: false,
      effectiveReason: 'unread',
    })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    expect(wrapper.findComponent(ToggleSwitch).props('modelValue')).toBe(true)
    expect(wrapper.text()).toContain('Will sync when reading starts')
    expect(wrapper.findAll('button').some((button) => button.text().includes('Sync now'))).toBe(false)
  })

  it('shows toggle OFF with "Excluded" for an unread book explicitly excluded in all_eligible mode', async () => {
    setBookState(12, {
      syncEnabled: false,
      syncOverride: 'excluded',
      canSyncNow: false,
      effectiveReason: 'unread',
    })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    expect(wrapper.findComponent(ToggleSwitch).props('modelValue')).toBe(false)
    expect(wrapper.text()).toContain('Excluded')
  })

  it('shows toggle OFF with "Excluded" for an unread book not yet included in selected_only mode', async () => {
    mocks.settings.value = makeSettings({ bookSyncMode: 'selected_only' })
    setBookState(12, {
      syncEnabled: false,
      syncOverride: null,
      canSyncNow: false,
      effectiveReason: 'unread',
    })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    expect(wrapper.findComponent(ToggleSwitch).props('modelValue')).toBe(false)
    expect(wrapper.text()).toContain('Excluded')
  })

  it('shows toggle ON with "Will sync when reading starts" for an unread book included in selected_only mode', async () => {
    mocks.settings.value = makeSettings({ bookSyncMode: 'selected_only' })
    setBookState(12, {
      syncEnabled: false,
      syncOverride: 'included',
      canSyncNow: false,
      effectiveReason: 'unread',
    })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    expect(wrapper.findComponent(ToggleSwitch).props('modelValue')).toBe(true)
    expect(wrapper.text()).toContain('Will sync when reading starts')
    expect(wrapper.findAll('button').some((button) => button.text().includes('Sync now'))).toBe(false)
  })

  it('clears the saving state when a save finishes after the book changes', async () => {
    const patchResponse = deferred<Response>()

    mockApi.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/storygraph/settings')) return jsonResponse(mocks.settings.value)
      if (url.endsWith('/storygraph/books/12/sync-state') && init?.method === 'PATCH') return patchResponse.promise
      if (url.endsWith('/storygraph/books/12/sync-state')) return jsonResponse(getBookState(12))
      if (url.endsWith('/storygraph/books/13/sync-state')) {
        return jsonResponse(
          makeBookState({
            bookId: 13,
            syncEnabled: true,
            canSyncNow: false,
            lastSyncedAt: null,
            syncError: null,
          }),
        )
      }
      return jsonResponse({}, false)
    })

    const wrapper = mountItem()
    wrappers.push(wrapper)
    await flushPromises()
    await flushPromises()

    wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(wrapper.findComponent(ToggleSwitch).props('disabled')).toBe(true)

    await wrapper.setProps({ bookId: 13 })
    await flushPromises()

    patchResponse.resolve(
      jsonResponse({
        ...getBookState(12),
        syncEnabled: false,
        syncOverride: 'excluded',
        canSyncNow: false,
        effectiveReason: 'excluded',
      }),
    )
    await flushPromises()

    expect(wrapper.findComponent(ToggleSwitch).props('disabled')).toBe(false)
    expect(wrapper.text()).toContain('Included')
  })
})
