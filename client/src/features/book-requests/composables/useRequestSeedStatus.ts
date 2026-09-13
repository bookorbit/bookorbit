import { ref } from 'vue'
import { api } from '@/lib/api'
import { fulfilmentBase } from '../fulfilmentBase'
import type { BookRequestSeedStatus } from '@bookorbit/types'

/**
 * Read live from the download client when someone looks, rather than stored. A seed outlives its
 * import by weeks, so polling every finished download to keep a ratio fresh would be an
 * ever-growing number of client calls for a number nobody is reading.
 */
export function useRequestSeedStatus(canManage: () => boolean) {
  const basePath = () => fulfilmentBase(canManage())
  const status = ref<BookRequestSeedStatus | null>(null)
  const loading = ref(false)
  const failed = ref(false)
  /** Bumped per fetch, so stepping to the next request cannot be answered with the last one's. */
  let generation = 0

  async function fetchStatus(requestId: number): Promise<void> {
    const current = ++generation
    loading.value = true
    failed.value = false
    status.value = null
    try {
      const res = await api(`${basePath()}/${requestId}/seed`)
      if (current !== generation) return
      if (!res.ok) {
        failed.value = true
        return
      }
      const body = (await res.text()).trim()
      if (current !== generation) return
      status.value = body ? (JSON.parse(body) as BookRequestSeedStatus) : null
    } catch {
      if (current === generation) failed.value = true
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function reset(): void {
    generation++
    status.value = null
    failed.value = false
    loading.value = false
  }

  return { status, loading, failed, fetchStatus, reset }
}
