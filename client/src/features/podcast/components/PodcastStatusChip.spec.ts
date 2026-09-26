import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PodcastStatusChip, { type PodcastStatusKind } from './PodcastStatusChip.vue'

describe('PodcastStatusChip', () => {
  it.each<[PodcastStatusKind, string, string]>([
    ['downloaded', 'Downloaded', 'text-success'],
    ['downloadQueued', 'Download queued', 'text-warning'],
    ['downloading', 'Downloading', 'text-info'],
    ['failed', 'Download failed', 'text-destructive'],
    ['unavailable', 'Unavailable', 'text-destructive'],
    ['played', 'Played', 'text-success'],
    ['removedFromFeed', 'No longer in feed', 'text-warning'],
    ['nowPlaying', 'Now playing', 'text-primary'],
    ['paused', 'Paused', 'text-foreground'],
    ['inQueue', 'In queue', 'text-muted-foreground'],
  ])('renders the %s status with an icon and semantic color', (kind, label, colorClass) => {
    const wrapper = mount(PodcastStatusChip, { props: { kind } })

    expect(wrapper.text()).toContain(label)
    expect(wrapper.get('[data-testid="podcast-status-icon"]').attributes('data-testid')).toBe('podcast-status-icon')
    expect(wrapper.get('span').classes()).toContain(colorClass)
  })

  it('uses an icon-only trigger with accessible tooltip text in compact mode', () => {
    const wrapper = mount(PodcastStatusChip, { props: { kind: 'downloaded', compact: true } })

    expect(wrapper.get('.sr-only').text()).toBe('Downloaded')
    expect(wrapper.get('[data-testid="podcast-status-icon"]').attributes('data-testid')).toBe('podcast-status-icon')
    expect(wrapper.get('span').text()).toBe('Downloaded')
  })
})
