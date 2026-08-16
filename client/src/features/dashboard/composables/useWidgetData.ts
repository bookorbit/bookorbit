import { getCurrentScope, onMounted, onScopeDispose, ref, type Ref } from 'vue'

import { onAuthRecovered } from '@/lib/api'

export interface WidgetData<T> {
  data: Ref<T | null>
  loading: Ref<boolean>
  error: Ref<boolean>
  refresh: () => Promise<void>
}

/**
 * Backoff for a widget whose request did not come back. A dashboard load is a burst of requests
 * competing for the handful of connections a browser opens per origin, so the common failure is a
 * request lost in traffic rather than a server that is actually down. Widgets fail and retry in
 * step, which the batching layer folds back into a single request per round.
 */
export const WIDGET_RETRY_DELAYS_MS = [500, 1500, 4000]

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Loads one dashboard widget, retries a request that did not come back, and reloads it if the
 * session returns.
 *
 * Fetching on mount and stopping there is what turned a few seconds of expired token into a
 * dashboard of "Failed to load" tiles that only a page reload could clear: the widgets have no
 * polling, and most have no retry control either.
 */
export function useWidgetData<T>(fetcher: () => Promise<T>): WidgetData<T> {
  const data = ref<T | null>(null) as Ref<T | null>
  const loading = ref(true)
  const error = ref(false)

  let generation = 0
  let disposed = false

  async function load(): Promise<void> {
    const current = ++generation
    const isStale = () => disposed || current !== generation

    loading.value = true
    error.value = false

    for (let attempt = 0; !isStale(); attempt++) {
      try {
        const result = await fetcher()
        if (isStale()) return
        data.value = result
        break
      } catch {
        if (isStale()) return
        const retryDelay = WIDGET_RETRY_DELAYS_MS[attempt]
        if (retryDelay === undefined) {
          error.value = true
          break
        }
        await delay(retryDelay)
      }
    }

    if (!isStale()) loading.value = false
  }

  onMounted(load)

  const stopListening = onAuthRecovered(() => {
    if (error.value) void load()
  })
  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true
      stopListening()
    })
  }

  return { data, loading, error, refresh: load }
}
