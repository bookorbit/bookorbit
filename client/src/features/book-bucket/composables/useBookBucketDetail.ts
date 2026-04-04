import { ref } from 'vue'
import { api } from '@/lib/api'
import type { BookBucketFile, BookBucketMetadata } from '@projectx/types'

export function useBookBucketDetail() {
  const file = ref<BookBucketFile | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const saved = ref(false)
  const saveError = ref<string | null>(null)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  async function loadFile(id: number) {
    loading.value = true
    try {
      const res = await api(`/api/v1/book-bucket/files/${id}`)
      if (res.ok) file.value = await res.json()
    } finally {
      loading.value = false
    }
  }

  async function saveMetadata(id: number, metadata: Partial<BookBucketMetadata>): Promise<BookBucketFile | null> {
    saving.value = true
    try {
      const res = await api(`/api/v1/book-bucket/files/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedMetadata: metadata }),
      })
      if (res.ok) {
        const updated: BookBucketFile = await res.json()
        file.value = updated
        saveError.value = null
        saved.value = true
        setTimeout(() => (saved.value = false), 1500)
        return updated
      }
      try {
        const err = await res.json()
        saveError.value = Array.isArray(err?.message) ? err.message.join(', ') : (err?.message ?? 'Failed to save changes')
      } catch {
        saveError.value = 'Failed to save changes'
      }
      return null
    } finally {
      saving.value = false
    }
  }

  function debouncedSave(id: number, metadata: Partial<BookBucketMetadata>) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => saveMetadata(id, metadata), 1000)
  }

  async function setTarget(id: number, libraryId: number | null, folderId: number | null): Promise<BookBucketFile | null> {
    const res = await api(`/api/v1/book-bucket/files/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetLibraryId: libraryId, targetFolderId: folderId }),
    })
    if (res.ok) {
      const updated: BookBucketFile = await res.json()
      file.value = updated
      return updated
    }
    return null
  }

  async function discardFile(id: number) {
    await api(`/api/v1/book-bucket/files/${id}`, { method: 'DELETE' })
    file.value = null
  }

  function coverUrl(id: number): string {
    return `/api/v1/book-bucket/files/${id}/cover`
  }

  return { file, loading, saving, saved, saveError, loadFile, saveMetadata, debouncedSave, setTarget, discardFile, coverUrl }
}
