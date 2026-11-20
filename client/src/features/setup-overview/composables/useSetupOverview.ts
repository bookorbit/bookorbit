import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { SetupOverview } from '@bookorbit/types'

import { getSetupOverview } from '../api/setupOverview.api'

/**
 * One fetch when the page opens.
 *
 * Nothing here polls: the page describes configuration, which changes when someone changes it, and
 * a socket for a page nobody keeps open would cost more than it is worth.
 */
export function useSetupOverview() {
  const overview = shallowRef<SetupOverview | null>(null)
  const loading = ref(true)
  const failed = ref(false)
  let controller: AbortController | null = null

  async function load(): Promise<void> {
    controller?.abort()
    const own = new AbortController()
    controller = own
    loading.value = true
    failed.value = false
    try {
      const result = await getSetupOverview(own.signal)
      if (controller === own) overview.value = result
    } catch {
      if (own.signal.aborted) return
      failed.value = true
    } finally {
      // A load that a newer one replaced leaves the state to the newer one.
      if (controller === own) loading.value = false
    }
  }

  onMounted(load)
  onBeforeUnmount(() => controller?.abort())

  return { overview, loading, failed, reload: load }
}
