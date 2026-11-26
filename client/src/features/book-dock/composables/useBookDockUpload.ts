import { computed, ref } from 'vue'
import { getValidToken } from '@/lib/api'
import { cancelUploadSession, needsUploadSession, parseUploadFailure, uploadWithSession } from '@/lib/upload-session'
import { createUuid } from '@/lib/uuid'
import { UPLOAD_SUPPORTED_FORMATS, type BookDockFile, type BookDockUploadTarget } from '@bookorbit/types'

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
  /** The library dock it goes into; absent for Unsorted. */
  libraryId?: number
  /** Kept across retries, so a retried large file carries on from the bytes the server already has. */
  resumeKey: string
  /** A large file's unfinished session, cancelled when the failure is dismissed. */
  uploadSessionId?: string
}

const CONCURRENCY = 3

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

function validateFile(file: File, target: BookDockUploadTarget | null): BookDockUploadFailure | null {
  const extension = fileExtension(file.name)
  if (!SUPPORTED_FORMATS.includes(extension)) return { kind: 'unsupported', extension }
  if (target?.allowedFormats.length && !target.allowedFormats.includes(extension)) {
    return { kind: 'notAllowed', extension, library: target.libraryName }
  }
  const { maxUploadSizeMb } = useAppInfo()
  const limitBytes = maxUploadSizeMb.value * 1024 * 1024
  if (file.size > limitBytes) return { kind: 'tooLarge', limitBytes }
  return null
}

function fail(item: UploadItem, failure: BookDockUploadFailure) {
  item.status = 'error'
  item.failure = failure
}

async function uploadSingle(item: UploadItem): Promise<void> {
  item.status = 'uploading'
  item.progress = 0
  if (needsUploadSession(item.file)) return uploadInSession(item)

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
      xhr.open('POST', item.libraryId === undefined ? '/api/v1/book-dock/upload' : `/api/v1/book-dock/upload?libraryId=${item.libraryId}`)
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
          fail(item, parseUploadFailure(xhr.status, xhr.responseText))
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

async function uploadInSession(item: UploadItem): Promise<void> {
  const outcome = await uploadWithSession({
    file: item.file,
    target: item.libraryId === undefined ? { kind: 'book_dock' } : { kind: 'book_dock', libraryId: item.libraryId },
    resumeKey: item.resumeKey,
    onProgress: (fraction) => {
      item.progress = Math.round(fraction * 100)
    },
  })
  if (outcome.ok) {
    item.status = 'done'
    item.progress = 100
    item.uploadSessionId = undefined
    return
  }
  item.uploadSessionId = outcome.sessionId ?? undefined
  fail(item, outcome.failure)
}

function releaseSessions(items: UploadItem[]) {
  for (const item of items) {
    if (item.status === 'error' && item.uploadSessionId) cancelUploadSession(item.uploadSessionId)
  }
}

const files = ref<UploadItem[]>([])
const isUploading = ref(false)
const failures = computed(() => files.value.filter((f) => f.status === 'error'))

export function useBookDockUpload() {
  /** Queues files for Unsorted, or for one library's dock when `target` is given. */
  function addFiles(fileList: FileList | File[], target: BookDockUploadTarget | null = null) {
    for (const file of fileList) {
      const failure = validateFile(file, target)
      const item: UploadItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        status: failure ? 'error' : 'pending',
        progress: 0,
        failure: failure ?? undefined,
        resumeKey: createUuid(),
        ...(target ? { libraryId: target.libraryId } : {}),
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
    releaseSessions(files.value.filter((f) => f.id === id))
    files.value = files.value.filter((f) => f.id !== id || f.status !== 'error')
  }

  function dismissAllFailures() {
    releaseSessions(files.value)
    files.value = files.value.filter((f) => f.status !== 'error')
  }

  function clearAll() {
    releaseSessions(files.value)
    files.value = []
  }

  return { files, failures, isUploading, addFiles, retryFailure, dismissFailure, dismissAllFailures, clearAll }
}
