import { ref } from 'vue'
import { getAccessToken } from '@/lib/api'
import type { StagingFile } from '@projectx/types'

export const SUPPORTED_FORMATS = ['epub', 'pdf', 'mobi', 'azw3', 'cbz', 'cbr', 'cb7', 'fb2']
export const SUPPORTED_FORMATS_ACCEPT = SUPPORTED_FORMATS.map((f) => `.${f}`).join(',')
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024

export type FileUploadStatus = 'pending' | 'uploading' | 'done' | 'error'

export interface UploadItem {
  id: string
  file: File
  status: FileUploadStatus
  progress: number
  error?: string
  stagingFile?: StagingFile
}

const CONCURRENCY = 3

function validateFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!SUPPORTED_FORMATS.includes(ext)) return `Unsupported type .${ext}`
  if (file.size > MAX_UPLOAD_BYTES) return 'File exceeds 500 MB limit'
  return null
}

function uploadSingle(item: UploadItem): Promise<void> {
  return new Promise((resolve) => {
    const formData = new FormData()
    formData.append('file', item.file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/v1/staging/upload')

    const token = getAccessToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) item.progress = Math.round((e.loaded / e.total) * 100)
    }

    xhr.onload = () => {
      if (xhr.status === 201) {
        item.status = 'done'
        item.progress = 100
        try {
          item.stagingFile = JSON.parse(xhr.responseText) as StagingFile
        } catch {
          // response parsing optional
        }
      } else {
        item.status = 'error'
        try {
          item.error = (JSON.parse(xhr.responseText) as { message?: string }).message ?? 'Upload failed'
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

const files = ref<UploadItem[]>([])
const isUploading = ref(false)

export function useStagingUpload() {
  function addFiles(fileList: FileList | File[]) {
    for (const file of fileList) {
      const error = validateFile(file)
      const item: UploadItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        status: error ? 'error' : 'pending',
        progress: 0,
        error: error ?? undefined,
      }
      files.value.push(item)
    }
    processQueue()
  }

  function processQueue() {
    if (isUploading.value) return
    isUploading.value = true
    void drainQueue()
  }

  async function drainQueue() {
    while (true) {
      const pending = files.value.filter((f) => f.status === 'pending').slice(0, CONCURRENCY)
      if (pending.length === 0) break
      await Promise.all(pending.map(uploadSingle))
    }
    isUploading.value = false
  }

  function clearCompleted() {
    files.value = files.value.filter((f) => f.status !== 'done')
  }

  function clearAll() {
    files.value = []
  }

  return { files, isUploading, addFiles, clearCompleted, clearAll }
}
