import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { PodcastEpisodeListItem } from '@bookorbit/types'
import PodcastEpisodeResultsPanel from './PodcastEpisodeResultsPanel.vue'

vi.mock('vue-virtual-scroller', () => ({
  DynamicScroller: defineComponent({
    name: 'DynamicScroller',
    props: { items: Array, pageMode: Boolean, minItemSize: Number, keyField: String },
    setup: (props) => () => h('div', { 'data-testid': 'dynamic-scroller', 'data-count': (props.items as unknown[])?.length ?? 0 }),
  }),
  DynamicScrollerItem: defineComponent({
    name: 'DynamicScrollerItem',
    setup:
      (_props, { slots }) =>
      () =>
        h('div', slots.default?.()),
  }),
}))
vi.mock('vue-virtual-scroller/dist/vue-virtual-scroller.css', () => ({}))

function episode(): PodcastEpisodeListItem {
  return {
    id: 9,
    libraryId: 7,
    origin: 'feed',
    podcastId: 3,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: 'Moonrise',
    season: null,
    episode: null,
    explicit: false,
    inFeed: true,
    publishedAt: null,
    durationSeconds: 600,
    audioFormat: null,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 0,
    progressPercent: 0,
    finished: false,
    pinned: false,
    queued: false,
    lastListenedAt: null,
  }
}

function mountPanel(overrides: Partial<InstanceType<typeof PodcastEpisodeResultsPanel>['$props']> = {}) {
  return mount(PodcastEpisodeResultsPanel, {
    props: {
      mode: 'episodes',
      episodes: [],
      refreshing: false,
      canDownload: true,
      canManageFeeds: true,
      hasSearchQuery: false,
      hasFiltersApplied: false,
      currentFilter: 'latest',
      emptyTitle: 'No episodes yet',
      activeEpisodeId: null,
      isPlaying: false,
      downloadProgress: new Map(),
      canEditMetadata: () => false,
      ...overrides,
    },
  })
}

describe('PodcastEpisodeResultsPanel', () => {
  it('keeps large episode results virtualized', () => {
    const wrapper = mountPanel({ episodes: [episode()] })
    const scroller = wrapper.getComponent({ name: 'DynamicScroller' })

    expect(scroller.props()).toMatchObject({ pageMode: true, minItemSize: 92, keyField: 'id' })
    expect(scroller.props('items')).toHaveLength(1)
  })

  it('uses playlist-specific recovery actions for an empty playlist', async () => {
    const wrapper = mountPanel({ mode: 'playlists' })
    const buttons = wrapper.findAll('button')

    await buttons.find((button) => button.text().includes('Adjust rules'))!.trigger('click')
    await buttons.find((button) => button.text().includes('Browse episodes'))!.trigger('click')

    expect(wrapper.emitted('edit-playlist')).toHaveLength(1)
    expect(wrapper.emitted('browse-episodes')).toHaveLength(1)
  })

  it('does not offer feed management when permission is absent', () => {
    const wrapper = mountPanel({ canManageFeeds: false })

    expect(wrapper.findAll('button').map((button) => button.text())).not.toContain('Add feed')
    expect(wrapper.text()).toContain('No episodes yet')
  })
})
