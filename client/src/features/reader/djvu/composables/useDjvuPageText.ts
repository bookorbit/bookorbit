import { onScopeDispose, ref, watch } from 'vue'
import type { DjvuPageTextResponse } from '@bookorbit/types'
import { api } from '@/lib/api'

export function useDjvuPageText(props: Readonly<{ open: boolean; fileId: number; pageIndex: number }>) {
  const text = ref('')
  const loading = ref(false)
  const failed = ref(false)
  let request: AbortController | null = null

  async function loadText() {
    request?.abort()
    if (!props.open) return
    text.value = ''
    failed.value = false
    const controller = new AbortController()
    request = controller
    loading.value = true
    try {
      const response = await api(`/api/v1/djvu/files/${props.fileId}/pages/${props.pageIndex}/text`, { signal: controller.signal })
      if (!response.ok) throw new Error('DjVu text request failed')
      const data = (await response.json()) as DjvuPageTextResponse
      if (typeof data.text !== 'string') throw new Error('Invalid DjVu text response')
      if (request === controller && !controller.signal.aborted) text.value = data.text
    } catch {
      if (request === controller && !controller.signal.aborted) failed.value = true
    } finally {
      if (request === controller) loading.value = false
    }
  }

  watch(() => [props.open, props.fileId, props.pageIndex], loadText, { immediate: true })
  onScopeDispose(() => request?.abort())

  return { text, loading, failed, loadText }
}
