import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PodcastBookmarksPanel from './PodcastBookmarksPanel.vue'
import { usePodcastShortcuts } from '../composables/usePodcastShortcuts'

const player = vi.hoisted(() => ({
  bookmarks: { value: [] },
  bookmarkTitle: { value: '' },
  bookmarkNote: { value: '' },
  currentTime: { value: 42 },
  createBookmark: vi.fn<() => Promise<void>>(async () => undefined),
  seekTo: vi.fn<(seconds: number) => void>(),
  updateBookmark: vi.fn<() => Promise<void>>(async () => undefined),
  deleteBookmark: vi.fn<() => Promise<void>>(async () => undefined),
}))

vi.mock('../composables/usePodcastPlayer', () => ({ usePodcastPlayer: () => player }))

describe('PodcastBookmarksPanel', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('opens and focuses the bookmark title when requested by a shortcut', async () => {
    const wrapper = mount(PodcastBookmarksPanel, { attachTo: document.body })

    usePodcastShortcuts().requestBookmarkComposer()
    await flushPromises()

    const title = wrapper.get('input[aria-label="Bookmark title"]').element
    expect(document.activeElement).toBe(title)
    wrapper.unmount()
  })
})
