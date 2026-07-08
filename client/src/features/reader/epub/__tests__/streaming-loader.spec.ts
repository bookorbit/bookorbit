import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api, setAccessToken, setOnAuthFailure } from '@/lib/api'

// @ts-expect-error public Foliate asset has no TypeScript declarations.
import { makeStreamingLoader } from '../../../../../public/assets/foliate/streaming-loader.js'

describe('makeStreamingLoader auth integration', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    setAccessToken(null)
    setOnAuthFailure(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    setAccessToken(null)
    vi.restoreAllMocks()
  })

  it('uses the supplied api fetcher so expired EPUB file requests refresh and retry', async () => {
    const calls: { url: string; auth: string | null }[] = []
    const chapterUrl = '/api/v1/epub/42/file/text/chapter%201.xhtml?fileId=9'
    const fetchMock = vi.fn<typeof fetch>((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const headers = new Headers(init?.headers)
      calls.push({ url, auth: headers.get('Authorization') })

      if (url === '/api/v1/auth/refresh') {
        return Promise.resolve(new Response(JSON.stringify({ accessToken: 'fresh-token' }), { status: 200 }))
      }

      if (url === chapterUrl && headers.get('Authorization') === 'Bearer stale-token') {
        return Promise.resolve(new Response('', { status: 401 }))
      }

      if (url === chapterUrl && headers.get('Authorization') === 'Bearer fresh-token') {
        return Promise.resolve(new Response('<html>chapter</html>', { status: 200 }))
      }

      return Promise.resolve(new Response('', { status: 500 }))
    })
    globalThis.fetch = fetchMock as never
    setAccessToken('stale-token')

    const loader = makeStreamingLoader(42, '/api/v1/epub', { manifest: [{ href: 'text/chapter 1.xhtml', size: 20 }] }, api, null, 9)

    await expect(loader.loadText('text/chapter 1.xhtml')).resolves.toBe('<html>chapter</html>')
    expect(calls).toEqual([
      { url: chapterUrl, auth: 'Bearer stale-token' },
      { url: '/api/v1/auth/refresh', auth: 'Bearer stale-token' },
      { url: chapterUrl, auth: 'Bearer fresh-token' },
    ])
  })

  it('supports the legacy static token argument for already-cached app bundles', async () => {
    const calls: { url: string; auth: string | null }[] = []
    const chapterUrl = '/api/v1/epub/42/file/text/chapter%201.xhtml?fileId=9'
    const fetchMock = vi.fn<typeof fetch>((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const headers = new Headers(init?.headers)
      calls.push({ url, auth: headers.get('Authorization') })
      return Promise.resolve(new Response('<html>chapter</html>', { status: 200 }))
    })
    globalThis.fetch = fetchMock as never

    const loader = makeStreamingLoader(42, '/api/v1/epub', { manifest: [{ href: 'text/chapter 1.xhtml', size: 20 }] }, 'legacy-token', null, 9)

    await expect(loader.loadText('text/chapter 1.xhtml')).resolves.toBe('<html>chapter</html>')
    expect(calls).toEqual([{ url: chapterUrl, auth: 'Bearer legacy-token' }])
  })
})
