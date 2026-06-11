import { ref } from 'vue'
import { api } from '@/lib/api'
import type { AnnotationPositionFormat, AnnotationSyncDetail } from '@bookorbit/types'

export function useAnnotationSyncDetail() {
  const detail = ref<AnnotationSyncDetail | null>(null)
  const loading = ref(false)
  const retrying = ref<AnnotationPositionFormat | null>(null)
  const error = ref<string | null>(null)

  async function load(annotationId: number): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/annotations/${annotationId}/sync-detail`)
      if (!res.ok) throw new Error('Failed to load sync detail')
      detail.value = (await res.json()) as AnnotationSyncDetail
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load sync detail'
    } finally {
      loading.value = false
    }
  }

  async function retry(annotationId: number, format: AnnotationPositionFormat): Promise<void> {
    retrying.value = format
    error.value = null
    try {
      const res = await api(`/api/v1/annotations/${annotationId}/positions/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format }),
      })
      if (!res.ok) throw new Error('Failed to retry position conversion')
      detail.value = (await res.json()) as AnnotationSyncDetail
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to retry position conversion'
    } finally {
      retrying.value = null
    }
  }

  return { detail, loading, retrying, error, load, retry }
}
