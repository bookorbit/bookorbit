import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import type {
  ReadingInsightsAccessHistoryPage,
  ReadingInsightsSharingLevel,
  SharedReadingInsightsDetail,
  SharedReadingInsightsSummary,
} from '@bookorbit/types'

import PrivacySharingSettings from '../PrivacySharingSettings.vue'

const sharingMock = vi.hoisted(() => ({
  settings: { value: { sharingLevel: 'summary', consentedAt: '2026-07-01T00:00:00.000Z' } },
  history: { value: { items: [], total: 0, page: 1, pageSize: 20 } as ReadingInsightsAccessHistoryPage },
  previewSummary: { value: null as SharedReadingInsightsSummary | null },
  previewDetail: { value: null as SharedReadingInsightsDetail | null },
  loading: { value: false },
  loaded: { value: true },
  historyLoading: { value: false },
  saving: { value: false },
  previewLoading: { value: false },
  error: { value: null as string | null },
  load: vi.fn<() => void>(),
  loadHistory: vi.fn<(page: number) => void>(),
  update: vi.fn<(level: ReadingInsightsSharingLevel) => Promise<boolean>>().mockResolvedValue(true),
  loadPreview: vi.fn<(days?: number) => void>(),
}))

vi.mock('../composables/useReadingInsightsSharing', () => ({ useReadingInsightsSharing: () => sharingMock }))

const sheetStubs = Object.fromEntries(
  ['Sheet', 'SheetContent', 'SheetDescription', 'SheetFooter', 'SheetHeader', 'SheetTitle'].map((name) => [
    name,
    { template: '<div><slot /></div>' },
  ]),
)

function mountSettings() {
  return shallowMount(PrivacySharingSettings, { global: { stubs: sheetStubs } })
}

describe('PrivacySharingSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sharingMock.settings.value.sharingLevel = 'summary'
    sharingMock.loaded.value = true
    sharingMock.error.value = null
    sharingMock.history.value = { items: [], total: 0, page: 1, pageSize: 20 }
    sharingMock.previewSummary.value = null
    sharingMock.previewDetail.value = null
  })

  it('loads current-user settings and explains each consent level', () => {
    const wrapper = mountSettings()

    expect(sharingMock.load).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Private')
    expect(wrapper.text()).toContain('Share summary')
    expect(wrapper.text()).toContain('Share detailed insights')
  })

  it('offers a shared-profile preview only while sharing is enabled', () => {
    const wrapper = mountSettings()

    expect(wrapper.text()).toContain('Preview your shared profile')
    expect(wrapper.text()).toContain('Profile access history')
  })

  it('does not present default privacy settings when the initial request fails', () => {
    sharingMock.loaded.value = false
    sharingMock.error.value = 'load'

    const wrapper = mountSettings()

    expect(wrapper.text()).toContain('Failed to load sharing settings')
    expect(wrapper.text()).toContain('Retry')
    expect(wrapper.text()).not.toContain('Current setting')
    expect(wrapper.find('fieldset').exists()).toBe(false)
  })

  it('confirms consent changes and restores the saved choice when cancelled', async () => {
    const wrapper = mountSettings()
    const detailed = wrapper.find('input[value="detailed"]')

    await detailed.trigger('change')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    expect(sharingMock.update).not.toHaveBeenCalled()

    await detailed.trigger('change')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Confirm')!
      .trigger('click')
    expect(sharingMock.update).toHaveBeenCalledWith('detailed')
  })

  it('loads previews and pages through access history', async () => {
    sharingMock.previewSummary.value = {
      sharingLevel: 'summary',
      periodDays: 90,
      activeDays: 2,
      readingSeconds: 3600,
      sessionsCount: 3,
      booksStarted: 1,
      booksCompleted: 1,
      formatDistribution: [],
      genreDistribution: [],
      sourceCoverage: [],
      trend: [],
    }
    sharingMock.history.value = {
      items: [{ id: 1, viewerUsername: 'admin', sharingLevel: 'summary', viewedAt: '2026-07-01T00:00:00.000Z' }],
      total: 41,
      page: 2,
      pageSize: 20,
    }
    const wrapper = mountSettings()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Load preview')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Previous')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Next')!
      .trigger('click')

    expect(sharingMock.loadPreview).toHaveBeenCalledOnce()
    expect(sharingMock.loadHistory).toHaveBeenNthCalledWith(1, 1)
    expect(sharingMock.loadHistory).toHaveBeenNthCalledWith(2, 3)
    expect(wrapper.text()).toContain('1 hour')
  })
})
