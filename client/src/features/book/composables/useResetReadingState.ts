import { ref, type Ref } from 'vue'
import type { ResetBookReadingStateResponse } from '@bookorbit/types'
import { api } from '@/lib/api'

async function getErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] }
    if (Array.isArray(body.message)) return body.message.join(', ')
    if (body.message) return body.message
  } catch {
    // Use the generic fallback when the response has no JSON error body.
  }
  return 'Failed to reset reading state'
}

export function useResetReadingState(bookId: Ref<number>) {
  const open = ref(false)
  const resetting = ref(false)
  const error = ref<string | null>(null)

  function openDialog() {
    error.value = null
    open.value = true
  }

  function closeDialog() {
    if (resetting.value) return
    open.value = false
    error.value = null
  }

  async function resetReadingState(): Promise<ResetBookReadingStateResponse | null> {
    if (resetting.value) return null
    resetting.value = true
    error.value = null

    try {
      const response = await api(`/api/v1/books/${bookId.value}/reset-reading-state`, { method: 'POST' })
      if (!response.ok) {
        error.value = await getErrorMessage(response)
        return null
      }

      const result = (await response.json()) as ResetBookReadingStateResponse
      open.value = false
      return result
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : 'Failed to reset reading state'
      return null
    } finally {
      resetting.value = false
    }
  }

  return { open, resetting, error, openDialog, closeDialog, resetReadingState }
}
