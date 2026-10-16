import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditAction, type AuditLogEntry } from '@bookorbit/types'
import { api } from '@/lib/api'
import { rangeBounds, useAuditLog } from '../useAuditLog'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit & { _isRetry?: boolean }) => Promise<Response>>(),
}))

const apiMock = vi.mocked(api)

function response(body: unknown, ok = true, headers: Record<string, string> = {}): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    headers: new Headers(headers),
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
    blob: vi.fn<() => Promise<Blob>>().mockResolvedValue(new Blob(['id\n'])),
  } as unknown as Response
}

const SUMMARY = {
  kinds: { all: 10, changes: 4, signins: 6, security: 1 },
  categories: { libraries: 4 },
  securityGroups: { failed: 1, accounts: 0, passwords: 0, permissions: 0, access: 0, links: 0 },
  retentionDays: 90,
  oldestAt: '2026-08-15T04:32:57.206Z',
}

function respondByUrl() {
  apiMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.startsWith('/api/v1/audit-log/summary')) return response(SUMMARY)
    if (url.startsWith('/api/v1/audit-log/sign-ins')) return response({ data: [], total: 0 })
    if (url.startsWith('/api/v1/audit-log/actors')) return response([])
    return response({ data: [], total: 0 })
  })
}

function urls(prefix: string) {
  return apiMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith(prefix) && !url.startsWith(`${prefix}/`))
}

