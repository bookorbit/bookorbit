import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { AuthUser } from '@bookorbit/types'

const user = ref<Partial<AuthUser> | null>(null)

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({ user, me: vi.fn<() => Promise<void>>() }),
}))

async function loadModule() {
  return import('../useMediaMode')
}

describe('useMediaMode', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    user.value = { id: 7, settings: {} }
  })

  describe('routeMediaMode', () => {
    it.each(['podcast-library', 'podcast-show', 'podcast-libraries'])('treats disabled %s routes as neutral', async (name) => {
      const { routeMediaMode } = await loadModule()

      expect(routeMediaMode(name)).toBeNull()
    })

    it.each([
      'library',
      'libraries',
      'smartScope',
      'smart-scopes',
      'collection',
      'collections',
      'authors',
      'author-detail',
      'series',
      'series-detail',
      'annotations',
      'book-detail',
      'book-dock',
      'tools-entity-manager',
    ])('classifies %s as books', async (name) => {
      const { routeMediaMode } = await loadModule()

      expect(routeMediaMode(name)).toBe('books')
    })

    it.each(['dashboard', 'settings-podcasts', 'statistics', 'achievements', 'whats-new', undefined, null, Symbol('x')])(
      'treats %s as neutral',
      async (name) => {
        const { routeMediaMode } = await loadModule()

        expect(routeMediaMode(name)).toBeNull()
      },
    )
  })

  describe('mediaModeHome', () => {
    it('sends books to the dashboard', async () => {
      const { mediaModeHome } = await loadModule()

      expect(mediaModeHome('books', [{ id: 3 }])).toEqual({ name: 'dashboard' })
    })

    it('sends disabled podcast mode to the books dashboard', async () => {
      const { mediaModeHome } = await loadModule()

      expect(mediaModeHome('podcasts', [{ id: 3 }])).toEqual({ name: 'dashboard' })
    })
  })

  describe('mode state', () => {
    it('defaults to books and ignores a disabled podcast switch', async () => {
      const { useMediaMode } = await loadModule()
      const { mode, setMode } = useMediaMode()
      await nextTick()

      expect(mode.value).toBe('books')
      setMode('podcasts')

      expect(mode.value).toBe('books')
      expect(localStorage.getItem('bookorbit:u7:sidebar:mode')).toBeNull()
    })

    it('restores the stored mode for the signed-in user and clamps junk', async () => {
      localStorage.setItem('bookorbit:u7:sidebar:mode', '"podcasts"')
      localStorage.setItem('bookorbit:u9:sidebar:mode', '"nonsense"')

      const first = await loadModule()
      const { mode } = first.useMediaMode()
      await nextTick()
      expect(mode.value).toBe('books')

      user.value = { id: 9, settings: {} }
      await nextTick()
      expect(mode.value).toBe('books')
    })

    it('follows media routes and ignores neutral ones', async () => {
      const { useMediaMode } = await loadModule()
      const { mode, syncModeFromRoute } = useMediaMode()
      await nextTick()

      syncModeFromRoute('podcast-show')
      expect(mode.value).toBe('books')

      syncModeFromRoute('dashboard')
      expect(mode.value).toBe('books')

      syncModeFromRoute('authors')
      expect(mode.value).toBe('books')
    })
  })
})
