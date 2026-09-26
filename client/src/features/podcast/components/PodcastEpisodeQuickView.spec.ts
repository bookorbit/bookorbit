import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastEpisodeListItem, PodcastEpisodeSummary } from '@bookorbit/types'
import { api } from '@/lib/api'
import PodcastEpisodeQuickView from './PodcastEpisodeQuickView.vue'
import { createPodcastEpisodeActionsStub, provideEpisodeActions } from '../test/episode-action-stubs'
import { jsonResponse } from '../test/fixtures'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string) => Promise<Response>>() }))

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
  }
})

const apiMock = vi.mocked(api)

describe('PodcastEpisodeQuickView', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockResolvedValue(jsonResponse(createDetail()))
  })

  it('fetches and renders the full episode detail when opened', async () => {
    const wrapper = mountQuickView()
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-episodes/665', undefined)
    expect(wrapper.text()).toContain('The complete episode description.')
    expect(wrapper.text()).toContain('Chapters 2')
    expect(wrapper.get('a[href="https://cdn.example.com/transcript.vtt"]').text()).toContain('en')
  })

  it('drives the same episode actions the row does', async () => {
    const actions = createPodcastEpisodeActionsStub()
    const wrapper = mountQuickView({}, actions)
    await flushPromises()

    await findButton(wrapper, 'Listen').trigger('click')
    await findButton(wrapper, 'Remove from queue').trigger('click')
    await findButton(wrapper, 'Remove download').trigger('click')
    await findButton(wrapper, 'Mark played').trigger('click')
    await findButton(wrapper, 'Open full player').trigger('click')

    expect(actions.play).toHaveBeenCalledWith(expect.objectContaining({ id: 665 }))
    expect(actions.unqueue).toHaveBeenCalledWith(expect.objectContaining({ id: 665 }))
    expect(actions.removeDownload).toHaveBeenCalledWith(expect.objectContaining({ id: 665 }))
    expect(actions.finish).toHaveBeenCalledWith(expect.objectContaining({ id: 665 }))
    expect(actions.openPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: 665 }))
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })

  it('offers metadata editing only to a caller that may edit it', async () => {
    // A Response body reads once, so each mount needs its own.
    apiMock.mockImplementation(() => Promise.resolve(jsonResponse(createDetail())))
    const withoutPermission = mountQuickView()
    await flushPromises()
    expect(withoutPermission.find('[data-testid="podcast-quick-view-edit-metadata"]').exists()).toBe(false)

    const actions = createPodcastEpisodeActionsStub()
    const wrapper = mountQuickView({ canEditMetadata: true }, actions)
    await flushPromises()
    await wrapper.get('[data-testid="podcast-quick-view-edit-metadata"]').trigger('click')

    expect(actions.openMetadataEditor).toHaveBeenCalledWith(expect.objectContaining({ id: 665 }))
    expect(wrapper.emitted('update:open')).toContainEqual([false])
  })

  // The server's English `message` never reaches the interface; the localized fallback does.
  it('shows a localized error and retries the detail request', async () => {
    apiMock.mockResolvedValueOnce(jsonResponse({ message: 'Could not load details' }, 500)).mockResolvedValueOnce(jsonResponse(createDetail()))
    const wrapper = mountQuickView()
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Failed to load podcast episode')
    await findButton(wrapper, 'Retry').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('The complete episode description.')
  })
})

function mountQuickView(overrides: { canEditMetadata?: boolean } = {}, actions = createPodcastEpisodeActionsStub()) {
  return mount(PodcastEpisodeQuickView, {
    props: { episode: createEpisode(), open: true, canDownload: true, ...overrides },
    global: { provide: provideEpisodeActions(actions) },
  })
}

function findButton(wrapper: ReturnType<typeof mountQuickView>, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
  if (!button) throw new Error(`Missing button: ${text}`)
  return button
}

function createEpisode(): PodcastEpisodeListItem {
  return {
    id: 665,
    libraryId: 2,
    origin: 'feed',
    podcastId: 12,
    podcastTitle: 'The Long Orbit',
    podcastImageUrl: '/api/v1/podcasts/12/artwork',
    title: 'A Better Episode Row',
    season: '2',
    episode: '14',
    explicit: false,
    inFeed: true,
    publishedAt: '2026-07-11T12:00:00.000Z',
    durationSeconds: 3_600,
    audioFormat: null,
    mediaStatus: 'local',
    localSizeBytes: 42_000_000,
    checksum: 'a'.repeat(64),
    positionSeconds: 600,
    progressPercent: 16.67,
    finished: false,
    pinned: false,
    queued: true,
    lastListenedAt: '2026-07-11T12:10:00.000Z',
  }
}

function createDetail(): PodcastEpisodeSummary {
  return {
    ...createEpisode(),
    subtitle: null,
    description: '<p>The complete episode description.</p>',
    episodeType: null,
    audioFormat: 'audio/mpeg',
    chapters: [
      { title: 'Opening', startSeconds: 0 },
      { title: 'Main topic', startSeconds: 300 },
    ],
    transcripts: [{ url: 'https://cdn.example.com/transcript.vtt', type: 'text/vtt', language: 'en' }],
    lockedFields: [],
    pinned: false,
    createdAt: '2026-07-11T12:00:00.000Z',
    updatedAt: '2026-07-11T12:00:00.000Z',
  }
}
