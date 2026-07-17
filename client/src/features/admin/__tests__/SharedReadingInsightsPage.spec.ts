import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'

import SharedReadingInsightsPage from '../SharedReadingInsightsPage.vue'

const insightsMock = vi.hoisted(() => ({
  account: { value: { id: 9, name: 'Reader' } },
  session: { value: { viewSessionId: 'session', sharingLevel: 'summary', expiresAt: '2026-07-01' } },
  summary: {
    value: {
      sharingLevel: 'summary',
      periodDays: 90,
      activeDays: 2,
      readingSeconds: 3600,
      sessionsCount: 3,
      booksStarted: 1,
      booksCompleted: 1,
      formatDistribution: [{ name: 'EPUB', readingSeconds: 3600 }],
      genreDistribution: [],
      sourceCoverage: [{ source: 'web', readingSeconds: 3600, sessionsCount: 3 }],
      trend: [],
    },
  },
  detail: { value: null },
  days: { value: 90 },
  loading: { value: false },
  errorCode: { value: null as string | null },
  initialize: vi.fn<() => void>(),
  loadInsights: vi.fn<() => void>(),
}))

vi.mock('../composables/useSharedReadingInsights', () => ({ useSharedReadingInsights: () => insightsMock }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn<(location: unknown) => void>() }) }))

describe('SharedReadingInsightsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insightsMock.errorCode.value = null
  })

  it('shows the consent and audit disclosure with summary-only data', () => {
    const wrapper = shallowMount(SharedReadingInsightsPage, { props: { userId: 9 } })

    expect(insightsMock.initialize).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Reading information this user voluntarily chose to share')
    expect(wrapper.text()).toContain('Access to this profile is recorded')
    expect(wrapper.text()).toContain('Sessions')
    expect(wrapper.text()).toContain('Reading time')
    expect(wrapper.text()).toContain('Daily reading trend')
    expect(wrapper.text()).not.toContain('adminFeature.sharedInsights')
    expect(wrapper.text()).not.toContain('Most-read books')
  })

  it('shows a localized privacy error without previously loaded metrics', () => {
    insightsMock.errorCode.value = 'READING_INSIGHTS_PRIVATE'
    const wrapper = shallowMount(SharedReadingInsightsPage, { props: { userId: 9 } })

    expect(wrapper.text()).toContain('This user is not sharing reading insights')
    expect(wrapper.text()).toContain('No previously loaded profile information')
    expect(wrapper.text()).not.toContain('Reading time')
  })

  it('reinitializes immediately when the router reuses the page for another user', async () => {
    const wrapper = shallowMount(SharedReadingInsightsPage, { props: { userId: 9 } })
    expect(insightsMock.initialize).toHaveBeenCalledOnce()

    await wrapper.setProps({ userId: 10 })

    expect(insightsMock.initialize).toHaveBeenCalledTimes(2)
  })
})
