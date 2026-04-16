import { computed } from 'vue'
import type { SeriesCollapsePreferences } from '@projectx/types'
import { resolveCollapsePreference } from '@projectx/types'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'

export function useSeriesCollapsePreference() {
  const { user } = useAuth()

  const prefs = computed((): SeriesCollapsePreferences | undefined => {
    return user.value?.settings.seriesCollapsePreferences
  })

  function getEffectivePreference(ctx: { libraryId?: number; collectionId?: number }): boolean {
    return resolveCollapsePreference(prefs.value, ctx)
  }

  async function setPreference(ctx: { libraryId?: number; collectionId?: number } | 'global', value: boolean): Promise<void> {
    let body: Record<string, unknown>
    if (ctx === 'global') {
      body = { global: value }
    } else if (ctx.collectionId !== undefined) {
      body = { collections: { [String(ctx.collectionId)]: value } }
    } else if (ctx.libraryId !== undefined) {
      body = { libraries: { [String(ctx.libraryId)]: value } }
    } else {
      body = { global: value }
    }

    const current = prefs.value ?? { global: false, libraries: {}, collections: {} }
    const updated: SeriesCollapsePreferences = {
      global: body.global !== undefined ? (body.global as boolean) : (current.global ?? false),
      libraries: { ...current.libraries, ...(body.libraries as Record<string, boolean>) },
      collections: { ...current.collections, ...(body.collections as Record<string, boolean>) },
    }

    const previous = user.value?.settings ? { ...user.value.settings } : undefined

    if (user.value) {
      user.value.settings = {
        ...user.value.settings,
        seriesCollapsePreferences: updated,
      }
    }

    try {
      const res = await api('/api/v1/users/me/series-collapse-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok && user.value && previous !== undefined) {
        user.value.settings = previous
      }
    } catch {
      if (user.value && previous !== undefined) {
        user.value.settings = previous
      }
    }
  }

  return { getEffectivePreference, setPreference, prefs }
}
