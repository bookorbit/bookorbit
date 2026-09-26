import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Library, PodcastLibrarySettings, PodcastPlaybackPreferences } from '@bookorbit/types'
import { Permission } from '@bookorbit/types'

const libraries = ref<Library[]>([])
const isSuperuser = ref(false)
const permissions = ref<string[]>([])
const fetchLibraries = vi.fn<() => Promise<void>>()
const apiMock = vi.fn<(url: string, options?: RequestInit) => Promise<Response>>()
const resetPreferences = vi.fn<() => void>()
const loadPreferences = vi.fn<() => Promise<void>>()

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({ libraries, fetchLibraries }),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    isSuperuser,
    hasPermission: (permission: string) => isSuperuser.value || permissions.value.includes(permission),
  }),
}))

vi.mock('@/lib/api', () => ({
  api: (url: string, options?: RequestInit) => apiMock(url, options),
}))

vi.mock('./usePodcastPlayer', () => ({
  usePodcastPlayer: () => ({ resetPreferences, loadPreferences }),
}))

import { usePodcastSettings } from './usePodcastSettings'
import { jsonResponse } from '../test/fixtures'

const playback: PodcastPlaybackPreferences = {
  defaultPlaybackRate: 1.2,
  volume: 0.8,
  skipBackwardSeconds: 20,
  skipForwardSeconds: 40,
  podcastPlaybackRates: { '17': 1.8 },
}

const librarySettings: PodcastLibrarySettings = {
  libraryId: 2,
  storageQuotaBytes: String(100 * 1024 ** 3),
  minimumFreeSpaceBytes: String(5 * 1024 ** 3),
  defaultRefreshIntervalMinutes: 60,
  completionRemainingSeconds: 45,
  usedStorageBytes: String(3 * 1024 ** 3),
}

function library(id: number, type: Library['type'], accessLevel: Library['accessLevel']): Library {
  return { id, type, accessLevel, name: `Library ${id}` } as Library
}

describe('usePodcastSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    libraries.value = [library(1, 'books', 'owner'), library(2, 'podcasts', 'owner')]
    isSuperuser.value = false
    permissions.value = []
    fetchLibraries.mockResolvedValue()
    loadPreferences.mockResolvedValue()
    apiMock.mockImplementation(async (url) => {
      if (url === '/api/v1/user-preferences/podcast-playback') return jsonResponse({ settings: playback })
      if (url === '/api/v1/podcast-libraries/2/settings') return jsonResponse(librarySettings)
      return new Response(null, { status: 204 })
    })
  })

  it('loads playback preferences and only accessible podcast libraries', async () => {
    const settings = usePodcastSettings()

    await settings.load()

    expect(settings.podcastLibraries.value.map((item) => item.id)).toEqual([2])
    expect(settings.selectedLibraryId.value).toBe(2)
    expect(settings.playback.value).toEqual(playback)
    expect(settings.completionSeconds.value).toBe(45)
  })

  it('preserves per-show playback rates and refreshes the active player after saving', async () => {
    const settings = usePodcastSettings()
    await settings.load()
    settings.playback.value.defaultPlaybackRate = 1.5

    await settings.savePlayback()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/user-preferences/podcast-playback',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ settings: { ...playback, defaultPlaybackRate: 1.5 } }),
      }),
    )
    expect(resetPreferences).toHaveBeenCalledOnce()
    expect(loadPreferences).toHaveBeenCalledOnce()
  })

  it('requires both owner access and retention permission to edit a library', async () => {
    const settings = usePodcastSettings()
    await settings.load()
    expect(settings.canEditLibrary.value).toBe(false)

    permissions.value = [Permission.PodcastManageRetention]
    expect(settings.canEditLibrary.value).toBe(true)

    libraries.value = [library(2, 'podcasts', 'editor')]
    expect(settings.canEditLibrary.value).toBe(false)
  })

  it('saves bounded library settings as byte strings', async () => {
    permissions.value = [Permission.PodcastManageRetention]
    const settings = usePodcastSettings()
    await settings.load()
    settings.quotaGb.value = '12.5'
    settings.freeSpaceGb.value = '2'
    settings.refreshMinutes.value = 90
    settings.completionSeconds.value = 30

    await settings.saveLibrary()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-libraries/2/settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          storageQuotaBytes: String(Math.round(12.5 * 1024 ** 3)),
          minimumFreeSpaceBytes: String(2 * 1024 ** 3),
          defaultRefreshIntervalMinutes: 90,
          completionRemainingSeconds: 30,
        }),
      }),
    )
  })
})
