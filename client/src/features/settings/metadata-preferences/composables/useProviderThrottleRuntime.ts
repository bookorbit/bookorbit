import { ref } from 'vue'
import type { MetadataProviderKey, ProviderThrottleRuntimeSnapshot, ProviderThrottleRuntimeState } from '@projectx/types'
import { api } from '@/lib/api'

export function useProviderThrottleRuntime() {
  const snapshot = ref<ProviderThrottleRuntimeSnapshot | null>(null)
  const runtimeByKey = ref<Partial<Record<MetadataProviderKey, ProviderThrottleRuntimeState>>>({})
  const loading = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<void> | null = null

  function applySnapshot(next: ProviderThrottleRuntimeSnapshot) {
    snapshot.value = next
    runtimeByKey.value = Object.fromEntries(next.providers.map((p) => [p.key, p])) as Partial<
      Record<MetadataProviderKey, ProviderThrottleRuntimeState>
    >
  }

  async function fetchRuntime() {
    if (inFlight) return inFlight
    inFlight = (async () => {
      loading.value = snapshot.value === null
      try {
        const res = await api('/api/v1/metadata-fetch/providers/runtime')
        if (!res.ok) return
        const data = (await res.json()) as ProviderThrottleRuntimeSnapshot
        applySnapshot(data)
      } catch {
        // Best-effort runtime indicator; fail silently and retry on next poll.
      } finally {
        loading.value = false
        inFlight = null
      }
    })()

    return inFlight
  }

  function startPolling(intervalMs = 15_000) {
    stopPolling()
    void fetchRuntime()
    timer = setInterval(() => {
      void fetchRuntime()
    }, intervalMs)
  }

  function stopPolling() {
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  return {
    snapshot,
    runtimeByKey,
    loading,
    fetchRuntime,
    startPolling,
    stopPolling,
  }
}
