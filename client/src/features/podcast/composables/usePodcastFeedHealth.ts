import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { PodcastFeedHealth } from '@bookorbit/types'
import { api } from '@/lib/api'
import { formatNumber } from '@/i18n/formatters'
import { runBoundedBatch } from '../lib/podcast-bulk'

const HEALTH_REFRESH_CONCURRENCY = 4

/**
 * The feed-health writes over a list the caller owns. The list stays with the lane that pages it
 * and receives the refresh events; this owns the writes and everything derived from the list to
 * drive them, so the panel never has to hand its own prop back in to run a bulk retry.
 */
export function usePodcastFeedHealth(items: Ref<PodcastFeedHealth[]>) {
  const { t } = useI18n()
  const refreshingPodcastId = ref<number | null>(null)
  const reparsingPodcastId = ref<number | null>(null)
  const refreshingUnhealthy = ref(false)

  const unhealthyPodcastIds = computed(() => items.value.filter((item) => item.consecutiveFailures > 0).map((item) => item.podcastId))
  const hasUnhealthyFeeds = computed(() => unhealthyPodcastIds.value.length > 0)

  async function refresh(podcastId: number) {
    refreshingPodcastId.value = podcastId
    try {
      const response = await api(`/api/v1/podcasts/${podcastId}/refresh`, { method: 'POST' })
      if (!response.ok) throw new Error(t('podcast.errors.refresh'))
      toast.success(t('podcast.messages.refreshQueued'))
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t('podcast.errors.refresh'))
    } finally {
      refreshingPodcastId.value = null
    }
  }

  async function reparse(podcastId: number) {
    reparsingPodcastId.value = podcastId
    try {
      const response = await api(`/api/v1/podcasts/${podcastId}/reparse`, { method: 'POST' })
      if (!response.ok) throw new Error(response.status === 404 ? t('podcast.errors.reparseNoSnapshot') : t('podcast.errors.reparse'))
      toast.success(t('podcast.messages.reparseQueued'))
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t('podcast.errors.reparse'))
    } finally {
      reparsingPodcastId.value = null
    }
  }

  async function refreshUnhealthy() {
    const ids = unhealthyPodcastIds.value
    if (!ids.length) return
    refreshingUnhealthy.value = true
    try {
      const outcome = await runBoundedBatch(ids, HEALTH_REFRESH_CONCURRENCY, async (podcastId) => {
        const response = await api(`/api/v1/podcasts/${podcastId}/refresh`, { method: 'POST' })
        if (!response.ok) throw new Error(t('podcast.errors.refresh'))
        return true
      })
      if (outcome.failed > 0) {
        toast.error(t('podcast.messages.bulkQueueActionFailed', { completed: formatNumber(outcome.completed), failed: formatNumber(outcome.failed) }))
      } else {
        toast.success(t('podcast.messages.feedsRefreshQueued', { count: formatNumber(outcome.completed) }))
      }
    } finally {
      refreshingUnhealthy.value = false
    }
  }

  return { refreshingPodcastId, reparsingPodcastId, refreshingUnhealthy, hasUnhealthyFeeds, refresh, reparse, refreshUnhealthy }
}
