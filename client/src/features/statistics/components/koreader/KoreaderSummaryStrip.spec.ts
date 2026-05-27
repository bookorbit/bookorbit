import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import KoreaderSummaryStrip from './KoreaderSummaryStrip.vue'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

function makeResponse(data: unknown, options: { ok?: boolean; status?: number } = {}): Response {
  const { ok = true, status = ok ? 200 : 500 } = options
  return {
    ok,
    status,
    json: async () => data,
  } as Response
}

describe('KoreaderSummaryStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders onboarding empty state when summary is all zeros', async () => {
    apiMock.mockResolvedValueOnce(
      makeResponse({
        totalReadSecs: 0,
        totalSessions: 0,
        totalHighlights: 0,
        totalNotes: 0,
        booksWithStats: 0,
        currentStreak: 0,
        longestStreak: 0,
      }),
    )

    const wrapper = mount(KoreaderSummaryStrip)
    await flushPromises()

    expect(wrapper.text()).toContain('No KOReader data yet')
    expect(wrapper.text()).toContain('Sync reading progress from KOReader')
  })

  it('renders KPI values when summary has data', async () => {
    apiMock.mockResolvedValueOnce(
      makeResponse({
        totalReadSecs: 7260,
        totalSessions: 42,
        totalHighlights: 17,
        totalNotes: 5,
        booksWithStats: 9,
        currentStreak: 4,
        longestStreak: 11,
      }),
    )

    const wrapper = mount(KoreaderSummaryStrip)
    await flushPromises()

    expect(wrapper.text()).toContain('Total Reading Time')
    expect(wrapper.text()).toContain('2h 1m')
    expect(wrapper.text()).toContain('42')
    expect(wrapper.text()).toContain('4d')
    expect(wrapper.text()).toContain('17')
    expect(wrapper.text()).not.toContain('No KOReader data yet')
  })

  it('does not show empty state when booksWithStats is non-zero', async () => {
    apiMock.mockResolvedValueOnce(
      makeResponse({
        totalReadSecs: 0,
        totalSessions: 0,
        totalHighlights: 0,
        totalNotes: 0,
        booksWithStats: 3,
        currentStreak: 0,
        longestStreak: 0,
      }),
    )

    const wrapper = mount(KoreaderSummaryStrip)
    await flushPromises()

    expect(wrapper.text()).not.toContain('No KOReader data yet')
    expect(wrapper.text()).toContain('Sessions')
  })
})
