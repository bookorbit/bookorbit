import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectionHealth from '../ConnectionHealth.vue'

const NOW = new Date('2026-08-19T12:00:00Z')

function render(props: { lastTestedAt: string | null; lastTestOk: boolean | null; enabled: boolean }) {
  return mount(ConnectionHealth, { props })
}

describe('ConnectionHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => vi.useRealTimers())

  it('reads a passing test as connected', () => {
    const wrapper = render({ lastTestedAt: '2026-08-19T11:54:00Z', lastTestOk: true, enabled: true })
    expect(wrapper.text()).toContain('Connected')
  })

  it('reads a failing test as not reachable', () => {
    const wrapper = render({ lastTestedAt: '2026-08-19T11:54:00Z', lastTestOk: false, enabled: true })
    expect(wrapper.text()).toContain('Not reachable')
  })

  it('says never tested rather than inventing a state', () => {
    const wrapper = render({ lastTestedAt: null, lastTestOk: null, enabled: true })
    expect(wrapper.text()).toContain('Never tested')
    expect(wrapper.text()).not.toContain('ago')
  })

  it('lets disabled outrank a stale pass, because nothing will call it', () => {
    const wrapper = render({ lastTestedAt: '2026-08-19T11:54:00Z', lastTestOk: true, enabled: false })
    expect(wrapper.text()).toContain('Disabled')
    expect(wrapper.text()).not.toContain('Connected')
  })

  it('states recency relatively and keeps the exact time one hover away', () => {
    const wrapper = render({ lastTestedAt: '2026-08-19T11:54:00Z', lastTestOk: false, enabled: true })

    expect(wrapper.text()).toContain('failed 6 minutes ago')
    expect(wrapper.find('[title]').attributes('title')).toBeTruthy()
  })
})
