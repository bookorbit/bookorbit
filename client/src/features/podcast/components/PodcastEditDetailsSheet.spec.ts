import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastSummary } from '@bookorbit/types'
import { api } from '@/lib/api'
import PodcastEditDetailsSheet from './PodcastEditDetailsSheet.vue'
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

function show(overrides: Partial<PodcastSummary> = {}): PodcastSummary {
  return {
    id: 12,
    libraryId: 7,
    origin: 'feed',
    title: 'Orbit Radio',
    author: 'Orbit Media',
    description: null,
    imageUrl: '/api/v1/podcasts/12/artwork',
    siteUrl: null,
    language: null,
    podcastType: null,
    explicit: false,
    categories: ['Science'],
    acquisitionPolicy: 'remote_only',
    autoDownloadLimit: null,
    autoDownloadWindowDays: null,
    downloadCleanup: 'keep',
    downloadCleanupDelayHours: 24,
    refreshIntervalMinutes: 60,
    lockedFields: [],
    artworkUpdatedAt: null,
    episodeCount: 4,
    unplayedCount: 4,
    downloadedCount: 0,
    playbackRecommendation: null,
    followed: false,
    notificationMode: 'off',
    archivedAt: null,
    missingAt: null,
    lastRefreshAt: null,
    lastRefreshSuccessAt: null,
    feedSnapshotAt: null,
    consecutiveFailures: 0,
    nextRefreshAt: '2026-07-29T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

async function mountSheet(summary: PodcastSummary = show()) {
  const wrapper = mount(PodcastEditDetailsSheet, { props: { open: true, show: summary } })
  await flushPromises()
  return wrapper
}

function buttonByText(wrapper: Awaited<ReturnType<typeof mountSheet>>, text: string) {
  return wrapper.findAll('button').find((button) => button.text() === text)
}

describe('PodcastEditDetailsSheet', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('loads the show values into the form', async () => {
    const wrapper = await mountSheet(show({ siteUrl: 'https://orbit.example', language: 'en', explicit: true }))

    expect((wrapper.get('#podcast-edit-title').element as HTMLInputElement).value).toBe('Orbit Radio')
    expect((wrapper.get('#podcast-edit-author').element as HTMLInputElement).value).toBe('Orbit Media')
    expect((wrapper.get('#podcast-edit-site-url').element as HTMLInputElement).value).toBe('https://orbit.example')
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.text()).toContain('Science')
  })

  it('sends only the edited fields and emits the saved result', async () => {
    apiMock.mockResolvedValue(
      jsonResponse({
        id: 12,
        title: 'Orbit Radio',
        author: 'Orbit Studios',
        description: null,
        siteUrl: null,
        language: null,
        explicit: false,
        categories: ['Science'],
        lockedFields: ['author'],
      }),
    )
    const wrapper = await mountSheet()

    await wrapper.get('#podcast-edit-author').setValue('Orbit Studios')
    await wrapper.get('[data-testid="podcast-save-details"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/metadata', expect.objectContaining({ method: 'PATCH' }))
    expect(JSON.parse(String(apiMock.mock.calls[0]?.[1]?.body))).toEqual({ author: 'Orbit Studios' })
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ lockedFields: ['author'] })
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('shows an edited field as pending a lock before it is saved', async () => {
    const wrapper = await mountSheet()
    const lockButton = () => wrapper.get('[aria-label="Lock Publisher against feed refreshes"]')

    expect(lockButton().attributes('aria-pressed')).toBe('false')

    await wrapper.get('#podcast-edit-author').setValue('Orbit Studios')

    expect(wrapper.get('[aria-label="Publisher will be locked when you save"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.text()).toContain('This field will be locked when you save.')
  })

  it('sends the reduced lock set when a locked field is unlocked', async () => {
    apiMock.mockResolvedValue(
      jsonResponse({
        id: 12,
        title: 'Orbit Radio',
        author: 'Orbit Media',
        description: null,
        siteUrl: null,
        language: null,
        explicit: false,
        categories: ['Science'],
        lockedFields: [],
      }),
    )
    const wrapper = await mountSheet(show({ lockedFields: ['author'] }))

    await wrapper.get('[aria-label="Unlock Publisher so the feed can update it"]').trigger('click')
    await wrapper.get('[data-testid="podcast-save-details"]').trigger('click')
    await flushPromises()

    expect(JSON.parse(String(apiMock.mock.calls[0]?.[1]?.body))).toEqual({ lockedFields: [] })
  })

  it('adds a category with the keyboard and removes it again', async () => {
    const wrapper = await mountSheet()

    await wrapper.get('#podcast-edit-categories').setValue('Technology')
    await wrapper.get('#podcast-edit-categories').trigger('keydown', { key: 'Enter' })
    expect(wrapper.text()).toContain('Technology')

    await wrapper.get('[aria-label="Remove category Technology"]').trigger('click')
    expect(wrapper.text()).not.toContain('Technology')
  })

  it('uploads a chosen artwork file and emits the new versioned url', async () => {
    apiMock.mockResolvedValue(jsonResponse({ id: 12, imageUrl: '/api/v1/podcasts/12/artwork?v=99', artworkUpdatedAt: '2026-07-31T00:00:00.000Z' }))
    const wrapper = await mountSheet()
    const input = wrapper.get('input[type="file"]')
    const file = new File(['bytes'], 'artwork.png', { type: 'image/png' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })

    await input.trigger('change')
    await wrapper.get('[data-testid="podcast-confirm-artwork"]').trigger('click')
    await flushPromises()

    const [url, init] = apiMock.mock.calls[0] ?? []
    expect(url).toBe('/api/v1/podcasts/12/artwork')
    expect(init?.method).toBe('POST')
    expect(init?.body).toBeInstanceOf(FormData)
    expect(wrapper.emitted('artwork-changed')?.[0]?.[0]).toMatchObject({ artworkUpdatedAt: '2026-07-31T00:00:00.000Z' })
  })

  it('uploads artwork from a url without touching the metadata endpoint', async () => {
    apiMock.mockResolvedValue(jsonResponse({ id: 12, imageUrl: '/api/v1/podcasts/12/artwork?v=99', artworkUpdatedAt: '2026-07-31T00:00:00.000Z' }))
    const wrapper = await mountSheet()

    await wrapper.get('#podcast-edit-artwork-url').setValue('https://cdn.example/art.png')
    await wrapper.get('[data-testid="podcast-confirm-artwork"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/artwork/from-url', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(String(apiMock.mock.calls[0]?.[1]?.body))).toEqual({ url: 'https://cdn.example/art.png' })
  })

  it('offers removal only while custom artwork is stored', async () => {
    apiMock.mockResolvedValue(jsonResponse({ id: 12, imageUrl: '/api/v1/podcasts/12/artwork', artworkUpdatedAt: null }))
    const withoutCustom = await mountSheet()
    expect(withoutCustom.find('[data-testid="podcast-remove-custom-artwork"]').exists()).toBe(false)

    const wrapper = await mountSheet(show({ artworkUpdatedAt: '2026-07-31T00:00:00.000Z' }))
    await wrapper.get('[data-testid="podcast-remove-custom-artwork"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/artwork', { method: 'DELETE' })
    expect(wrapper.emitted('artwork-changed')?.[0]?.[0]).toMatchObject({ artworkUpdatedAt: null })
  })

  it('closes without a request when nothing changed', async () => {
    const wrapper = await mountSheet()

    await wrapper.get('[data-testid="podcast-save-details"]').trigger('click')
    await flushPromises()

    expect(apiMock).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    expect(buttonByText(wrapper, 'Save')).toBeTruthy()
  })
})
