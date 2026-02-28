import { onUnmounted, ref, type Ref } from 'vue'
import { api } from '@/lib/api'
import { useCoverVersions } from './useCoverVersions'

export function useCoverEditor(bookId: Ref<number>) {
  const uploading = ref(false)
  const error = ref<string | null>(null)
  const previewSrc = ref<string | null>(null)
  const pendingFile = ref<File | null>(null)
  const pendingUrl = ref<string | null>(null)

  const { bumpVersion } = useCoverVersions()

  function selectFile(file: File) {
    clearPending()
    pendingFile.value = file
    previewSrc.value = URL.createObjectURL(file)
  }

  function setUrl(url: string) {
    if (previewSrc.value?.startsWith('blob:')) URL.revokeObjectURL(previewSrc.value)
    pendingFile.value = null
    pendingUrl.value = url || null
    previewSrc.value = url || null
    error.value = null
  }

  function clearPending() {
    if (previewSrc.value?.startsWith('blob:')) URL.revokeObjectURL(previewSrc.value)
    previewSrc.value = null
    pendingFile.value = null
    pendingUrl.value = null
    error.value = null
  }

  async function confirm(): Promise<boolean> {
    if (!pendingFile.value && !pendingUrl.value) return false
    uploading.value = true
    error.value = null
    try {
      if (pendingFile.value) {
        const form = new FormData()
        form.append('file', pendingFile.value)
        const res = await api(`/api/v1/books/${bookId.value}/cover`, { method: 'POST', body: form })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } else {
        const res = await api(`/api/v1/books/${bookId.value}/cover/from-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: pendingUrl.value }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
      bumpVersion(bookId.value)
      clearPending()
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Upload failed'
      return false
    } finally {
      uploading.value = false
    }
  }

  async function revert(): Promise<'extracted' | null | false> {
    uploading.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/books/${bookId.value}/cover`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      bumpVersion(bookId.value)
      return data.coverSource as 'extracted' | null
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Revert failed'
      return false
    } finally {
      uploading.value = false
    }
  }

  onUnmounted(() => {
    if (previewSrc.value?.startsWith('blob:')) URL.revokeObjectURL(previewSrc.value)
  })

  return { uploading, error, previewSrc, pendingFile, pendingUrl, selectFile, setUrl, clearPending, confirm, revert }
}
