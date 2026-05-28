import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, refreshAccessToken, setAccessToken, setOnAuthFailure } from '@/lib/api'

describe('api wrapper', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    setAccessToken(null)
    setOnAuthFailure(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('coalesces concurrent refreshes into a single network call (single-flight)', async () => {
    let refreshResolvers: ((value: Response) => void)[] = []
    const fetchMock = vi.fn<typeof fetch>((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/api/v1/auth/refresh')) {
        return new Promise<Response>((resolve) => {
          refreshResolvers.push(resolve)
        })
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    globalThis.fetch = fetchMock as never

    const p1 = refreshAccessToken().catch(() => null)
    const p2 = refreshAccessToken().catch(() => null)
    const p3 = refreshAccessToken().catch(() => null)

    // All three callers share one in-flight request.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    refreshResolvers[0]!(new Response(JSON.stringify({ accessToken: 'new-token' }), { status: 200 }))
    const results = await Promise.all([p1, p2, p3])
    expect(results).toEqual(['new-token', 'new-token', 'new-token'])

    // After the in-flight promise settles, the next call should open a new flight.
    refreshResolvers = []
    const p4 = refreshAccessToken().catch(() => null)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    refreshResolvers[0]!(new Response(JSON.stringify({ accessToken: 'next-token' }), { status: 200 }))
    await p4
  })

  it('on 401, refreshes once and retries the original request with the new token', async () => {
    const calls: { url: string; auth: string | null }[] = []
    let refreshed = false
    const fetchMock = vi.fn<typeof fetch>((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const headers = new Headers(init?.headers)
      calls.push({ url, auth: headers.get('Authorization') })
      if (url.endsWith('/api/v1/auth/refresh')) {
        refreshed = true
        return Promise.resolve(new Response(JSON.stringify({ accessToken: 'fresh-token' }), { status: 200 }))
      }
      if (!refreshed) return Promise.resolve(new Response('', { status: 401 }))
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    })
    globalThis.fetch = fetchMock as never
    setAccessToken('stale-token')

    const res = await api('/api/v1/books/1')
    expect(res.status).toBe(200)
    // 1st: original with stale token -> 401, 2nd: refresh, 3rd: retry with fresh token
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/books/1', '/api/v1/auth/refresh', '/api/v1/books/1'])
    expect(calls[0]!.auth).toBe('Bearer stale-token')
    expect(calls[2]!.auth).toBe('Bearer fresh-token')
  })

  it('invokes onAuthFailure when refresh itself fails', async () => {
    const fetchMock = vi.fn<typeof fetch>((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.endsWith('/api/v1/auth/refresh')) return Promise.resolve(new Response('', { status: 401 }))
      return Promise.resolve(new Response('', { status: 401 }))
    })
    globalThis.fetch = fetchMock as never

    const onFail = vi.fn<() => void>()
    setOnAuthFailure(onFail)
    await expect(api('/api/v1/books/1')).rejects.toThrow('Session expired')
    expect(onFail).toHaveBeenCalledTimes(1)
  })
})
