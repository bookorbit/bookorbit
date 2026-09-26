import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { PodcastSummary } from '@bookorbit/types'
import PodcastShowSettingsSheet from './PodcastShowSettingsSheet.vue'

const passthrough = (tag: string) =>
  defineComponent({
    setup:
      (_props, { slots }) =>
      () =>
        h(tag, slots.default?.()),
  })

function show(overrides: Partial<PodcastSummary> = {}): PodcastSummary {
  return {
    id: 12,
    libraryId: 7,
    origin: 'feed',
    title: 'Orbit Radio',
    author: null,
    description: null,
    imageUrl: null,
    siteUrl: null,
    language: null,
    podcastType: null,
    explicit: false,
    categories: [],
    acquisitionPolicy: 'newest',
    autoDownloadLimit: 5,
    autoDownloadWindowDays: null,
    downloadCleanup: 'keep',
    downloadCleanupDelayHours: 24,
    refreshIntervalMinutes: 120,
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
    nextRefreshAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function mountSheet(summary = show()) {
  return mount(PodcastShowSettingsSheet, {
    props: { open: true, show: summary, busy: false },
    global: {
      stubs: {
        Sheet: passthrough('div'),
        SheetContent: passthrough('div'),
        SheetHeader: passthrough('div'),
        SheetTitle: passthrough('h2'),
        SheetDescription: passthrough('p'),
        SheetFooter: passthrough('div'),
      },
    },
  })
}

describe('PodcastShowSettingsSheet', () => {
  it('initializes and emits the complete feed settings contract', async () => {
    const wrapper = mountSheet()

    await wrapper.get('[data-testid="podcast-save-settings"]').trigger('click')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      acquisitionPolicy: 'newest',
      autoDownloadLimit: 5,
      autoDownloadWindowDays: 30,
      downloadCleanup: 'keep',
      downloadCleanupDelayHours: 24,
      refreshIntervalMinutes: 120,
    })
  })

  it('hides feed-only controls for a local show while retaining cleanup settings', () => {
    const wrapper = mountSheet(show({ origin: 'local' }))

    expect(wrapper.text()).toContain('This show has no feed')
    expect(wrapper.findComponent({ name: 'PodcastAcquisitionField' }).exists()).toBe(false)
    expect(wrapper.find('[data-testid="podcast-download-cleanup"]').exists()).toBe(true)
  })

  it('hands destructive management back through a semantic event', async () => {
    const wrapper = mountSheet()

    await wrapper.get('[data-testid="podcast-open-manage"]').trigger('click')

    expect(wrapper.emitted('manage')).toHaveLength(1)
  })
})
