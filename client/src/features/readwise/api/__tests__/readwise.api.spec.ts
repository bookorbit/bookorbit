import { beforeEach, describe, expect, it, vi } from 'vitest'

type ApiFn = (input: RequestInfo | URL, init?: RequestInit & { _isRetry?: boolean }) => Promise<Response>

vi.mock('@/lib/api', () => ({
  api: vi.fn<ApiFn>(),
}))

import { api } from '@/lib/api'
import { fetchReadwiseSettings, upsertReadwiseSettings, validateReadwiseToken } from '../readwise.api'

const mockApi = vi.mocked(api)

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
  } as unknown as Response
}

describe('readwise.api', () => {
  beforeEach(() => {
    mockApi.mockReset()
  })

  it('fetches settings', async () => {
    mockApi.mockResolvedValueOnce(
      jsonResponse({ tokenConfigured: true, enabled: true, effectiveEnabled: true, disabledReason: null, lastSyncedAt: null }),
    )

    await expect(fetchReadwiseSettings()).resolves.toEqual({
      tokenConfigured: true,
      enabled: true,
      effectiveEnabled: true,
      disabledReason: null,
      lastSyncedAt: null,
    })

    expect(mockApi).toHaveBeenNthCalledWith(1, '/api/v1/readwise/settings')
  })

  it('surfaces server message when fetching settings fails', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({ message: 'Permission denied' }, false))

    await expect(fetchReadwiseSettings()).rejects.toThrow('Permission denied')
  })

  it('uses default message when fetch failure has no message', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({}, false))

    await expect(fetchReadwiseSettings()).rejects.toThrow('Failed to fetch Readwise settings')
  })

  it('saves settings via PATCH', async () => {
    mockApi.mockResolvedValueOnce(
      jsonResponse({ tokenConfigured: true, enabled: false, effectiveEnabled: false, disabledReason: null, lastSyncedAt: null }),
    )

    await expect(upsertReadwiseSettings({ apiToken: 'tok', enabled: false })).resolves.toEqual({
      tokenConfigured: true,
      enabled: false,
      effectiveEnabled: false,
      disabledReason: null,
      lastSyncedAt: null,
    })

    expect(mockApi).toHaveBeenNthCalledWith(
      1,
      '/api/v1/readwise/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ apiToken: 'tok', enabled: false }),
      }),
    )
  })

  it('surfaces server message on save failure', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({ message: 'Invalid token' }, false))

    await expect(upsertReadwiseSettings({ apiToken: 'bad' })).rejects.toThrow('Invalid token')
  })

  it('uses default message when save failure has no message', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({}, false))

    await expect(upsertReadwiseSettings({ enabled: true })).rejects.toThrow('Failed to save settings')
  })

  it('validates a token with a provided value', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({ valid: true }))

    await expect(validateReadwiseToken('t')).resolves.toEqual({ valid: true })

    expect(mockApi).toHaveBeenNthCalledWith(
      1,
      '/api/v1/readwise/validate-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: 't' }),
      }),
    )
  })

  it('validates using the stored token when no argument is given', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({ valid: false }))

    await expect(validateReadwiseToken()).resolves.toEqual({ valid: false })

    expect(mockApi).toHaveBeenNthCalledWith(
      1,
      '/api/v1/readwise/validate-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
  })

  it('surfaces server message when token validation fails', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({ message: 'Missing token' }, false))

    await expect(validateReadwiseToken('t')).rejects.toThrow('Missing token')
  })

  it('uses default message when token validation failure has no message', async () => {
    mockApi.mockResolvedValueOnce(jsonResponse({}, false))

    await expect(validateReadwiseToken('t')).rejects.toThrow('Failed to validate token')
  })
})
