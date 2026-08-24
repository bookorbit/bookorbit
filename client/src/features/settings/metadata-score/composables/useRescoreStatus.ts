import { computed, onScopeDispose, ref } from 'vue'
import type { MetadataScoreRecalculationStatus } from '@bookorbit/types'
import { api } from '@/lib/api'

const POLL_INTERVAL_MS = 1500

/**
 * The server has always reported rescore progress on GET /metadata-score/recalculate/status and no
 * client has ever read it, so saving a weight change looked like nothing happened for minutes.
 */
export function useRescoreStatus() {
  const status = ref<MetadataScoreRecalculationStatus | null>(null)
  const starting = ref(false)
  let timer: ReturnType<typeof setTimeout> | null = null
  /** A run this session kicked off. Keeps a finished run from another admin off the page on load. */
  let watching = false

  const isRunning = computed(() => status.value?.state === 'running')
  const processed = computed(() => status.value?.processed ?? 0)
  const failed = computed(() => status.value?.failed ?? 0)
  const showProgress = computed(() => watching && (status.value?.state === 'running' || status.value?.state === 'failed'))

  function stopPolling() {
    if (timer) clearTimeout(timer)
    timer = null
  }

  async function fetchStatus(): Promise<MetadataScoreRecalculationStatus | null> {
    try {
      const res = await api('/api/v1/metadata-score/recalculate/status')
      if (!res.ok) return null
      const data: MetadataScoreRecalculationStatus = await res.json()
      status.value = data
      return data
    } catch {
      return null
    }
  }

  function scheduleNext() {
    stopPolling()
    timer = setTimeout(() => {
      void poll()
    }, POLL_INTERVAL_MS)
  }

  async function poll() {
    const data = await fetchStatus()
    // A dropped poll is not a finished run: keep watching rather than reporting a false completion.
    if (!data || data.state === 'running') {
      scheduleNext()
      return
    }
    stopPolling()
  }

  /** Call after a save, which starts a rescore server-side without a separate request. */
  function watch() {
    watching = true
    void poll()
  }

  async function startRescore(): Promise<boolean> {
    if (starting.value) return false
    starting.value = true
    try {
      const res = await api('/api/v1/metadata-score/recalculate', { method: 'POST' })
      if (!res.ok) return false
      watch()
      return true
    } catch {
      return false
    } finally {
      starting.value = false
    }
  }

  function dismiss() {
    watching = false
    stopPolling()
  }

  onScopeDispose(stopPolling)

  return { status, starting, isRunning, processed, failed, showProgress, startRescore, watch, dismiss }
}
