import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activateI18nLocale } from '@/i18n'
import IgnoreCacheCheckbox from '../IgnoreCacheCheckbox.vue'
import MetadataCacheBadge from '../MetadataCacheBadge.vue'
import MetadataCacheNotice from '../MetadataCacheNotice.vue'

describe('metadata cache components', () => {
  beforeEach(() => {
    activateI18nLocale('en')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-10T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says how old the oldest saved result is and emits searchFresh', async () => {
    const wrapper = mount(MetadataCacheNotice, {
      props: { summary: { cachedCount: 2, staleCount: 0, oldestFetchedAt: '2026-10-07T12:00:00.000Z' } },
    })

    expect(wrapper.get('[role="status"]').text()).toBe('Some results came from saved searches (oldest: 3 days ago).')
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('searchFresh')).toHaveLength(1)
  })

  it('explains stale results when a provider was unavailable', () => {
    const wrapper = mount(MetadataCacheNotice, {
      props: { summary: { cachedCount: 1, staleCount: 1, oldestFetchedAt: '2026-10-09T12:00:00.000Z' } },
    })

    expect(wrapper.get('[role="status"]').text()).toContain('unavailable')
  })

  it('marks cached and stale results differently', () => {
    const cached = mount(MetadataCacheBadge, { props: { info: { fetchedAt: '2026-10-09T12:00:00.000Z', stale: false } } })
    const stale = mount(MetadataCacheBadge, { props: { info: { fetchedAt: '2026-10-09T12:00:00.000Z', stale: true } } })

    expect(cached.get('[data-testid="metadata-cache-badge"]').attributes('data-stale')).toBe('false')
    expect(stale.get('[data-testid="metadata-cache-badge"]').attributes('data-stale')).toBe('true')
    expect(cached.text()).toContain('Cached')
    expect(stale.text()).toContain('Stale')
  })

  it('binds the ignore-cache checkbox and describes it', async () => {
    const wrapper = mount(IgnoreCacheCheckbox, { props: { modelValue: false } })
    const input = wrapper.get<HTMLInputElement>('input[type="checkbox"]')

    expect(input.attributes('aria-describedby')).toBeTruthy()
    await input.setValue(true)
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([true])
  })
})
