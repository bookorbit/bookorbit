import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { ApiKeySummary } from '@bookorbit/types'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>() }))

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: apiMock }))

import { useApiKeys } from './useApiKeys'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function summary(overrides: Partial<ApiKeySummary> = {}): ApiKeySummary {
  return {
    id: 4,
    name: 'Backup',
    hint: 'a1B2',
    audience: 'api',
    access: 'read',
    permissions: [],
    admin: false,
    libraryIds: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    createdBy: null,
    expiresAt: null,
    lastUsedAt: null,
    lastUsedIp: null,
    revokedAt: null,
    ...overrides,
  }
}

function lastRequest(): { url: string; init: RequestInit | undefined } {
  const call = apiMock.mock.calls.at(-1) as [string, RequestInit | undefined]
  return { url: call[0], init: call[1] }
}

describe('useApiKeys', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('lists the signed-in user own keys by default', async () => {
    apiMock.mockResolvedValueOnce(json([summary()]))
    const { keys, load } = useApiKeys()

    await load()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/api-keys', undefined)
    expect(keys.value).toHaveLength(1)
  })

  it('manages another person keys under their user path', async () => {
    const ownerId = ref<number | null>(12)
    apiMock.mockResolvedValue(json([]))
    const { load, revoke } = useApiKeys(ownerId)

    await load()
    expect(apiMock).toHaveBeenLastCalledWith('/api/v1/users/12/api-keys', undefined)

    apiMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await revoke(7)
    expect(apiMock.mock.calls.at(-2)).toEqual(['/api/v1/users/12/api-keys/7', { method: 'DELETE' }])
  })

  it('sends a creation request shaped exactly like the DTO and returns the one-time token', async () => {
    apiMock.mockResolvedValueOnce(json({ key: summary(), token: 'bok_secret' }, 201)).mockResolvedValueOnce(json([summary()]))
    const { create } = useApiKeys()

    const created = await create({ name: 'Backup', access: 'write', permissions: ['kobo_sync'], admin: false, libraryIds: [3], expiresInDays: 30 })

    expect(created.token).toBe('bok_secret')
    const [url, init] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/api-keys')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Backup',
      access: 'write',
      permissions: ['kobo_sync'],
      admin: false,
      libraryIds: [3],
      expiresInDays: 30,
    })
  })

  it('renames in place and regenerates through the owner routes', async () => {
    apiMock.mockResolvedValueOnce(json([summary()]))
    const { keys, load, rename, regenerate } = useApiKeys()
    await load()

    apiMock.mockResolvedValueOnce(json(summary({ name: 'Nightly backup' })))
    await rename(4, 'Nightly backup')
    expect(lastRequest()).toEqual({
      url: '/api/v1/api-keys/4',
      init: { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Nightly backup' }) },
    })
    expect(keys.value[0]?.name).toBe('Nightly backup')

    apiMock.mockResolvedValueOnce(json({ key: summary({ id: 5 }), token: 'bok_new' })).mockResolvedValueOnce(json([summary({ id: 5 })]))
    const created = await regenerate(4)
    expect(apiMock.mock.calls.at(-2)).toEqual(['/api/v1/api-keys/4/regenerate', { method: 'POST' }])
    expect(created.token).toBe('bok_new')
  })

  it('turns a coded refusal into its translated message', async () => {
    apiMock.mockResolvedValueOnce(json({ message: 'limit', errorCode: 'API_KEY_LIMIT_REACHED', errorMeta: { limit: 25 } }, 409))
    const { create } = useApiKeys()

    await expect(create({ name: 'One too many' })).rejects.toThrow('The limit of 25 active API keys has been reached. Revoke one first.')
  })

  it('reports a failed list without throwing', async () => {
    apiMock.mockResolvedValueOnce(json({ message: 'nope' }, 500))
    const { error, load, loaded } = useApiKeys()

    await load()

    expect(error.value).toBe('API keys could not be loaded.')
    expect(loaded.value).toBe(false)
  })
})
