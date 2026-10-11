import { ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { MetadataCacheClearRequest, MetadataCacheClearResponse, MetadataCacheStats } from '@bookorbit/types'
import { api } from '@/lib/api'

export const CACHE_CLEAR_SCOPES = ['all', 'book', 'author', 'empty'] as const
export type CacheClearScope = (typeof CACHE_CLEAR_SCOPES)[number]

const SCOPE_REQUESTS: Record<CacheClearScope, MetadataCacheClearRequest> = {
  all: {},
  book: { namespace: 'book' },
  author: { namespace: 'author' },
  empty: { emptyOnly: true },
}

export function cacheClearUrl(scope: CacheClearScope): string {
  const request = SCOPE_REQUESTS[scope]
  const query = new URLSearchParams()
  if (request.namespace) query.set('namespace', request.namespace)
  if (request.provider) query.set('provider', request.provider)
  if (request.emptyOnly) query.set('emptyOnly', 'true')
  const search = query.toString()
  return `/api/v1/metadata-cache${search ? `?${search}` : ''}`
}

/** Usage numbers for the metadata cache and the actions that empty it. */
export function useMetadataCacheMaintenance() {
  const { t } = useI18n()

  const stats = shallowRef<MetadataCacheStats | null>(null)
  const statsLoading = ref(false)
  const statsFailed = ref(false)
  const clearing = ref<CacheClearScope | null>(null)

  async function loadStats(): Promise<void> {
    statsLoading.value = true
    statsFailed.value = false
    try {
      const res = await api('/api/v1/metadata-cache/stats')
      if (!res.ok) {
        statsFailed.value = true
        return
      }
      stats.value = (await res.json()) as MetadataCacheStats
    } catch {
      statsFailed.value = true
    } finally {
      statsLoading.value = false
    }
  }

  async function clear(scope: CacheClearScope): Promise<MetadataCacheClearResponse | null> {
    if (clearing.value) return null
    clearing.value = scope
    try {
      const res = await api(cacheClearUrl(scope), { method: 'DELETE' })
      if (!res.ok) {
        toast.error(t('settings.metadata.searchCache.clear.failed'))
        return null
      }
      const result = (await res.json()) as MetadataCacheClearResponse
      toast.success(
        result.pending
          ? t('settings.metadata.searchCache.clear.donePending', { count: result.deleted })
          : t('settings.metadata.searchCache.clear.done', { count: result.deleted }),
      )
      void loadStats()
      return result
    } catch {
      toast.error(t('settings.metadata.searchCache.clear.failed'))
      return null
    } finally {
      clearing.value = null
    }
  }

  return { stats, statsLoading, statsFailed, clearing, loadStats, clear }
}
