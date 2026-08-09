import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, getValidToken, onAuthRecovered, refreshAccessToken, setAccessToken, setOnAuthFailure } from '@/lib/api'

/** A token shaped like a real JWT, so the client can read `exp` out of it. Never verified here. */
function signedToken(expiresInSeconds: number): string {
  const payload = btoa(JSON.stringify({ sub: 1, ver: 1, exp: Math.floor(Date.now() / 1000) + expiresInSeconds }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${payload}.signature`
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

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

  describe('expiry awareness', () => {
    it('renews an expired token before the request, so the server never sees it', async () => {
      const calls: { url: string; auth: string | null }[] = []
      const fetchMock = vi.fn<typeof fetch>((input: RequestInfo | URL, init?: RequestInit) => {
        const url = urlOf(input)
        calls.push({ url, auth: new Headers(init?.headers).get('Authorization') })
        if (url.endsWith('/api/v1/auth/refresh')) {
          return Promise.resolve(new Response(JSON.stringify({ accessToken: signedToken(900) }), { status: 200 }))
        }
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      })
      globalThis.fetch = fetchMock as never
      setAccessToken(signedToken(-60))

      const res = await api('/api/v1/dashboard/widgets/reading-streak')

      expect(res.status).toBe(200)
      // Refresh first, then the request. No 401 round trip, so no widget ever sees a failure.
      expect(calls.map((c) => c.url)).toEqual(['/api/v1/auth/refresh', '/api/v1/dashboard/widgets/reading-streak'])
      expect(calls[1]!.auth).not.toBe(`Bearer ${calls[0]!.auth}`)
    })

    it('renews a token that is valid but about to expire', async () => {
      const urls: string[] = []
      const fetchMock = vi.fn<typeof fetch>((input: RequestInfo | URL) => {
        urls.push(urlOf(input))
        if (urlOf(input).endsWith('/api/v1/auth/refresh')) {
          return Promise.resolve(new Response(JSON.stringify({ accessToken: signedToken(900) }), { status: 200 }))
        }
        return Promise.resolve(new Response('', { status: 200 }))
      })
      globalThis.fetch = fetchMock as never
      // Inside the 30s skew: still valid, not worth sending.
      setAccessToken(signedToken(5))

      await api('/api/v1/books/1')

      expect(urls).toEqual(['/api/v1/auth/refresh', '/api/v1/books/1'])
    })

    it('leaves a token with plenty of life alone', async () => {
      const urls: string[] = []
      const fetchMock = vi.fn<typeof fetch>((input: RequestInfo | URL) => {
        urls.push(urlOf(input))
        return Promise.resolve(new Response('', { status: 200 }))
      })
      globalThis.fetch = fetchMock as never
      setAccessToken(signedToken(900))

      await api('/api/v1/books/1')

      expect(urls).toEqual(['/api/v1/books/1'])
    })

    it('treats an undecodable token as unknown expiry and lets the 401 path decide', async () => {
      const urls: string[] = []
      let refreshed = false
      const fetchMock = vi.fn<typeof fetch>((input: RequestInfo | URL) => {
        const url = urlOf(input)
        urls.push(url)
        if (url.endsWith('/api/v1/auth/refresh')) {
          refreshed = true
          return Promise.resolve(new Response(JSON.stringify({ accessToken: signedToken(900) }), { status: 200 }))
        }
        return Promise.resolve(new Response('', { status: refreshed ? 200 : 401 }))
      })
      globalThis.fetch = fetchMock as never
      setAccessToken('not-a-jwt')

      await api('/api/v1/books/1')

      expect(urls).toEqual(['/api/v1/books/1', '/api/v1/auth/refresh', '/api/v1/books/1'])
    })

    it('getValidToken renews a stale token for websocket handshakes and uploads', async () => {
      const fresh = signedToken(900)
      globalThis.fetch = vi.fn<typeof fetch>((input: RequestInfo | URL) => {
        if (urlOf(input).endsWith('/api/v1/auth/refresh')) {
          return Promise.resolve(new Response(JSON.stringify({ accessToken: fresh }), { status: 200 }))
        }
        return Promise.resolve(new Response('', { status: 200 }))
      }) as never
      setAccessToken(signedToken(-60))

      await expect(getValidToken()).resolves.toBe(fresh)
    })

    it('getValidToken reports no token rather than refreshing when nobody is signed in', async () => {
      const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 200 })))
      globalThis.fetch = fetchMock as never
      setAccessToken(null)

      await expect(getValidToken()).resolves.toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('backs off after a failed proactive refresh instead of retrying on every call', async () => {
      const stale = signedToken(-60)
      const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 401 })))
      globalThis.fetch = fetchMock as never
      setAccessToken(stale)

      // The refresh fails, so the caller is handed the stale token to try anyway.
      await expect(getValidToken()).resolves.toBe(stale)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      await expect(getValidToken()).resolves.toBe(stale)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('auth recovery signal', () => {
    it('fires once a rejected request is followed by a successful refresh', async () => {
      let refreshed = false
      globalThis.fetch = vi.fn<typeof fetch>((input: RequestInfo | URL) => {
        if (urlOf(input).endsWith('/api/v1/auth/refresh')) {
          refreshed = true
          return Promise.resolve(new Response(JSON.stringify({ accessToken: signedToken(900) }), { status: 200 }))
        }
        return Promise.resolve(new Response('', { status: refreshed ? 200 : 401 }))
      }) as never

      const recovered = vi.fn<() => void>()
      const stop = onAuthRecovered(recovered)
      await api('/api/v1/books/1')
      stop()

      expect(recovered).toHaveBeenCalledTimes(1)
    })

    it('stays quiet for a routine refresh, so healthy views do not reload', async () => {
      globalThis.fetch = vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response(JSON.stringify({ accessToken: signedToken(900) }), { status: 200 })),
      ) as never

      const recovered = vi.fn<() => void>()
      const stop = onAuthRecovered(recovered)
      await refreshAccessToken()
      stop()

      expect(recovered).not.toHaveBeenCalled()
    })

    it('stops notifying a listener that has unsubscribed', async () => {
      let refreshed = false
      globalThis.fetch = vi.fn<typeof fetch>((input: RequestInfo | URL) => {
        if (urlOf(input).endsWith('/api/v1/auth/refresh')) {
          refreshed = true
          return Promise.resolve(new Response(JSON.stringify({ accessToken: signedToken(900) }), { status: 200 }))
        }
        return Promise.resolve(new Response('', { status: refreshed ? 200 : 401 }))
      }) as never

      const recovered = vi.fn<() => void>()
      onAuthRecovered(recovered)()
      await api('/api/v1/books/1')

      expect(recovered).not.toHaveBeenCalled()
    })
  })
})
