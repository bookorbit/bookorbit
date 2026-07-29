import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useAuditLog } from '../useAuditLog'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit & { _isRetry?: boolean }) => Promise<Response>>(),
}))

const apiMock = vi.mocked(api)

function response(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  } as unknown as Response
}

function mountComposable() {
  let auditLog!: ReturnType<typeof useAuditLog>
  const wrapper = mount(
    defineComponent({
      setup() {
        auditLog = useAuditLog()
        return () => null
      },
    }),
  )
  return { auditLog, wrapper }
}

describe('useAuditLog', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('builds server-side filter parameters and uses the local end of day', async () => {
    apiMock.mockResolvedValue(response({ data: [], total: 0 }))
    const { auditLog } = mountComposable()
    auditLog.filters.search = '  Dune  '
    auditLog.filters.action = 'book.delete'
    auditLog.filters.actorUsername = '  reader  '
    auditLog.filters.resource = 'book'
    auditLog.filters.dateFrom = '2026-07-01'
    auditLog.filters.dateTo = '2026-07-05'

    await auditLog.applyFilters()

    const url = String(apiMock.mock.calls[0]?.[0])
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('search')).toBe('Dune')
    expect(params.get('action')).toBe('book.delete')
    expect(params.get('actorUsername')).toBe('reader')
    expect(params.get('resource')).toBe('book')
    expect(params.get('dateFrom')).toBe(new Date('2026-07-01T00:00:00').toISOString())
    expect(params.get('dateTo')).toBe(new Date('2026-07-05T23:59:59.999').toISOString())
    expect(auditLog.page.value).toBe(1)
  })

  it('loads bounded actor suggestions', async () => {
    const actors = [{ userId: 7, username: 'reader' }]
    apiMock.mockResolvedValue(response(actors))
    const { auditLog } = mountComposable()

    await auditLog.fetchActors()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/audit-log/actors?limit=100')
    expect(auditLog.actors.value).toEqual(actors)
  })

  it('shows a localized error and resets loading when fetching fails', async () => {
    apiMock.mockRejectedValue(new Error('network unavailable'))
    const { auditLog } = mountComposable()

    await auditLog.fetchPage()

    expect(auditLog.error.value).toBe('Could not load audit events.')
    expect(auditLog.loading.value).toBe(false)
  })
})
