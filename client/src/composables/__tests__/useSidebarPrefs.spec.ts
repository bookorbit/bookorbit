import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { AuthUser } from '@bookorbit/types'

const user = ref<Partial<AuthUser> | null>(null)
const meMock = vi.fn<() => Promise<void>>()
const apiMock = vi.fn<(...args: unknown[]) => Promise<{ ok: boolean }>>()

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({ user, me: meMock }),
}))

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

async function loadModule() {
  return import('../useSidebarPrefs')
}

describe('useSidebarPrefs', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    apiMock.mockResolvedValue({ ok: true })
    meMock.mockResolvedValue(undefined)
    user.value = { id: 7, settings: {} }
  })

  describe('parseSidebarConfig', () => {
    it('falls back to open sections at the default cap for an absent config', async () => {
      const { parseSidebarConfig } = await loadModule()

      expect(parseSidebarConfig(undefined)).toEqual({
        libraries: { open: true, cap: 8 },
        smartScopes: { open: true, cap: 8 },
        collections: { open: true, cap: 8 },
      })
    })

    it.each([null, 'nonsense', 42, { sections: 'nope' }])('ignores the malformed config %s', async (raw) => {
      const { parseSidebarConfig, clampCap } = await loadModule()

      expect(parseSidebarConfig(raw).libraries).toEqual({ open: true, cap: clampCap(undefined) })
    })

    it('clamps caps outside the allowed set and coerces open to a boolean', async () => {
      const { parseSidebarConfig } = await loadModule()

      const parsed = parseSidebarConfig({
        sections: {
          libraries: { open: false, cap: 7 },
          smartScopes: { open: 'yes', cap: 'all' },
          collections: { open: false, cap: 20 },
        },
      })

      expect(parsed.libraries).toEqual({ open: false, cap: 8 })
      expect(parsed.smartScopes).toEqual({ open: true, cap: 'all' })
      expect(parsed.collections).toEqual({ open: false, cap: 20 })
    })
  })

  describe('clampCap', () => {
    it.each([5, 8, 12, 20, 'all'])('keeps the allowed cap %s', async (cap) => {
      const { clampCap } = await loadModule()

      expect(clampCap(cap)).toBe(cap)
    })

    it.each([0, 7, -1, 'lots', null, undefined])('replaces the invalid cap %s with the default', async (cap) => {
      const { clampCap } = await loadModule()

      expect(clampCap(cap)).toBe(8)
    })
  })

  describe('device-local keys', () => {
    it('scopes reads and writes to the signed-in user', async () => {
      const { useSidebarPrefs } = await loadModule()
      const { readDeviceValue, writeDeviceValue } = useSidebarPrefs()

      writeDeviceValue('width', 320)

      expect(localStorage.getItem('bookorbit:u7:sidebar:width')).toBe('320')
      expect(readDeviceValue('width', 256)).toBe(320)
    })

    it('keeps two accounts in one browser separate', async () => {
      const { useSidebarPrefs } = await loadModule()
      useSidebarPrefs().writeDeviceValue('collapsed', true)

      user.value = { id: 9, settings: {} }
      await nextTick()

      expect(useSidebarPrefs().readDeviceValue('collapsed', false)).toBe(false)
    })
  })

  describe('account-scoped section state', () => {
    it('hydrates sections from the signed-in user settings', async () => {
      user.value = {
        id: 7,
        settings: { sidebarConfig: { sections: { libraries: { open: false, cap: 12 } } } } as AuthUser['settings'],
      }

      const { useSidebarPrefs } = await loadModule()
      const { sections } = useSidebarPrefs()
      await nextTick()

      expect(sections.libraries).toEqual({ open: false, cap: 12 })
    })

    it('persists a section change through PATCH /users/me/settings', async () => {
      vi.useFakeTimers()
      const { useSidebarPrefs } = await loadModule()
      const { toggleSection, setSectionCap } = useSidebarPrefs()
      await nextTick()

      toggleSection('collections')
      setSectionCap('collections', 20)
      await vi.advanceTimersByTimeAsync(1000)

      expect(apiMock).toHaveBeenCalledTimes(1)
      expect(apiMock).toHaveBeenCalledWith(
        '/api/v1/users/me/settings',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            settings: {
              sidebarConfig: {
                sections: {
                  libraries: { open: true, cap: 8 },
                  smartScopes: { open: true, cap: 8 },
                  collections: { open: false, cap: 20 },
                },
              },
            },
          }),
        }),
      )
      vi.useRealTimers()
    })

    it('rejects a cap outside the allowed set', async () => {
      const { useSidebarPrefs } = await loadModule()
      const { sections, setSectionCap } = useSidebarPrefs()
      await nextTick()

      setSectionCap('libraries', 7 as never)

      expect(sections.libraries.cap).toBe(8)
    })
  })

  describe('legacy migration', () => {
    it('seeds section state from the unscoped keys and removes them', async () => {
      vi.useFakeTimers()
      localStorage.setItem('bookorbit:sidebar:libraries', 'false')
      localStorage.setItem('bookorbit:sidebar:smart-scopes', 'true')
      localStorage.setItem('bookorbit:sidebar:collections', 'false')

      const { useSidebarPrefs } = await loadModule()
      const { sections } = useSidebarPrefs()
      await nextTick()

      expect(sections.libraries.open).toBe(false)
      expect(sections.smartScopes.open).toBe(true)
      expect(sections.collections.open).toBe(false)
      expect(localStorage.getItem('bookorbit:sidebar:libraries')).toBeNull()
      expect(localStorage.getItem('bookorbit:sidebar:smart-scopes')).toBeNull()
      expect(localStorage.getItem('bookorbit:sidebar:collections')).toBeNull()

      await vi.advanceTimersByTimeAsync(1000)
      expect(apiMock).toHaveBeenCalledTimes(1)
      vi.useRealTimers()
    })

    it('moves the unscoped width to the user-scoped key', async () => {
      localStorage.setItem('bookorbit:sidebar:width', '312')

      const { useSidebarPrefs } = await loadModule()
      useSidebarPrefs()
      await nextTick()

      expect(localStorage.getItem('bookorbit:u7:sidebar:width')).toBe('312')
      expect(localStorage.getItem('bookorbit:sidebar:width')).toBeNull()
    })

    it('does not overwrite an existing user-scoped width', async () => {
      localStorage.setItem('bookorbit:sidebar:width', '312')
      localStorage.setItem('bookorbit:u7:sidebar:width', '400')

      const { useSidebarPrefs } = await loadModule()
      useSidebarPrefs()
      await nextTick()

      expect(localStorage.getItem('bookorbit:u7:sidebar:width')).toBe('400')
    })
  })
})
