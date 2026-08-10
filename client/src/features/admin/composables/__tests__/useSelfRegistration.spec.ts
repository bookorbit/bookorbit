import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSelfRegistration } from '../useSelfRegistration'

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn<(input: string, init?: RequestInit) => Promise<unknown>>(),
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useSelfRegistration', () => {
  describe('load', () => {
    it('reads the enabled setting from the app-settings list', async () => {
      apiMock.mockResolvedValue(
        jsonResponse([
          { key: 'opds_enabled', value: 'false' },
          { key: 'allow_registration', value: 'true' },
        ]),
      )

      const { allowRegistration, loading, error, load } = useSelfRegistration()
      await load()

      expect(apiMock).toHaveBeenCalledWith('/api/v1/app-settings')
      expect(allowRegistration.value).toBe(true)
      expect(loading.value).toBe(false)
      expect(error.value).toBeNull()
    })

    it('treats a disabled setting as closed', async () => {
      apiMock.mockResolvedValue(jsonResponse([{ key: 'allow_registration', value: 'false' }]))

      const { allowRegistration, load } = useSelfRegistration()
      await load()

      expect(allowRegistration.value).toBe(false)
    })

    it('treats a missing setting as closed', async () => {
      apiMock.mockResolvedValue(jsonResponse([{ key: 'opds_enabled', value: 'true' }]))

      const { allowRegistration, error, load } = useSelfRegistration()
      await load()

      expect(allowRegistration.value).toBe(false)
      expect(error.value).toBeNull()
    })

    it('reports a load error when the request fails', async () => {
      apiMock.mockResolvedValue({ ok: false, json: async () => ({}) })

      const { allowRegistration, error, loading, load } = useSelfRegistration()
      await load()

      expect(error.value).toBe('load')
      expect(allowRegistration.value).toBe(false)
      expect(loading.value).toBe(false)
    })

    it('reports a load error when the request throws', async () => {
      apiMock.mockRejectedValue(new Error('network'))

      const { error, loading, load } = useSelfRegistration()
      await load()

      expect(error.value).toBe('load')
      expect(loading.value).toBe(false)
    })
  })

  describe('setAllowRegistration', () => {
    it('patches the setting and updates local state', async () => {
      apiMock.mockResolvedValue(jsonResponse({ key: 'allow_registration', value: 'true' }))

      const { allowRegistration, saving, error, setAllowRegistration } = useSelfRegistration()
      const ok = await setAllowRegistration(true)

      expect(ok).toBe(true)
      expect(apiMock).toHaveBeenCalledWith('/api/v1/app-settings/allow_registration', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'true' }),
      })
      expect(allowRegistration.value).toBe(true)
      expect(saving.value).toBe(false)
      expect(error.value).toBeNull()
    })

    it('sends the string "false" when disabling', async () => {
      apiMock.mockResolvedValue(jsonResponse({ key: 'allow_registration', value: 'false' }))

      const { setAllowRegistration } = useSelfRegistration()
      await setAllowRegistration(false)

      expect(apiMock).toHaveBeenCalledWith(
        '/api/v1/app-settings/allow_registration',
        expect.objectContaining({ body: JSON.stringify({ value: 'false' }) }),
      )
    })

    it('keeps the previous value and reports an error when the patch fails', async () => {
      apiMock.mockResolvedValueOnce(jsonResponse([{ key: 'allow_registration', value: 'true' }]))
      const { allowRegistration, error, saving, load, setAllowRegistration } = useSelfRegistration()
      await load()

      apiMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      const ok = await setAllowRegistration(false)

      expect(ok).toBe(false)
      expect(allowRegistration.value).toBe(true)
      expect(error.value).toBe('save')
      expect(saving.value).toBe(false)
    })
  })
})
