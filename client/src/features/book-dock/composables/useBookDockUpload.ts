import { computed, ref } from 'vue'
import { getValidToken } from '@/lib/api'
import { UPLOAD_SUPPORTED_FORMATS, type BookDockFile } from '@bookorbit/types'

import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { isRetryableUploadFailure, type BookDockUploadFailure } from '../lib/upload-failure'

export const SUPPORTED_FORMATS: readonly string[] = UPLOAD_SUPPORTED_FORMATS
export const SUPPORTED_FORMATS_ACCEPT = SUPPORTED_FORMATS.map((f) => `.${f}`).join(',')

export type FileUploadStatus = 'pending' | 'uploading' | 'done' | 'error'

export interface UploadItem {
  id: string
  file: File
  status: FileUploadStatus
  progress: number
  failure?: BookDockUploadFailure
  bookDockFile?: BookDockFile
}

const CONCURRENCY = 3

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function validateFile(file: File): BookDockUploadFailure | null {
  const extension = fileExtension(file.name)
  if (!SUPPORTED_FORMATS.includes(extension)) return { kind: 'unsupported', extension }
  const { maxUploadSizeMb } = useAppInfo()
  const limitBytes = maxUploadSizeMb.value * 1024 * 1024
  if (file.size > limitBytes) return { kind: 'tooLarge', limitBytes }
  return null
}

function responseFailure(xhr: XMLHttpRequest): BookDockUploadFailure {
  if (xhr.status === 0) return { kind: 'network' }
  let body: unknown = null
  try {
    body = JSON.parse(xhr.responseText)
  } catch {
    // A proxy's HTML error page carries no structured reason.
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  const rawMessage = Array.isArray(record?.message) ? record.message[0] : record?.message
  const message = typeof rawMessage === 'string' && rawMessage.trim() ? rawMessage.trim() : null
  return {
    kind: 'server',
    status: xhr.status,
    errorCode: typeof record?.errorCode === 'string' ? record.errorCode : null,
    message,
    fromBookOrbit: typeof record?.statusCode === 'number' && typeof record?.requestId === 'string',
  }
}

function fail(item: UploadItem, failure: BookDockUploadFailure) {
  item.status = 'error'
  item.failure = failure
}

async function uploadSingle(item: UploadItem): Promise<void> {
  item.status = 'uploading'
  item.progress = 0

  let token: string | null
  try {
    token = await getValidToken()
  } catch {
    fail(item, { kind: 'network' })
    return
  }

  await new Promise<void>((resolve) => {
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/v1/book-dock/upload')
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) item.progress = Math.round((e.loaded / e.total) * 100)
      }

      // loadend follows load, error, abort and timeout alike, so a request that ends any other way
      // than load cannot leave the queue waiting forever.
      xhr.onloadend = () => {
        if (xhr.status === 201) {
          item.status = 'done'
          item.progress = 100
          try {
            item.bookDockFile = JSON.parse(xhr.responseText) as BookDockFile
          } catch {
            // response parsing optional
          }
        } else {
          fail(item, responseFailure(xhr))
        }
        resolve()
      }

      const formData = new FormData()
      formData.append('file', item.file)
      xhr.send(formData)
    } catch {
      fail(item, { kind: 'network' })
      resolve()
    }
  })
}

const files = ref<UploadItem[]>([])
const isUploading = ref(false)
const failures = computed(() => files.value.filter((f) => f.status === 'error'))

export function useBookDockUpload() {
  function addFiles(fileList: FileList | File[]) {
    for (const file of fileList) {
      const failure = validateFile(file)
      const item: UploadItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        status: failure ? 'error' : 'pending',
        progress: 0,
        failure: failure ?? undefined,
      }
      files.value.push(item)
    }
    processQueue()
  }

  function processQueue() {
    if (isUploading.value) return
    if (!files.value.some((f) => f.status === 'pending')) return
    isUploading.value = true
    void drainQueue()
  }

  async function drainQueue() {
    try {
      while (true) {
        const pending = files.value.filter((f) => f.status === 'pending').slice(0, CONCURRENCY)
        if (pending.length === 0) break
        await Promise.all(pending.map(uploadSingle))
      }
    } finally {
      // Nothing reads a finished upload, and holding its File keeps it alive for the session.
      files.value = files.value.filter((f) => f.status !== 'done')
      isUploading.value = false
    }
  }

  function retryFailure(id: string) {
    const item = files.value.find((f) => f.id === id)
    if (!item || item.status !== 'error' || !item.failure || !isRetryableUploadFailure(item.failure)) return
    item.status = 'pending'
    item.failure = undefined
    item.progress = 0
    processQueue()
  }

  function dismissFailure(id: string) {
    files.value = files.value.filter((f) => f.id !== id || f.status !== 'error')
  }

  function dismissAllFailures() {
    files.value = files.value.filter((f) => f.status !== 'error')
  }

  function clearAll() {
    files.value = []
  }

  return { files, failures, isUploading, addFiles, retryFailure, dismissFailure, dismissAllFailures, clearAll }
}
