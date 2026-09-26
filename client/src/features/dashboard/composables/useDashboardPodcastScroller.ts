import { onMounted, ref } from 'vue'

import type { PodcastEpisodeListItem } from '@bookorbit/types'
import { api } from '@/lib/api'

const MAX_LIMIT = 50

/**
 * The dashboard's podcast shelf. Unlike the book scrollers this does not go through
 * `/dashboard/scrollers/:type`: podcast progress lives in the podcast module, which already exposes
 * a cross-library resume feed scoped to the libraries the user can reach.
 */
export function useDashboardPodcastScroller(limit = 20) {
  const episodes = ref<PodcastEpisodeListItem[]>([])
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      const size = Math.min(Math.max(1, Math.trunc(limit)), MAX_LIMIT)
      const res = await api(`/api/v1/podcast-episodes/continue?size=${size}`)
      if (!res.ok) throw new Error()
      episodes.value = await res.json()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
  return { episodes, loading, error, refresh: load }
}
