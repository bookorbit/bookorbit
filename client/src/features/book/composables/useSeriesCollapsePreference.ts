import { computed } from 'vue'
import type { SeriesCollapsePreferences } from '@bookorbit/types'
import { resolveCollapsePreference } from '@bookorbit/types'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'

export function useSeriesCollapsePreference() {
  const { user } = useAuth()

  const prefs = computed((): SeriesCollapsePreferences | undefined => {
    return user.value?.settings.seriesCollapsePreferences
  })

  function getEffectivePreference(ctx: { libraryId?: number; collectionId?: number; smartScopeId?: number }): boolean {
    return resolveCollapsePreference(prefs.value, ctx)
  }

  let pendingUpdate: Promise<void> = Promise.resolve()

  async function setPreference(
    ctx: { libraryId?: number; collectionId?: number; smartScopeId?: number } | 'global',
    value: boolean | null,
  ): Promise<void> {
    const op = () => doSetPreference(ctx, value)
    pendingUpdate = pendingUpdate.then(op, op)
    return pendingUpdate
  }

  async function doSetPreference(
    ctx: { libraryId?: number; collectionId?: number; smartScopeId?: number } | 'global',
    value: boolean | null,
  ): Promise<void> {
    let body: Record<string, unknown>
    if (ctx === 'global') {
      body = { global: value === null ? false : value }
    } else if (ctx.smartScopeId !== undefined) {
      body = { smartScopes: { [String(ctx.smartScopeId)]: value } }
    } else if (ctx.collectionId !== undefined) {
      body = { collections: { [String(ctx.collectionId)]: value } }
    } else if (ctx.libraryId !== undefined) {
      body = { libraries: { [String(ctx.libraryId)]: value } }
    } else {
      body = { global: value === null ? false : value }
    }

    const current = prefs.value ?? { global: false, libraries: {}, collections: {}, smartScopes: {} }
    const nextLibraries = { ...current.libraries, ...(body.libraries as Record<string, boolean | null>) }
    const nextCollections = { ...current.collections, ...(body.collections as Record<string, boolean | null>) }
    const nextSmartScopes = { ...current.smartScopes, ...(body.smartScopes as Record<string, boolean | null>) }

    // Remove null entries (deletion)
    for (const [k, v] of Object.entries(nextLibraries)) {
      if (v === null) delete nextLibraries[k]
    }
    for (const [k, v] of Object.entries(nextCollections)) {
      if (v === null) delete nextCollections[k]
    }
    for (const [k, v] of Object.entries(nextSmartScopes)) {
      if (v === null) delete nextSmartScopes[k]
    }

    const updated: SeriesCollapsePreferences = {
      global: body.global !== undefined ? (body.global as boolean) : (current.global ?? false),
      libraries: nextLibraries as Record<string, boolean>,
      collections: nextCollections as Record<string, boolean>,
      smartScopes: nextSmartScopes as Record<string, boolean>,
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
