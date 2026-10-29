import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import { api } from '@/lib/api'

export interface LibraryJobOptions {
  path: (libraryId: number) => string
  /** Server error codes mapped to the last segment of a translation key under `errorPrefix`. */
  errorKeys: Record<string, string>
  errorPrefix: string
}

/** Starts a library's background job and polls it until it settles; one job per library. */
export function useLibraryJob<T extends { status: string }>(libraryId: Ref<number | null>, options: LibraryJobOptions) {
  const job = ref<T | null>(null) as Ref<T | null>
  const starting = ref(false)
  const errorKey = ref<string | null>(null)
  const running = computed(() => starting.value || job.value?.status === 'running')
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let generation = 0
  let disposed = false

  function cancelRequest() {
    clearTimeout(timer)
    controller?.abort()
    generation++
  }

  async function request(method: 'GET' | 'POST') {
    cancelRequest()
    const id = libraryId.value
    if (id === null || disposed) return
    const current = generation
    const currentController = new AbortController()
    controller = currentController
    const signal = currentController.signal
    const timeout = setTimeout(() => currentController.abort(), 10_000)
    starting.value = method === 'POST'
    errorKey.value = null
    try {
      const response = await api(options.path(id), { method, signal })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { errorCode?: string }
        if (current === generation) errorKey.value = options.errorPrefix + (options.errorKeys[body.errorCode ?? ''] ?? 'requestFailed')
        return
      }
      const result = (await response.json()) as T | null
      if (current !== generation) return
      if (!result && job.value?.status === 'running') errorKey.value = options.errorPrefix + 'interrupted'
      job.value = result
    } catch {
      if (current === generation) errorKey.value = options.errorPrefix + 'requestFailed'
    } finally {
      clearTimeout(timeout)
      if (current === generation && !disposed) {
        starting.value = false
        if (job.value?.status === 'running') timer = setTimeout(refresh, errorKey.value ? 5000 : 1000)
      }
    }
  }

  function refresh() {
    return request('GET')
  }
  function start() {
    if (running.value) return Promise.resolve()
    return request('POST')
  }

  watch(
    libraryId,
    () => {
      job.value = null
      void refresh()
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    disposed = true
    cancelRequest()
  })

  return { job, running, errorKey, start, refresh }
}
