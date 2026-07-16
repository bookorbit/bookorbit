import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAccountActivity } from '../useAccountActivity'

const apiMock = vi.fn<(input: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>>()

vi.mock('@/lib/api', () => ({ api: (input: string) => apiMock(input) }))

describe('useAccountActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockImplementation(async (input: string) => {
      if (input === '/api/v1/account-activity/summary') {
        return { ok: true, json: async () => ({ recent: 2, dormant: 1, never: 3, disabled: 0 }) }
      }
      if (input.startsWith('/api/v1/account-activity?')) {
        return { ok: true, json: async () => ({ items: [], total: 0, page: 1, pageSize: 50 }) }
      }
      return { ok: false, json: async () => ({}) }
    })
  })

  it('loads the paginated list and summary with server-side filters', async () => {
    const activity = useAccountActivity()
    activity.search.value = 'reader name'
    activity.state.value = 'dormant'
    activity.provisioningMethod.value = 'oidc'

    await activity.load()

    const listUrl = apiMock.mock.calls.find(([input]) => input.startsWith('/api/v1/account-activity?'))?.[0] as string
    const params = new URL(listUrl, 'https://bookorbit.test').searchParams
    expect(params.get('search')).toBe('reader name')
    expect(params.get('state')).toBe('dormant')
    expect(params.get('provisioningMethod')).toBe('oidc')
    expect(params.get('pageSize')).toBe('50')
    expect(activity.summary.value).toEqual({ recent: 2, dormant: 1, never: 3, disabled: 0 })
  })

  it('exposes a stable error state when loading fails', async () => {
    apiMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    const activity = useAccountActivity()

    await activity.load()

    expect(activity.error.value).toBe('load')
    expect(activity.loading.value).toBe(false)
  })

  it('does not let an older filter request overwrite newer results', async () => {
    let resolveOldList!: (value: { ok: boolean; json: () => Promise<unknown> }) => void
    let resolveOldSummary!: (value: { ok: boolean; json: () => Promise<unknown> }) => void
    apiMock.mockImplementation((input) => {
      const page = new URL(input, 'https://bookorbit.test').searchParams.get('page')
      if (input === '/api/v1/account-activity/summary') {
        if (apiMock.mock.calls.filter(([url]) => url === input).length === 1) return new Promise((resolve) => (resolveOldSummary = resolve))
        return Promise.resolve({ ok: true, json: async () => ({ recent: 9, dormant: 0, never: 0, disabled: 0 }) })
      }
      if (page === '1') return new Promise((resolve) => (resolveOldList = resolve))
      return Promise.resolve({ ok: true, json: async () => ({ items: [], total: 9, page: 2, pageSize: 50 }) })
    })
    const activity = useAccountActivity()
    const oldLoad = activity.load()
    activity.page.value = 2

    await activity.load()
    resolveOldList({ ok: true, json: async () => ({ items: [], total: 1, page: 1, pageSize: 50 }) })
    resolveOldSummary({ ok: true, json: async () => ({ recent: 1, dormant: 0, never: 0, disabled: 0 }) })
    await oldLoad

    expect(activity.page.value).toBe(2)
    expect(activity.total.value).toBe(9)
    expect(activity.summary.value.recent).toBe(9)
  })
})
