import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReadingLogStatsStrip from '../ReadingLogStatsStrip.vue'

function makeStats(overrides = {}) {
  return {
    totalSessions: 5,
    totalSeconds: 3780,
    avgDurationSeconds: 756,
    firstSessionAt: '2026-01-15T10:00:00.000Z',
    lastSessionAt: '2026-04-15T10:00:00.000Z',
    dailySummary: [],
    ...overrides,
  }
}

function makeProps(overrides = {}) {
  return {
    stats: makeStats(),
    loading: false,
    quickFilter: 'all' as const,
    ...overrides,
  }
}

describe('ReadingLogStatsStrip', () => {
  it('shows skeleton cards on initial load (stats=null and loading=true)', () => {
    const wrapper = mount(ReadingLogStatsStrip, {
      props: makeProps({ stats: null, loading: true }),
    })
    expect(wrapper.findAll('.animate-shimmer').length).toBeGreaterThan(0)
  })

  it('does not show skeleton when loading=true but stats already loaded (uses opacity instead)', () => {
    const wrapper = mount(ReadingLogStatsStrip, {
      props: makeProps({ loading: true }),
    })
    expect(wrapper.find('.animate-shimmer').exists()).toBe(false)
    expect(wrapper.find('.opacity-50').exists()).toBe(true)
  })

  it('renders 8 stat cards when stats loaded and not loading', () => {
    const wrapper = mount(ReadingLogStatsStrip, {
      props: makeProps(),
    })
    expect(wrapper.findAll('[data-testid="stat-card"]').length).toBe(8)
  })

  it('renders 8 stat cards when stats loaded even while re-fetching', () => {
    const wrapper = mount(ReadingLogStatsStrip, {
      props: makeProps({ loading: true }),
    })
    expect(wrapper.findAll('[data-testid="stat-card"]').length).toBe(8)
  })

  it('formats 3780 seconds as "1h 3m"', () => {
    const wrapper = mount(ReadingLogStatsStrip, {
      props: makeProps({ stats: makeStats({ totalSeconds: 3780 }) }),
    })
    expect(wrapper.text()).toContain('1h 3m')
  })

  it('shows "-" for null firstSessionAt', () => {
    const wrapper = mount(ReadingLogStatsStrip, {
      props: makeProps({ stats: makeStats({ firstSessionAt: null }) }),
    })
    expect(wrapper.text()).toContain('-')
  })

  it('shows 0 for 0 total sessions', () => {
    const wrapper = mount(ReadingLogStatsStrip, {
      props: makeProps({ stats: makeStats({ totalSessions: 0 }) }),
    })
    expect(wrapper.text()).toContain('0')
  })

  it('formats 0 seconds as "0s"', () => {
    const wrapper = mount(ReadingLogStatsStrip, {
      props: makeProps({ stats: makeStats({ totalSeconds: 0, avgDurationSeconds: 0 }) }),
    })
    expect(wrapper.text()).toContain('0s')
  })

  it('shows 0s total when stats is null and not loading', () => {
    const wrapper = mount(ReadingLogStatsStrip, {
      props: makeProps({ stats: null }),
    })
    expect(wrapper.text()).toContain('0s')
  })

  it('does not apply opacity class when not loading', () => {
    const wrapper = mount(ReadingLogStatsStrip, {
      props: makeProps(),
    })
    expect(wrapper.find('.opacity-50').exists()).toBe(false)
  })

  it('renders new derived stats cards', () => {
    const wrapper = mount(ReadingLogStatsStrip, {
      props: makeProps(),
    })
    expect(wrapper.text()).toContain('Consistency')
    expect(wrapper.text()).toContain('Momentum')
    expect(wrapper.text()).toContain('Active Days')
  })
})
