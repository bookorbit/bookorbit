// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KoboSyncSettings } from '@bookorbit/types'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({
  api: apiMock,
}))

// The composable keeps settings in a module-level ref, so each test takes a fresh module
// instance rather than inheriting whatever the previous test left behind.
async function freshComposable() {
  vi.resetModules()
  const { useKoboSettings } = await import('../useKoboSettings')
  return useKoboSettings()
}

function makeSettings(overrides: Partial<KoboSyncSettings> = {}): KoboSyncSettings {
  return {
    readingThreshold: 1,
    finishedThreshold: 99,
    convertToKepub: true,
    forceEnableHyphenation: false,
    kepubConversionLimitMb: 100,
    twoWayProgressSync: false,
    syncBookOrbitAnnotationsToKobo: false,
    storeSync: false,
    ...overrides,
  }
}

function makeResponse(data: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => data } as Response
}

describe('useKoboSettings', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('defaults store sync to off before any fetch resolves', async () => {
    const { settings } = await freshComposable()

    expect(settings.value.storeSync).toBe(false)
  })

  it('adopts the store sync flag the server reports', async () => {
    apiMock.mockResolvedValue(makeResponse(makeSettings({ storeSync: true })))
    const { settings, fetchSettings } = await freshComposable()

    await fetchSettings()

    expect(settings.value.storeSync).toBe(true)
  })

  it('sends the store sync flag in the patch body and adopts the response', async () => {
    apiMock.mockResolvedValue(makeResponse(makeSettings({ storeSync: true })))
    const { settings, updateSettings } = await freshComposable()

    await updateSettings({ storeSync: true })

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/kobo/settings',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ storeSync: true }) }),
    )
    expect(settings.value.storeSync).toBe(true)
  })

  it('surfaces the server message when an update is rejected', async () => {
    apiMock.mockResolvedValue(makeResponse({ message: 'Reading threshold must be less than finished threshold' }, false))
    const { updateSettings } = await freshComposable()

    await expect(updateSettings({ storeSync: true })).rejects.toThrow('Reading threshold must be less than finished threshold')
  })
})
