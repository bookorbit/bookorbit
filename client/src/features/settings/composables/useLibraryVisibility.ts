import { computed } from 'vue'
import { LIBRARY_VISIBILITY_PLACES, type LibraryVisibilityPlace, type LibraryVisibilitySettings } from '@bookorbit/types'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'

export type HiddenLibraries = Record<LibraryVisibilityPlace, number[]>

export function normalizeHiddenLibraries(raw: unknown): HiddenLibraries {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const hidden = {} as HiddenLibraries
  for (const place of LIBRARY_VISIBILITY_PLACES) {
    const ids = source[place]
    hidden[place] = Array.isArray(ids) ? [...new Set(ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b) : []
  }
  return hidden
}

// Saves run one at a time and each sends the state at send time, so quick toggles land in order.
let queue: Promise<unknown> = Promise.resolve()

export function useLibraryVisibility() {
  const { user } = useAuth()

  const hidden = computed(() => normalizeHiddenLibraries(user.value?.settings?.libraryVisibility?.hidden))
  const anyHidden = computed(() => LIBRARY_VISIBILITY_PLACES.some((place) => hidden.value[place].length > 0))

  function isHidden(libraryId: number, place: LibraryVisibilityPlace): boolean {
    return hidden.value[place].includes(libraryId)
  }

  function placesHiding(libraryId: number): LibraryVisibilityPlace[] {
    return LIBRARY_VISIBILITY_PLACES.filter((place) => isHidden(libraryId, place))
  }

  function apply(next: HiddenLibraries): void {
    if (!user.value) return
    const libraryVisibility: LibraryVisibilitySettings = { hidden: next }
    user.value = { ...user.value, settings: { ...user.value.settings, libraryVisibility } }
  }

  function save(next: HiddenLibraries): Promise<boolean> {
    if (!user.value) return Promise.resolve(false)
    const userId = user.value.id
    const previous = hidden.value
    apply(next)

    const run = queue.then(async () => {
      if (user.value?.id !== userId) return false
      try {
        const response = await api('/api/v1/users/me/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: { libraryVisibility: { hidden: hidden.value } } }),
        })
        if (response.ok) return true
      } catch {
        // Falls through to the rollback below.
      }
      if (user.value?.id === userId) apply(previous)
      return false
    })
    queue = run
    return run
  }

  function setHidden(libraryId: number, place: LibraryVisibilityPlace, value: boolean): Promise<boolean> {
    if (isHidden(libraryId, place) === value) return Promise.resolve(true)
    const ids = value ? [...hidden.value[place], libraryId].sort((a, b) => a - b) : hidden.value[place].filter((id) => id !== libraryId)
    return save({ ...hidden.value, [place]: ids })
  }

  function showEverywhere(): Promise<boolean> {
    return save(normalizeHiddenLibraries({}))
  }

  return { hidden, anyHidden, isHidden, placesHiding, setHidden, showEverywhere }
}
