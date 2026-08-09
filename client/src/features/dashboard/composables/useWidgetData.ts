import { getCurrentScope, onMounted, onScopeDispose, ref, type Ref } from 'vue'

import { onAuthRecovered } from '@/lib/api'

export interface WidgetData<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<boolean>
  refresh: () => Promise<void>
}

/**
 * Loads one dashboard widget, and reloads it if the session comes back.
 *
 * Fetching on mount and stopping there is what turned a few seconds of expired token into a
 * dashboard of "Failed to load" tiles that only a page reload could clear: the widgets have no
 * polling, and most have no retry control either. A widget that failed now retries itself once a
 * request has been rejected as unauthenticated and a later refresh has recovered the session.
 */
export function useWidgetData<T>(fetcher: () => Promise<T>): WidgetData<T> {
  const data = ref<T | null>(null) as Ref<T | null>
  const loading = ref(true)
  const error = ref(false)

  async function load(): Promise<void> {
    loading.value = true
    error.value = false
    try {
      data.value = await fetcher()
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)

  const stopListening = onAuthRecovered(() => {
    if (error.value) void load()
  })
  if (getCurrentScope()) onScopeDispose(stopListening)

  return { data, loading, error, refresh: load }
}
