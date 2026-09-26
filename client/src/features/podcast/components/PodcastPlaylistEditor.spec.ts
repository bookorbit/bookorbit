import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastListItem } from '@bookorbit/types'
import { api } from '@/lib/api'
import PodcastPlaylistEditor from './PodcastPlaylistEditor.vue'
import { normalizePlaylistRules } from '../lib/podcast-playlist-rules'
import type { PodcastPlaylistOption } from '../composables/usePodcastPlaylists'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

/** The shared sheet teleports out of the wrapper, so the panel is rendered in place for these assertions. */
vi.mock('@/components/ui/sheet', () => {
  const passthrough = (tag: string) =>
    defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          h(tag, slots.default?.()),
    }) as ReturnType<typeof defineComponent>
  return {
    Sheet: passthrough('div'),
    SheetContent: passthrough('div'),
    SheetHeader: passthrough('div'),
    SheetTitle: passthrough('h2'),
    SheetDescription: passthrough('p'),
    SheetFooter: passthrough('div'),
  }
})

const apiMock = vi.mocked(api)

describe('PodcastPlaylistEditor', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, page: 1, size: 8 }), { status: 200 }))
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  it('seeds a new playlist from the built-in it was opened with', async () => {
    const wrapper = await mountEditor(builtIn())

    expect((wrapper.get('#podcast-playlist-name').element as HTMLInputElement).value).toBe('Quick listens copy')
    expect((wrapper.get('#podcast-playlist-filter').element as HTMLSelectElement).value).toBe('unplayed')
    expect((wrapper.get('#podcast-playlist-max').element as HTMLInputElement).value).toBe('20')
    expect(wrapper.findAll('button').map((button) => button.text())).not.toContain('Delete playlist')
  })

  it('refuses to save an unnamed playlist or an impossible duration range', async () => {
    const wrapper = await mountEditor(builtIn())

    await wrapper.get('#podcast-playlist-name').setValue('   ')
    await saveEditor(wrapper)
    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe('Name the playlist before saving it')

    await wrapper.get('#podcast-playlist-name').setValue('Long walk')
    await wrapper.get('#podcast-playlist-min').setValue('90')
    await wrapper.get('#podcast-playlist-max').setValue('20')
    await saveEditor(wrapper)

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe('The shortest duration must be below the longest')
  })

  it('emits the trimmed name and the edited rules', async () => {
    const wrapper = await mountEditor(builtIn())

    await wrapper.get('#podcast-playlist-name').setValue('  Short hops  ')
    await wrapper.get('#podcast-playlist-sort').setValue('longest')
    await wrapper.get('#podcast-playlist-published').setValue('14')
    await saveEditor(wrapper)

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({
      name: 'Short hops',
      rules: { filter: 'unplayed', sort: 'longest', maxDurationMinutes: 20, publishedWithinDays: 14 },
    })
  })

  it('offers pinned episodes as a shared playlist filter', async () => {
    const wrapper = await mountEditor(builtIn())
    const options = wrapper.findAll('#podcast-playlist-filter option')

    expect(options.map((option) => option.attributes('value'))).toContain('pinned')
    expect(options.find((option) => option.attributes('value') === 'pinned')?.text()).toBe('Pinned')
  })

  it('adds a show from a debounced search and keeps it out of the query until then', async () => {
    const wrapper = await mountEditor(builtIn())
    apiMock.mockClear()
    apiMock.mockResolvedValue(new Response(JSON.stringify({ items: [show()], total: 1, page: 1, size: 8 }), { status: 200 }))

    await wrapper.get('input[type="search"]').setValue('orbit')
    expect(apiMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('q=orbit'))
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Orbit Radio')!
      .trigger('click')
    await saveEditor(wrapper)

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ rules: { podcastIds: [3] } })
  })

  it('previews the match once the edits settle, rather than counting on every keystroke', async () => {
    const wrapper = await mountEditor(builtIn())
    apiMock.mockClear()
    apiMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 142, totalDurationSeconds: 220_800, page: 0, size: 1 }), { status: 200 }),
    )

    await wrapper.get('#podcast-playlist-published').setValue('14')
    expect(apiMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('/api/v1/podcast-libraries/7/episodes?page=0&size=1'), undefined)
    expect(wrapper.get('[data-testid="podcast-playlist-preview"]').text()).toBe('142 episodes, 61h 20m')
  })

  it('names the empty match instead of previewing zero episodes of nothing', async () => {
    const wrapper = await mountEditor(builtIn())

    await vi.advanceTimersByTimeAsync(400)
    await flushPromises()

    expect(wrapper.get('[data-testid="podcast-playlist-preview"]').text()).toBe('Nothing matches this playlist yet')
  })

  it('resolves the saved show ids of an existing playlist in one request', async () => {
    apiMock.mockResolvedValue(new Response(JSON.stringify({ items: [show()], total: 1, page: 1, size: 50 }), { status: 200 }))
    const wrapper = await mountEditor(saved())

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('podcastIds=3'))
    expect(wrapper.text()).toContain('Orbit Radio')
    expect(wrapper.findAll('button').map((button) => button.text())).toContain('Delete playlist')
  })
})

async function mountEditor(playlist: PodcastPlaylistOption) {
  const wrapper = mount(PodcastPlaylistEditor, {
    props: { open: true, libraryId: 7, playlist, saving: false },
  })
  await flushPromises()
  return wrapper
}

async function saveEditor(wrapper: Awaited<ReturnType<typeof mountEditor>>) {
  await wrapper
    .findAll('button')
    .find((button) => button.text() === 'Save playlist')!
    .trigger('click')
}

function builtIn(): PodcastPlaylistOption {
  return {
    id: 'quick',
    name: 'Quick listens',
    builtIn: true,
    rules: normalizePlaylistRules({ filter: 'unplayed', sort: 'shortest', maxDurationMinutes: 20 }),
  }
}

function saved(): PodcastPlaylistOption {
  return {
    id: 'playlist-1',
    name: 'Morning commute',
    builtIn: false,
    rules: normalizePlaylistRules({ filter: 'unplayed', podcastIds: [3] }),
  }
}

function show(): PodcastListItem {
  return {
    id: 3,
    libraryId: 7,
    origin: 'feed',
    title: 'Orbit Radio',
    author: 'Orbit',
    imageUrl: null,
    episodeCount: 12,
    unplayedCount: 3,
    downloadedCount: 1,
    latestPublishedAt: null,
    consecutiveFailures: 0,
    playbackRecommendation: null,
    followed: false,
    notificationMode: 'off',
    archivedAt: null,
    missingAt: null,
  }
}
