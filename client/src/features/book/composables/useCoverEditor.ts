import { onUnmounted, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CoverMedium } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useCoverVersions } from './useCoverVersions'
import { toDisplayCoverUrl } from '../lib/metadata-fetch'

/**
 * One cover slot's pending image and writes. A book with both media gets one instance per slot;
 * `medium` is null only for a book with no content files, whose writes the server routes itself.
 */
export function useCoverEditor(bookId: Ref<number>, medium: CoverMedium | null = null) {
  const uploading = ref(false)
  const regenerating = ref(false)
  const error = ref<string | null>(null)
  const previewSrc = ref<string | null>(null)
  const pendingFile = ref<File | null>(null)
  const pendingUrl = ref<string | null>(null)

  const { t } = useI18n()
  const { bumpVersion } = useCoverVersions()

  function route(path: string): string {
    const base = `/api/v1/books/${bookId.value}/${path}`
    return medium ? `${base}?medium=${medium}` : base
  }

  function selectFile(file: File) {
    clearPending()
    pendingFile.value = file
    previewSrc.value = URL.createObjectURL(file)
  }

  function setUrl(url: string) {
    if (previewSrc.value?.startsWith('blob:')) URL.revokeObjectURL(previewSrc.value)
    const normalizedUrl = url.trim()
    pendingFile.value = null
    pendingUrl.value = normalizedUrl || null
    previewSrc.value = normalizedUrl ? toDisplayCoverUrl(normalizedUrl) : null
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
        const res = await api(route('cover'), { method: 'POST', body: form })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      } else {
        const res = await api(route('cover/from-url'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: pendingUrl.value }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
      }
      bumpVersion(bookId.value)
      clearPending()
      return true
    } catch {
      error.value = t('book.detail.coverEditor.saveFailed')
      return false
    } finally {
      uploading.value = false
    }
  }

  async function revert(): Promise<'extracted' | null | false> {
    uploading.value = true
    error.value = null
    try {
      const res = await api(route('cover'), { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      bumpVersion(bookId.value)
      return data.coverSource as 'extracted' | null
    } catch {
      error.value = t('book.detail.coverEditor.revertFailed')
      return false
    } finally {
      uploading.value = false
    }
  }

  async function regenerate(): Promise<boolean> {
    regenerating.value = true
    error.value = null
    try {
      const res = await api(route('re-extract-cover'), { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      bumpVersion(bookId.value)
      return true
    } catch {
      error.value = t('book.coverRegeneration.failed')
      return false
    } finally {
      regenerating.value = false
    }
  }

  onUnmounted(() => {
    if (previewSrc.value?.startsWith('blob:')) URL.revokeObjectURL(previewSrc.value)
  })

  return { uploading, regenerating, error, previewSrc, pendingFile, pendingUrl, selectFile, setUrl, clearPending, confirm, revert, regenerate }
}
