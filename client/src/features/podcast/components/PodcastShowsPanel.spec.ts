import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { PodcastListItem } from '@bookorbit/types'
import PodcastShowsPanel from './PodcastShowsPanel.vue'

function show(): PodcastListItem {
  return {
    id: 4,
    libraryId: 7,
    origin: 'feed',
    title: 'Orbit Radio',
    author: null,
    imageUrl: null,
    episodeCount: 0,
    unplayedCount: 0,
    downloadedCount: 0,
    latestPublishedAt: null,
    consecutiveFailures: 0,
    playbackRecommendation: null,
    followed: false,
    notificationMode: 'off',
    archivedAt: null,
    missingAt: null,
  }
}

function mountPanel(overrides: Partial<InstanceType<typeof PodcastShowsPanel>['$props']> = {}) {
  return mount(PodcastShowsPanel, {
    props: {
      shows: [],
      gridStyle: {},
      refreshing: false,
      importing: false,
      hasSearchQuery: false,
      canManageFeeds: true,
      ...overrides,
    },
  })
}

describe('PodcastShowsPanel', () => {
  it('does not expose feed mutations without feed-management permission', () => {
    const wrapper = mountPanel({ canManageFeeds: false })

    expect(wrapper.findAll('button').map((button) => button.text())).not.toEqual(expect.arrayContaining(['Add feed', 'Import OPML']))
  })

  it('shows import progress instead of the normal empty state while local discovery runs', () => {
    const wrapper = mountPanel({ importing: true })

    expect(wrapper.text()).toContain('Importing your podcasts')
    expect(wrapper.text()).not.toContain('Ready for podcasts')
  })

  it('forwards show-card actions through semantic events', () => {
    const wrapper = mountPanel({ shows: [show()] })
    const card = wrapper.findComponent({ name: 'PodcastShowCard' })

    card.vm.$emit('open', show())
    card.vm.$emit('follow', show())

    expect(wrapper.emitted('open')?.[0]?.[0]).toMatchObject({ id: 4 })
    expect(wrapper.emitted('follow')?.[0]?.[0]).toMatchObject({ id: 4 })
  })
})