function params(url: string) {
  return Object.fromEntries(new URL(url, 'http://local').searchParams)
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

describe('rangeBounds', () => {
  const now = new Date(2026, 9, 16, 15, 30)

  it('cuts presets on the viewer’s own midnight', () => {
    expect(rangeBounds('today', '', '', now)).toEqual({ dateFrom: new Date(2026, 9, 16).toISOString() })
    expect(rangeBounds('7d', '', '', now)).toEqual({ dateFrom: new Date(2026, 9, 10).toISOString() })
    expect(rangeBounds('30d', '', '', now)).toEqual({ dateFrom: new Date(2026, 8, 17).toISOString() })
    expect(rangeBounds('all', '', '', now)).toEqual({})
  })

  it('runs a custom range to the end of its last day', () => {
    expect(rangeBounds('custom', '2026-10-10', '2026-10-14', now)).toEqual({
      dateFrom: new Date(2026, 9, 10).toISOString(),
      dateTo: new Date(2026, 9, 14, 23, 59, 59, 999).toISOString(),
    })
    expect(rangeBounds('custom', '', '2026-10-14', now)).toEqual({
      dateFrom: undefined,
      dateTo: new Date(2026, 9, 14, 23, 59, 59, 999).toISOString(),
    })
  })
})

describe('useAuditLog', () => {
  beforeEach(() => {
    apiMock.mockReset()
    respondByUrl()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens on the Changes view and asks for the view counts', async () => {
    const { auditLog } = mountComposable()

    await auditLog.refresh()

    expect(params(urls('/api/v1/audit-log')[0]!)).toEqual({ kind: 'changes', page: '1', pageSize: '50' })
    expect(params(apiMock.mock.calls.map(([input]) => String(input)).find((url) => url.startsWith('/api/v1/audit-log/summary'))!)).toEqual({
      kind: 'changes',
    })
    expect(auditLog.summary.value).toEqual(SUMMARY)
    expect(auditLog.loaded.value).toBe(true)
  })

  it('sends every filter, and the security group only in the Security view', async () => {
    const { auditLog } = mountComposable()
    auditLog.view.value = 'security'
    auditLog.securityGroup.value = 'failed'
    auditLog.person.value = { username: 'test1', name: 'Test One' }
    auditLog.category.value = 'access'
    auditLog.target.value = { resource: 'library', resourceId: 88, label: 'Novels' }
    auditLog.ip.value = '192.168.8.230'
    await nextTick()
    await flushPromises()

    expect(params(urls('/api/v1/audit-log').at(-1)!)).toEqual({
      kind: 'security',
      securityGroup: 'failed',
      actorUsername: 'test1',
      category: 'access',
      resource: 'library',
      resourceId: '88',
      ip: '192.168.8.230',
      page: '1',
      pageSize: '50',
    })

    auditLog.view.value = 'changes'
    await nextTick()
    await flushPromises()
    expect(auditLog.securityGroup.value).toBeNull()
    expect(params(urls('/api/v1/audit-log').at(-1)!)).not.toHaveProperty('securityGroup')
  })

  it('folds sign-ins in the viewer’s time zone and leaves target filters off that request', async () => {
    const { auditLog } = mountComposable()
    auditLog.target.value = { resource: 'library', resourceId: 88, label: 'Novels' }
    auditLog.view.value = 'signins'
    await nextTick()
    await flushPromises()

    const signIns = apiMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith('/api/v1/audit-log/sign-ins'))
    expect(signIns).toHaveLength(1)
    const sent = params(signIns[0]!)
    expect(sent.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(sent).not.toHaveProperty('resource')
    expect(sent).not.toHaveProperty('resourceId')
  })

  it('waits for typing to pause before searching', async () => {
    vi.useFakeTimers()
    const { auditLog } = mountComposable()
    auditLog.search.value = 'kore'
    await nextTick()
    auditLog.search.value = 'koreader'
    await nextTick()
    expect(urls('/api/v1/audit-log')).toHaveLength(0)

    vi.advanceTimersByTime(300)
    await nextTick()
    await flushPromises()

    expect(urls('/api/v1/audit-log')).toHaveLength(1)
    expect(params(urls('/api/v1/audit-log')[0]!).search).toBe('koreader')
  })

  it('goes back to the first page when a filter changes, and keeps the filters when paging', async () => {
    const { auditLog } = mountComposable()
    auditLog.page.value = 3
    await nextTick()
    await flushPromises()
    expect(params(urls('/api/v1/audit-log').at(-1)!).page).toBe('3')

    const summariesBefore = apiMock.mock.calls.filter(([input]) => String(input).startsWith('/api/v1/audit-log/summary')).length
    auditLog.category.value = 'books'
    await nextTick()
    await flushPromises()
    expect(auditLog.page.value).toBe(1)
    expect(params(urls('/api/v1/audit-log').at(-1)!)).toMatchObject({ page: '1', category: 'books' })
    expect(apiMock.mock.calls.filter(([input]) => String(input).startsWith('/api/v1/audit-log/summary')).length).toBe(summariesBefore + 1)
  })

  it('ignores a slower response to an older request', async () => {
    let releaseOld!: (value: Response) => void
    apiMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/v1/audit-log/summary')) return response(SUMMARY)
      if (url.includes('category=books')) return response({ data: [{ id: 2 }], total: 1 })
      return new Promise<Response>((resolve) => {
        releaseOld = resolve
      })
    })
    const { auditLog } = mountComposable()
    void auditLog.refresh()
    auditLog.category.value = 'books'
    await nextTick()
    await flushPromises()

    releaseOld(response({ data: [{ id: 1 }], total: 1 }))
    await flushPromises()

    expect(auditLog.entries.value.map((entry) => entry.id)).toEqual([2])
  })

  it('reports a failed load', async () => {
    apiMock.mockResolvedValue(response({}, false))
    const { auditLog } = mountComposable()

    await auditLog.refresh()

    expect(auditLog.error.value).toBe('Could not load audit events.')
    expect(auditLog.loading.value).toBe(false)
  })

  it('changes retention through the app setting and reloads the counts', async () => {
    const { auditLog } = mountComposable()

    await auditLog.saveRetention(365)

    const patch = apiMock.mock.calls.find(([input]) => String(input) === '/api/v1/app-settings/audit_retention_days')
    expect(patch?.[1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ value: '365' }) })
    expect(apiMock.mock.calls.some(([input]) => String(input).startsWith('/api/v1/audit-log/summary'))).toBe(true)
  })

  it('looks 40 minutes either side of an event for the same person, and returns a target’s history oldest first', async () => {
    const event = {
      id: 9,
      actorUsername: 'neon',
      createdAt: '2026-10-16T06:15:23.000Z',
      resource: 'library',
      resourceId: 88,
      action: AuditAction.LibraryDelete,
    } as AuditLogEntry
    apiMock.mockResolvedValue(response({ data: [{ id: 3 }, { id: 2 }, { id: 1 }], total: 3 }))
    const { auditLog } = mountComposable()

    await auditLog.fetchAround(event)
    const history = await auditLog.fetchHistory(event)

    const [aroundUrl, historyUrl] = apiMock.mock.calls.map(([input]) => String(input)).slice(-2)
    expect(params(aroundUrl!)).toEqual({
      actorUsername: 'neon',
      kind: 'changes',
      dateFrom: '2026-10-16T05:35:23.000Z',
      dateTo: '2026-10-16T06:55:23.000Z',
      pageSize: '20',
    })
    expect(params(historyUrl!)).toEqual({ resource: 'library', resourceId: '88', pageSize: '50' })
    expect(history).toEqual({ events: [{ id: 1 }, { id: 2 }, { id: 3 }], total: 3 })
  })

  it('exports what is shown under the server’s file name', async () => {
    const createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => 'blob:audit')
    const revokeObjectURL = vi.fn<(url: string) => void>()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    apiMock.mockImplementation(async (input) =>
      String(input).startsWith('/api/v1/audit-log/export')
        ? response({}, true, { 'Content-Disposition': 'attachment; filename="audit-log-2026-10-16.csv"' })
        : response({ data: [], total: 0 }),
    )
    const { auditLog } = mountComposable()
    auditLog.person.value = { username: 'neon', name: 'Neon' }

    await auditLog.exportLog('csv')

    const exportUrl = apiMock.mock.calls.map(([input]) => String(input)).find((url) => url.startsWith('/api/v1/audit-log/export'))!
    expect(params(exportUrl)).toEqual({ actorUsername: 'neon', kind: 'changes', format: 'csv' })
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audit')
    click.mockRestore()
    vi.unstubAllGlobals()
  })
})
