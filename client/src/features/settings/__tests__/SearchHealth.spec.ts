import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SearchHealth from '../SearchHealth.vue'

const NOW = new Date('2026-08-19T12:00:00Z')

function render(props: { lastSearchAt: string | null; lastSearchOk: boolean | null; searchFailureStreak: number; enabled: boolean }) {
  return mount(SearchHealth, { props })
}

describe('SearchHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => vi.useRealTimers())

  it('shows a single failed search with its recency', () => {
    const wrapper = render({ lastSearchAt: '2026-08-19T11:54:00Z', lastSearchOk: false, searchFailureStreak: 1, enabled: true })

    expect(wrapper.text()).toContain('Last search failed')
    expect(wrapper.text()).toContain('last searched 6 minutes ago')
    expect(wrapper.find('[title]').attributes('title')).toBeTruthy()
  })

  it('shows the consecutive failure count after repeated failures', () => {
    const wrapper = render({ lastSearchAt: '2026-08-19T11:54:00Z', lastSearchOk: false, searchFailureStreak: 4, enabled: true })

    expect(wrapper.text()).toContain('4 searches failed in a row')
  })

  it.each([
    { lastSearchAt: null, lastSearchOk: null, searchFailureStreak: 0, enabled: true },
    { lastSearchAt: '2026-08-19T11:54:00Z', lastSearchOk: true, searchFailureStreak: 0, enabled: true },
    { lastSearchAt: '2026-08-19T11:54:00Z', lastSearchOk: false, searchFailureStreak: 2, enabled: false },
  ])('stays quiet when the source is not currently failing', (props) => {
    expect(render(props).text()).toBe('')
  })
})
