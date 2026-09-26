import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { PodcastListItem } from '@bookorbit/types'
import PodcastShowCard from './PodcastShowCard.vue'

describe('PodcastShowCard', () => {
  it('renders actionable episode counts, recency, archived state, and feed health', () => {
    const wrapper = mount(PodcastShowCard, {
      props: {
        show: createShow({
          unplayedCount: 12,
          downloadedCount: 3,
          latestPublishedAt: '2026-07-28T12:00:00.000Z',
          consecutiveFailures: 2,
          archivedAt: '2026-07-29T12:00:00.000Z',
        }),
      },
    })

    expect(wrapper.text()).toContain('12 new')
    expect(wrapper.text()).not.toContain('12 unplayed')
    expect(wrapper.text().match(/12 new/g)).toHaveLength(1)
    expect(wrapper.text()).toContain('3')
    expect(wrapper.text()).toContain('Jul 28, 2026')
    expect(wrapper.text()).toContain('Feed failing')
    expect(wrapper.text()).toContain('Archived')
  })

  it('keeps the feed failure badge off a local show, which is never refreshed', () => {
    const wrapper = mount(PodcastShowCard, {
      props: { show: createShow({ origin: 'local', consecutiveFailures: 4 }) },
    })

    expect(wrapper.text()).not.toContain('Feed failing')
    expect(wrapper.text()).toContain('Local')
  })

  it('marks a local show whose folder left the disk, in place of the local badge', () => {
    const wrapper = mount(PodcastShowCard, {
      props: { show: createShow({ origin: 'local', missingAt: '2026-08-12T09:00:00.000Z' }) },
    })

    expect(wrapper.text()).toContain('Missing')
    expect(wrapper.text()).not.toContain('Local')
  })

  it('leaves the missing badge off a show that is still on disk', () => {
    const wrapper = mount(PodcastShowCard, { props: { show: createShow({ origin: 'local' }) } })

    expect(wrapper.text()).not.toContain('Missing')
    expect(wrapper.text()).toContain('Local')
  })

  it('picks the show instead of opening it while select mode is on', async () => {
    const wrapper = mount(PodcastShowCard, { props: { show: createShow(), selectable: true } })

    await wrapper.find('button[aria-label="Select The Long Orbit"]').trigger('click')

    expect(wrapper.emitted('toggle-select')?.[0]?.[0]).toMatchObject({ id: 12 })
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('reports the pick state to assistive technology', () => {
    const unselected = mount(PodcastShowCard, { props: { show: createShow(), selectable: true } })
    const selected = mount(PodcastShowCard, { props: { show: createShow(), selectable: true, selected: true } })

    expect(unselected.find('button[aria-label="Select The Long Orbit"]').attributes('aria-pressed')).toBe('false')
    expect(selected.find('button[aria-label="Select The Long Orbit"]').attributes('aria-pressed')).toBe('true')
  })

  it('offers no row actions while selecting, so a pick cannot act by accident', () => {
    const show = createShow({
      followed: true,
      playbackRecommendation: { episodeId: 55, title: 'Signals from Europa', positionSeconds: 0, durationSeconds: 1_800, kind: 'latest' },
    })
    const browsing = mount(PodcastShowCard, { props: { show } })
    const selecting = mount(PodcastShowCard, { props: { show, selectable: true } })

    expect(browsing.find('button[aria-label="Unfollow podcast"]').exists()).toBe(true)
    expect(selecting.find('button[aria-label="Unfollow podcast"]').exists()).toBe(false)
    expect(selecting.find('button[aria-label="Follow podcast"]').exists()).toBe(false)
    expect(selecting.findAll('button[aria-label="Play latest episode Signals from Europa"]')).toHaveLength(0)
  })

  it('opens the show normally when select mode is off', async () => {
    const wrapper = mount(PodcastShowCard, { props: { show: createShow() } })

    await wrapper.find('button[aria-label="The Long Orbit"]').trigger('click')

    expect(wrapper.emitted('open')?.[0]?.[0]).toMatchObject({ id: 12 })
    expect(wrapper.emitted('toggle-select')).toBeUndefined()
  })

  it('uses a centered artwork action with a persistent touch fallback', async () => {
    const wrapper = mount(PodcastShowCard, {
      props: {
        show: createShow({
          playbackRecommendation: {
            episodeId: 55,
            title: 'Signals from Europa',
            positionSeconds: 0,
            durationSeconds: 1_800,
            kind: 'latest',
          },
        }),
      },
    })

    const playButtons = wrapper.findAll('button[aria-label="Play latest episode Signals from Europa"]')
    expect(playButtons).toHaveLength(2)
    expect(playButtons[0]!.classes()).toContain('size-[26cqi]')
    expect(playButtons[1]!.classes()).toContain('[@media(hover:hover)]:hidden')

    await playButtons[0]!.trigger('click')
    expect(wrapper.emitted('play')?.[0]?.[0]).toMatchObject({ id: 12 })
  })
})

function createShow(overrides: Partial<PodcastListItem> = {}): PodcastListItem {
  return {
    id: 12,
    libraryId: 7,
    origin: 'feed',
    title: 'The Long Orbit',
    author: 'Orbit Audio',
    imageUrl: null,
    episodeCount: 42,
    unplayedCount: 0,
    downloadedCount: 0,
    latestPublishedAt: null,
    consecutiveFailures: 0,
    playbackRecommendation: null,
    followed: false,
    notificationMode: 'off',
    archivedAt: null,
    missingAt: null,
    ...overrides,
  }
}
