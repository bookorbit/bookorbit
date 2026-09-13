import { computed, ref } from 'vue'
import type { MetadataScoreDistribution } from '@bookorbit/types'
import { api } from '@/lib/api'

/**
 * The saved-state reference for the threshold rail: where books actually land today, from the
 * statistics endpoint that already ships. It is scoped to the caller's accessible libraries, so a
 * non-superuser sees their own slice rather than the whole server.
 */
export function useScoreDistribution() {
  const distribution = ref<MetadataScoreDistribution | null>(null)
  const loading = ref(false)

  const total = computed(() => distribution.value?.totalCount ?? 0)
  const hasData = computed(() => total.value > 0)
  const median = computed(() => distribution.value?.percentile50 ?? null)

  const maxBinCount = computed(() => distribution.value?.bins.reduce((max, bin) => Math.max(max, bin.count), 0) ?? 0)

  /** Books whose score sits below the first badge threshold, the number worth reacting to. */
  const belowFifty = computed(() => {
    const bins = distribution.value?.bins
    if (!bins) return 0
    return bins.filter((bin) => bin.minScore < 50).reduce((sum, bin) => sum + bin.count, 0)
  })

  const ninetyPlus = computed(() => {
    const bins = distribution.value?.bins
    if (!bins) return 0
    return bins.filter((bin) => bin.minScore >= 90).reduce((sum, bin) => sum + bin.count, 0)
  })

  async function load() {
    loading.value = true
    try {
      const res = await api('/api/v1/statistics/metadata-score-distribution')
      if (!res.ok) return
      distribution.value = (await res.json()) as MetadataScoreDistribution
    } catch {
      // The rail is a reference, not the point of the page: a failure leaves it out silently.
    } finally {
      loading.value = false
    }
  }

  return { distribution, loading, total, hasData, median, maxBinCount, belowFifty, ninetyPlus, load }
}
