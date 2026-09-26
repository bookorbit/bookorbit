import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { AddedAtRecomputeJob } from '@bookorbit/types'
import { api } from '@/lib/api'

const ERROR_KEYS: Record<string, string> = {
  ADDED_AT_SOURCE_IMPORTED: 'sourceImported',
  ADDED_AT_ALREADY_RUNNING: 'alreadyRunning',
  ADDED_AT_BUSY: 'busy',
}
const ERROR_PREFIX = 'library.creator.scanner.addedAt.errors.'

export function useLibraryAddedAt(libraryId: Ref<number | null>) {
  const job = ref<AddedAtRecomputeJob | null>(null)
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
      const response = await api(`/api/v1/libraries/${id}/recompute-added-at`, { method, signal })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { errorCode?: string }
        if (current === generation) errorKey.value = ERROR_PREFIX + (ERROR_KEYS[body.errorCode ?? ''] ?? 'requestFailed')
        return
      }
      const result = (await response.json()) as AddedAtRecomputeJob | null
      if (current !== generation) return
      if (!result && job.value?.status === 'running') errorKey.value = ERROR_PREFIX + 'interrupted'
      job.value = result
    } catch {
      if (current === generation) errorKey.value = ERROR_PREFIX + 'requestFailed'
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
