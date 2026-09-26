// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiJson, apiSend, errorMessage } from '@/lib/api-json'
import { api, NetworkError, setAccessToken, setOnAuthFailure } from '@/lib/api'

/**
 * What `fetch` rejects with when the device is offline, the connection is refused, DNS fails or the
 * origin is blocked. Its message is the browser's own untranslated English, so none of it may ever
 * reach the interface.
 */
function networkFailure(): TypeError {
  return new TypeError('Failed to fetch')
}

describe('unreachable server', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    setAccessToken(null)
    setOnAuthFailure(() => {})
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('is retagged at the one place every request passes through', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(networkFailure())

    const reason = await api('/api/v1/anything').catch((error: unknown) => error)

    expect(reason).toBeInstanceOf(NetworkError)
    expect((reason as NetworkError).message).not.toContain('Failed to fetch')
    // The browser's wording is kept for logs, never for the interface.
    expect((reason as NetworkError).browserMessage).toBe('Failed to fetch')
  })

  it('reaches JSON callers already translated, so rendering reason.message cannot leak it', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(networkFailure())

    const reason = await apiJson('/api/v1/anything', undefined, 'podcast.errors.savePlaylist').catch((error: unknown) => error)

    expect(reason).toBeInstanceOf(NetworkError)
    expect((reason as Error).message).not.toContain('Failed to fetch')
  })

  it('reaches bodyless callers the same way', async () => {
    globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(networkFailure())

    const reason = await apiSend('/api/v1/anything', { method: 'DELETE' }, 'podcast.errors.removeDownload').catch((error: unknown) => error)

    expect(reason).toBeInstanceOf(NetworkError)
    expect((reason as Error).message).not.toContain('Failed to fetch')
  })

  it('lets a caller name the action that failed rather than repeating a generic network message', () => {
    expect(errorMessage(new NetworkError('Failed to fetch'), 'podcast.errors.savePlaylist')).not.toContain('Failed to fetch')
  })

  it('still shows text a caller threw deliberately, which is already translated', () => {
    expect(errorMessage(new Error('Pick at least one show'), 'podcast.errors.savePlaylist')).toBe('Pick at least one show')
  })

  it('leaves non-network rejections alone', async () => {
    const thrown = new RangeError('something else entirely')
    globalThis.fetch = vi.fn<typeof fetch>().mockRejectedValue(thrown)

    const reason = await api('/api/v1/anything').catch((error: unknown) => error)

    expect(reason).toBe(thrown)
  })
})
