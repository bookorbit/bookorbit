import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import type { ReadAloudJobReport } from '@bookorbit/types'
import { api } from '@/lib/api'

/** The per-chapter report of a job awaiting review, fetched once per job. */
export function useReadAloudReport(jobId: Ref<string>) {
  const report = shallowRef<ReadAloudJobReport | null>(null)
  const failed = ref(false)
  const fetching = ref(false)
  const loading = computed(() => fetching.value && report.value === null)
  let controller: AbortController | null = null

  async function load(): Promise<void> {
    controller?.abort()
    const current = new AbortController()
    controller = current
    fetching.value = true
    failed.value = false
    try {
      const response = await api(`/api/v1/read-aloud-jobs/${encodeURIComponent(jobId.value)}/report`, { signal: current.signal })
      if (current.signal.aborted) return
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = (await response.json()) as ReadAloudJobReport
      if (current.signal.aborted) return
      report.value = body
    } catch {
      if (!current.signal.aborted) failed.value = true
    } finally {
      if (controller === current) {
        controller = null
        fetching.value = false
      }
    }
  }

  watch(
    jobId,
    () => {
      report.value = null
      void load()
    },
    { immediate: true },
  )

  onScopeDispose(() => {
    controller?.abort()
    controller = null
  })

  return { report, loading, failed, reload: load }
}
