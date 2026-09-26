import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastDirectoryResult } from '@bookorbit/types'
import { api } from '@/lib/api'
import { jsonResponse } from '../test/fixtures'
import { sheetStubs } from '../test/stubs'
import PodcastAddFeedSheet from './PodcastAddFeedSheet.vue'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(null, { status: 204 })),
}))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))

const apiMock = vi.mocked(api)

function directoryResult(overrides: Partial<PodcastDirectoryResult> = {}): PodcastDirectoryResult {
  return {
    title: 'Orbit Radio',
    author: 'Orbit',
    feedUrl: 'https://a.example/feed.xml',
    artworkUrl: null,
    genre: null,
    existingPodcastId: null,
    existingLibraryId: null,
    ...overrides,
  }
}

function mountSheet() {
  return mount(PodcastAddFeedSheet, {
    props: { open: true, libraryId: 7 },
    global: { stubs: sheetStubs() },
  })
}

describe('PodcastAddFeedSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    apiMock.mockReset()
    apiMock.mockResolvedValue(new Response(null, { status: 204 }))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flags a directory result already in the library and opens it instead of previewing the feed', async () => {
    apiMock.mockImplementation(async (input) =>
      String(input).includes('/podcast-search')
        ? jsonResponse([
            directoryResult({ existingPodcastId: 3, existingLibraryId: 7 }),
            directoryResult({ title: 'New Show', feedUrl: 'https://b.example/feed.xml' }),
          ])
        : new Response(null, { status: 204 }),
    )
    const wrapper = mountSheet()

    await wrapper.get('#podcast-directory-search').setValue('orbit')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    const badges = wrapper.findAll('[data-testid="podcast-directory-in-library"]')
    expect(badges).toHaveLength(1)
    expect(badges[0]!.text()).toBe('In library')

    await wrapper.get('button[aria-label="Open Orbit Radio, already in your library"]').trigger('click')

    expect(wrapper.emitted('open-show')).toEqual([[3]])
    // Selecting an existing show hands off to the view rather than opening a preview request for it.
    expect(apiMock).not.toHaveBeenCalledWith(expect.stringContaining('/feed-preview'), expect.anything())
  })

  it('offers the OPML and local-file entry points as sheet handoffs', async () => {
    const wrapper = mountSheet()

    await wrapper.get('[data-testid="podcast-open-opml-import"]').trigger('click')
    expect(wrapper.emitted('import-opml')).toHaveLength(1)
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])

    await wrapper.get('[data-testid="podcast-open-local-import"]').trigger('click')
    expect(wrapper.emitted('import-local')).toHaveLength(1)
  })
})
