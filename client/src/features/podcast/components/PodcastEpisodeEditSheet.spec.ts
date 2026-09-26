import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastEpisodeSummary } from '@bookorbit/types'
import { api } from '@/lib/api'
import PodcastEpisodeEditSheet from './PodcastEpisodeEditSheet.vue'
import { jsonResponse } from '../test/fixtures'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))

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

function episode(overrides: Partial<PodcastEpisodeSummary> = {}): PodcastEpisodeSummary {
  return {
    id: 42,
    libraryId: 7,
    origin: 'feed',
    podcastId: 12,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: 'Orbital mechanics',
    subtitle: 'Part one',
    description: null,
    publishedAt: null,
    season: '2',
    episode: '14',
    episodeType: 'full',
    durationSeconds: 1800,
    audioFormat: 'mp3',
    explicit: false,
    chapters: [],
    transcripts: [],
    lockedFields: [],
    inFeed: true,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 0,
    progressPercent: 0,
    finished: false,
    pinned: false,
    queued: false,
    lastListenedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

async function mountSheet(loaded: PodcastEpisodeSummary = episode()) {
  apiMock.mockResolvedValueOnce(jsonResponse(loaded))
  const wrapper = mount(PodcastEpisodeEditSheet, { props: { open: true, episodeId: loaded.id } })
  await flushPromises()
  return wrapper
}

describe('PodcastEpisodeEditSheet', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('loads the episode from the server and fills the form', async () => {
    const wrapper = await mountSheet(episode({ explicit: true }))

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-episodes/42', undefined)
    expect((wrapper.get('#podcast-episode-edit-title').element as HTMLInputElement).value).toBe('Orbital mechanics')
    expect((wrapper.get('#podcast-episode-edit-subtitle').element as HTMLInputElement).value).toBe('Part one')
    expect((wrapper.get('#podcast-episode-edit-season').element as HTMLInputElement).value).toBe('2')
    expect((wrapper.get('#podcast-episode-edit-duration').element as HTMLInputElement).value).toBe('30')
    expect((wrapper.get('#podcast-episode-edit-episode-type').element as HTMLSelectElement).value).toBe('full')
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
  })

  it('sends only the edited fields and emits the saved episode', async () => {
    const wrapper = await mountSheet()
    apiMock.mockResolvedValueOnce(jsonResponse(episode({ subtitle: 'Part two', lockedFields: ['subtitle'] })))

    await wrapper.get('#podcast-episode-edit-subtitle').setValue('Part two')
    await wrapper.get('[data-testid="podcast-save-episode-details"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenLastCalledWith('/api/v1/podcast-episodes/42/metadata', expect.objectContaining({ method: 'PATCH' }))
    expect(JSON.parse(String(apiMock.mock.calls[1]?.[1]?.body))).toEqual({ subtitle: 'Part two' })
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ lockedFields: ['subtitle'] })
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('shows an edited field as pending a lock before it is saved', async () => {
    const wrapper = await mountSheet()

    expect(wrapper.get('[aria-label="Lock Subtitle against feed refreshes"]').attributes('aria-pressed')).toBe('false')

    await wrapper.get('#podcast-episode-edit-subtitle').setValue('Part two')

    expect(wrapper.get('[aria-label="Subtitle will be locked when you save"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.text()).toContain('This field will be locked when you save.')
  })

  it('sends the reduced lock set when a locked field is unlocked', async () => {
    const wrapper = await mountSheet(episode({ lockedFields: ['season'] }))
    apiMock.mockResolvedValueOnce(jsonResponse(episode()))

    await wrapper.get('[aria-label="Unlock Season so the feed can update it"]').trigger('click')
    await wrapper.get('[data-testid="podcast-save-episode-details"]').trigger('click')
    await flushPromises()

    expect(JSON.parse(String(apiMock.mock.calls[1]?.[1]?.body))).toEqual({ lockedFields: [] })
  })

  it('converts the duration back to seconds on save', async () => {
    const wrapper = await mountSheet()
    apiMock.mockResolvedValueOnce(jsonResponse(episode({ durationSeconds: 2700 })))

    await wrapper.get('#podcast-episode-edit-duration').setValue('45')
    await wrapper.get('[data-testid="podcast-save-episode-details"]').trigger('click')
    await flushPromises()

    expect(JSON.parse(String(apiMock.mock.calls[1]?.[1]?.body))).toEqual({ durationSeconds: 2700 })
  })

  it('refuses to save a duration that is not a positive number', async () => {
    const wrapper = await mountSheet()

    await wrapper.get('#podcast-episode-edit-duration').setValue('0')
    await wrapper.get('[data-testid="podcast-save-episode-details"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(wrapper.get('#podcast-episode-edit-duration-error').text()).toContain('greater than zero')
  })

  it('keeps a feed episode type the iTunes set does not cover as a selectable option', async () => {
    const wrapper = await mountSheet(episode({ episodeType: 'Full Episode' }))
    const select = wrapper.get('#podcast-episode-edit-episode-type')

    expect((select.element as HTMLSelectElement).value).toBe('Full Episode')
    expect(select.text()).toContain('Full Episode (from the feed)')
  })

  it('closes without a write when nothing changed', async () => {
    const wrapper = await mountSheet()

    await wrapper.get('[data-testid="podcast-save-episode-details"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  // The server's English `message` never reaches the interface; the localized fallback does.
  it('offers a retry when the episode cannot be loaded', async () => {
    apiMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Podcast episode not found' }), { status: 404 }))
    const wrapper = mount(PodcastEpisodeEditSheet, { props: { open: true, episodeId: 42 } })
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Failed to load podcast episode')
    expect(wrapper.find('#podcast-episode-edit-title').exists()).toBe(false)
    expect((wrapper.get('[data-testid="podcast-save-episode-details"]').element as HTMLButtonElement).disabled).toBe(true)
  })
})
