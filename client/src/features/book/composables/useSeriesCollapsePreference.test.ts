import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { AuthUser } from '@bookorbit/types'

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: vi.fn<() => unknown>(),
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => unknown>(),
}))

import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'
import { useSeriesCollapsePreference } from './useSeriesCollapsePreference'

const mockUseAuth = vi.mocked(useAuth)
const mockApi = vi.mocked(api)

function makeUser(settings: Record<string, unknown> = {}): AuthUser {
  return {
    id: 1,
    username: 'tester',
    name: 'Tester',
    email: undefined,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    settings,
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
  }
}

describe('useSeriesCollapsePreference', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockApi.mockResolvedValue(new Response(null, { status: 204 }))
  })

  describe('getEffectivePreference', () => {
    it('returns false when user has no settings', () => {
      const user = ref<AuthUser | null>(makeUser({}))
      mockUseAuth.mockReturnValue({ user } as ReturnType<typeof useAuth>)

      const { getEffectivePreference } = useSeriesCollapsePreference()

      expect(getEffectivePreference({})).toBe(false)
      expect(getEffectivePreference({ libraryId: 1 })).toBe(false)
      expect(getEffectivePreference({ collectionId: 5 })).toBe(false)
    })

    it('returns false when user is null', () => {
      mockUseAuth.mockReturnValue({ user: ref(null) } as ReturnType<typeof useAuth>)

      const { getEffectivePreference } = useSeriesCollapsePreference()

      expect(getEffectivePreference({})).toBe(false)
    })

    it('returns global preference when no library or collection context', () => {
      const user = ref(
        makeUser({
          seriesCollapsePreferences: { global: true, libraries: {}, collections: {} },
        }),
      )
      mockUseAuth.mockReturnValue({ user } as ReturnType<typeof useAuth>)

      const { getEffectivePreference } = useSeriesCollapsePreference()

      expect(getEffectivePreference({})).toBe(true)
    })

    it('returns library override over global when libraryId matches', () => {
      const user = ref(
        makeUser({
          seriesCollapsePreferences: { global: true, libraries: { '3': false }, collections: {} },
        }),
      )
      mockUseAuth.mockReturnValue({ user } as ReturnType<typeof useAuth>)

      const { getEffectivePreference } = useSeriesCollapsePreference()

      expect(getEffectivePreference({ libraryId: 3 })).toBe(false)
    })

    it('falls back to global when library has no override', () => {
      const user = ref(
        makeUser({
          seriesCollapsePreferences: { global: true, libraries: { '3': false }, collections: {} },
        }),
      )
      mockUseAuth.mockReturnValue({ user } as ReturnType<typeof useAuth>)

      const { getEffectivePreference } = useSeriesCollapsePreference()

      expect(getEffectivePreference({ libraryId: 99 })).toBe(true)
    })

    it('returns collection override over library override', () => {
      const user = ref(
        makeUser({
          seriesCollapsePreferences: { global: false, libraries: { '1': true }, collections: { '5': false } },
        }),
      )
      mockUseAuth.mockReturnValue({ user } as ReturnType<typeof useAuth>)

      const { getEffectivePreference } = useSeriesCollapsePreference()

      expect(getEffectivePreference({ collectionId: 5, libraryId: 1 })).toBe(false)
    })
  })

  describe('setPreference', () => {
    it('sets global preference optimistically', async () => {
      const userRef = ref(makeUser({ seriesCollapsePreferences: { global: false, libraries: {}, collections: {} } }))
      mockUseAuth.mockReturnValue({ user: userRef } as ReturnType<typeof useAuth>)

      const { setPreference, prefs } = useSeriesCollapsePreference()

      await setPreference('global', true)

      expect(prefs.value!.global).toBe(true)
    })

    it('calls the API with global body', async () => {
      const userRef = ref(makeUser({}))
      mockUseAuth.mockReturnValue({ user: userRef } as ReturnType<typeof useAuth>)

      const { setPreference } = useSeriesCollapsePreference()

      await setPreference('global', true)

      expect(mockApi).toHaveBeenCalledWith(
        '/api/v1/users/me/series-collapse-preferences',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ global: true }),
        }),
      )
    })

    it('sets a library override optimistically', async () => {
      const userRef = ref(makeUser({ seriesCollapsePreferences: { global: false, libraries: {}, collections: {} } }))
      mockUseAuth.mockReturnValue({ user: userRef } as ReturnType<typeof useAuth>)

      const { setPreference, prefs } = useSeriesCollapsePreference()

      await setPreference({ libraryId: 7 }, true)

      expect(prefs.value!.libraries['7']).toBe(true)
    })

    it('calls the API with library body', async () => {
      const userRef = ref(makeUser({}))
      mockUseAuth.mockReturnValue({ user: userRef } as ReturnType<typeof useAuth>)

      const { setPreference } = useSeriesCollapsePreference()

      await setPreference({ libraryId: 7 }, false)

      expect(mockApi).toHaveBeenCalledWith(
        '/api/v1/users/me/series-collapse-preferences',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ libraries: { '7': false } }),
        }),
      )
    })

    it('sets a collection override optimistically', async () => {
      const userRef = ref(makeUser({ seriesCollapsePreferences: { global: false, libraries: {}, collections: {} } }))
      mockUseAuth.mockReturnValue({ user: userRef } as ReturnType<typeof useAuth>)

      const { setPreference, prefs } = useSeriesCollapsePreference()

      await setPreference({ collectionId: 9 }, true)

      expect(prefs.value!.collections['9']).toBe(true)
    })

    it('calls the API with collection body', async () => {
      const userRef = ref(makeUser({}))
      mockUseAuth.mockReturnValue({ user: userRef } as ReturnType<typeof useAuth>)

      const { setPreference } = useSeriesCollapsePreference()

      await setPreference({ collectionId: 9 }, true)

      expect(mockApi).toHaveBeenCalledWith(
        '/api/v1/users/me/series-collapse-preferences',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ collections: { '9': true } }),
        }),
      )
    })

    it('initialises preferences from defaults when user has none', async () => {
      const userRef = ref(makeUser({}))
      mockUseAuth.mockReturnValue({ user: userRef } as ReturnType<typeof useAuth>)

      const { setPreference, prefs } = useSeriesCollapsePreference()

      await setPreference('global', true)

      expect(prefs.value).toEqual({ global: true, libraries: {}, collections: {} })
    })

    it('preserves existing library overrides when setting global', async () => {
      const userRef = ref(
        makeUser({
          seriesCollapsePreferences: { global: false, libraries: { '2': true }, collections: {} },
        }),
      )
      mockUseAuth.mockReturnValue({ user: userRef } as ReturnType<typeof useAuth>)

      const { setPreference, prefs } = useSeriesCollapsePreference()

      await setPreference('global', true)

      expect(prefs.value!.libraries['2']).toBe(true)
    })

    it('does not mutate user settings when user is null', async () => {
      mockUseAuth.mockReturnValue({ user: ref(null) } as ReturnType<typeof useAuth>)

      const { setPreference } = useSeriesCollapsePreference()

      await expect(setPreference('global', true)).resolves.toBeUndefined()
    })

    it('reverts optimistic update when API returns non-ok response', async () => {
      mockApi.mockResolvedValue(new Response(null, { status: 500 }))

      const initialSettings = { someOtherKey: 'preserved' }
      const userRef = ref(
        makeUser({
          ...initialSettings,
          seriesCollapsePreferences: { global: false, libraries: {}, collections: {} },
        }),
      )
      mockUseAuth.mockReturnValue({ user: userRef } as ReturnType<typeof useAuth>)

      const { setPreference } = useSeriesCollapsePreference()

      await setPreference('global', true)

      expect(userRef.value!.settings).toMatchObject({ seriesCollapsePreferences: { global: false } })
    })
  })
})
