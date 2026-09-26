import { ref, watch, type Ref } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { APP_FEATURES, type Library, type LibraryType } from '@bookorbit/types'
import { storage } from '@/services/storage'
import { useAuth } from '@/features/auth/composables/useAuth'
import { userScopedKey } from '@/composables/useSidebarPrefs'

const MODE_SUFFIX = 'mode'

/** Routes that belong to exactly one medium flip the sidebar to it; anything else
 *  (dashboard, settings, statistics) is neutral and leaves the last mode in place. */
const BOOK_ROUTE_NAMES = new Set([
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
])

const BOOK_ROUTE_PREFIXES = ['book-', 'tools-']

export function routeMediaMode(routeName: unknown): LibraryType | null {
  if (typeof routeName !== 'string') return null
  if (APP_FEATURES.podcasts && routeName.startsWith('podcast-')) return 'podcasts'
  if (BOOK_ROUTE_NAMES.has(routeName)) return 'books'
  if (BOOK_ROUTE_PREFIXES.some((prefix) => routeName.startsWith(prefix))) return 'books'
  return null
}

export function clampMediaMode(value: unknown): LibraryType {
  return APP_FEATURES.podcasts && value === 'podcasts' ? 'podcasts' : 'books'
}

/** Where the switcher lands. Books share the dashboard as their home; podcasts go straight
 *  to the single library when there is only one, otherwise to the index. */
export function mediaModeHome(target: LibraryType, podcastLibraries: Pick<Library, 'id'>[]): RouteLocationRaw {
  if (APP_FEATURES.podcasts && target === 'podcasts') {
    const only = podcastLibraries.length === 1 ? podcastLibraries[0] : null
    return only ? { name: 'podcast-library', params: { id: only.id } } : { name: 'podcast-libraries' }
  }
  return { name: 'dashboard' }
}

const mode: Ref<LibraryType> = ref('books')

let hydratedForUserId: number | null = null
let watcherStarted = false

function persist(userId: number | null): void {
  if (userId === null) return
  storage.set(userScopedKey(userId, MODE_SUFFIX), mode.value)
}

function hydrate(): void {
  const { user } = useAuth()
  const userId = user.value?.id ?? null
  if (userId === null || userId === hydratedForUserId) return
  hydratedForUserId = userId
  mode.value = clampMediaMode(storage.get<unknown>(userScopedKey(userId, MODE_SUFFIX), 'books'))
}

export function useMediaMode() {
  const { user } = useAuth()

  if (!watcherStarted) {
    watcherStarted = true
    watch(() => user.value?.id ?? null, hydrate, { immediate: true })
  } else {
    hydrate()
  }

  function setMode(next: LibraryType): void {
    const availableMode = clampMediaMode(next)
    if (mode.value === availableMode) return
    mode.value = availableMode
    persist(user.value?.id ?? null)
  }

  /** Route-driven sync: deep links land in the medium they belong to, so the
   *  sidebar never shows books navigation around a podcast screen. */
  function syncModeFromRoute(routeName: unknown): void {
    const routeMode = routeMediaMode(routeName)
    if (routeMode) setMode(routeMode)
  }

  return { mode, setMode, syncModeFromRoute }
}

/** Test seam: clears the module-level state between specs. */
export function resetMediaMode(): void {
  hydratedForUserId = null
  watcherStarted = false
  mode.value = 'books'
}
