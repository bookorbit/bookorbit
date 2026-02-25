import { computed, ref } from 'vue'
import { getAccessToken } from '@/lib/api'
import type { UploadResult } from '@projectx/types'

export const SUPPORTED_FORMATS = ['epub', 'pdf', 'mobi', 'azw3', 'cbz', 'cbr', 'cb7', 'fb2']
export const SUPPORTED_FORMATS_ACCEPT = SUPPORTED_FORMATS.map((f) => `.${f}`).join(',')
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024 // 500 MB

export type FileUploadStatus = 'pending' | 'uploading' | 'done' | 'error'

export interface FileUploadItem {
  id: string
  file: File
  status: FileUploadStatus
  progress: number
  error?: string
  bookId?: number
}

const UPLOAD_CONCURRENCY = 3

function validateFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!SUPPORTED_FORMATS.includes(ext)) {
    return `Unsupported type .${ext}. Allowed: ${SUPPORTED_FORMATS.join(', ')}`
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `File exceeds the 500 MB limit`
  }
  return null
}

function uploadSingle(item: FileUploadItem, url: string): Promise<void> {
  return new Promise((resolve) => {
    const formData = new FormData()
    formData.append('file', item.file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)

    const token = getAccessToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        item.progress = Math.round((e.loaded / e.total) * 100)
      }
    }

    xhr.onload = () => {
      if (xhr.status === 201) {
        const result: UploadResult = JSON.parse(xhr.responseText)
        item.status = 'done'
        item.progress = 100
        item.bookId = result.bookId
      } else {
        item.status = 'error'
        try {
          const body = JSON.parse(xhr.responseText)
          item.error = body.message ?? 'Upload failed'
        } catch {
          item.error = `Upload failed (${xhr.status})`
        }
      }
      resolve()
    }

    xhr.onerror = () => {
      item.status = 'error'
      item.error = 'Network error'
      resolve()
    }

    item.status = 'uploading'
    xhr.send(formData)
  })
}

export function useBookUpload() {
  const files = ref<FileUploadItem[]>([])

  const pendingCount = computed(() => files.value.filter((f) => f.status === 'pending').length)
  const isUploading = computed(() => files.value.some((f) => f.status === 'uploading'))
  const doneCount = computed(() => files.value.filter((f) => f.status === 'done').length)
  const errorCount = computed(() => files.value.filter((f) => f.status === 'error').length)
  const uploadedBookIds = computed(() => files.value.filter((f) => f.bookId !== undefined).map((f) => f.bookId!))

  function addFiles(incoming: File[]) {
    for (const file of incoming) {
      // Skip duplicates already in the queue
      if (files.value.some((f) => f.file.name === file.name && f.file.size === file.size)) continue

      const error = validateFile(file) ?? undefined
      files.value.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        status: error ? 'error' : 'pending',
        progress: 0,
        error,
      })
    }
  }

  function removeFile(id: string) {
    files.value = files.value.filter((f) => f.id !== id)
  }

  function reset() {
    files.value = []
  }

  async function startUpload(libraryId: number, folderId?: number) {
    const pending = files.value.filter((f) => f.status === 'pending')
    if (pending.length === 0) return

    const baseUrl = `/api/libraries/${libraryId}/upload`
    const url = folderId !== undefined ? `${baseUrl}?folderId=${folderId}` : baseUrl

    // Process pending items with a concurrency limit of UPLOAD_CONCURRENCY
    let index = 0
    async function runNext(): Promise<void> {
      const item = pending[index++]
      if (!item) return
      await uploadSingle(item, url)
      await runNext()
    }

    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, () => runNext())
    await Promise.all(workers)
  }

  return {
    files,
    pendingCount,
    isUploading,
    doneCount,
    errorCount,
    uploadedBookIds,
    addFiles,
    removeFile,
    reset,
    startUpload,
  }
}
