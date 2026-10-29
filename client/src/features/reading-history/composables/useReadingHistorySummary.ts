import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { ReadingHistorySummary } from '@bookorbit/types'
import { fetchReadingHistorySummary, type ReadingHistoryPeriodParams } from '../api/reading-history.api'

/** The period's numbers for the rail. Keeps the last answer on screen while the next one loads. */
export function useReadingHistorySummary(period: MaybeRefOrGetter<ReadingHistoryPeriodParams>) {
  const summary = ref<ReadingHistorySummary | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let controller: AbortController | null = null
  let current: ReadingHistoryPeriodParams | null = null

  async function load(next: ReadingHistoryPeriodParams) {
    controller?.abort()
    const own = new AbortController()
    controller = own
    current = next
    loading.value = true
    error.value = null
    try {
      summary.value = await fetchReadingHistorySummary(next, own.signal)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      error.value = err instanceof Error ? err.message : String(err)
    } finally {
      if (controller === own) loading.value = false
    }
  }

  function refresh() {
    if (current) void load(current)
  }

  watch(
    () => JSON.stringify(toValue(period)),
    () => void load(toValue(period)),
    { immediate: true },
  )
  onScopeDispose(() => controller?.abort())

  return { summary, loading, error, refresh }
}
