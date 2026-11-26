import { computed, ref } from 'vue'
import { getValidToken } from '@/lib/api'
import { cancelUploadSession, needsUploadSession, uploadWithSession, type UploadFailure } from '@/lib/upload-session'
import { createUuid } from '@/lib/uuid'
import { UPLOAD_SUPPORTED_FORMATS, type AddBookFileResult } from '@bookorbit/types'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'

export const SUPPORTED_FORMATS: readonly string[] = UPLOAD_SUPPORTED_FORMATS
export const SUPPORTED_FORMATS_ACCEPT = SUPPORTED_FORMATS.map((f) => `.${f}`).join(',')
export const MAX_FILE_BYTES = 500 * 1024 * 1024

export type FileUploadStatus = 'pending' | 'uploading' | 'done' | 'error'

export interface BookFileUploadItem {
  id: string
  file: File
  status: FileUploadStatus
  progress: number
  error?: string
  result?: AddBookFileResult
  validationError?: boolean
  /** Kept across retries, so a retried large file carries on from the bytes the server already has. */
  resumeKey: string
  /** A large file's unfinished session, cancelled when the file is removed from the list. */
  uploadSessionId?: string
}

const UPLOAD_CONCURRENCY = 3

function validateFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!SUPPORTED_FORMATS.includes(ext)) {
    return `Unsupported type .${ext}. Allowed: ${SUPPORTED_FORMATS.join(', ')}`
  }
  const { maxUploadSizeMb } = useAppInfo()
  const limitBytes = maxUploadSizeMb.value * 1024 * 1024
  if (file.size > limitBytes) {
    return `File exceeds the ${maxUploadSizeMb.value} MB limit`
  }
  return null
}

function failureMessage(failure: UploadFailure): string {
  if (failure.kind === 'network') return 'Network error'
  return failure.message ?? `Upload failed (${failure.status})`
}

async function uploadInSession(item: BookFileUploadItem, bookId: number): Promise<void> {
  item.status = 'uploading'
  item.progress = 0
  const outcome = await uploadWithSession({
    file: item.file,
    target: { kind: 'existing_book', bookId },
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
  item.status = 'error'
  item.error = failureMessage(outcome.failure)
  item.uploadSessionId = outcome.sessionId ?? undefined
}

function releaseSessions(items: BookFileUploadItem[]) {
  for (const item of items) {
    if (item.status === 'error' && item.uploadSessionId) cancelUploadSession(item.uploadSessionId)
  }
}

async function uploadSingle(item: BookFileUploadItem, bookId: number): Promise<void> {
  if (needsUploadSession(item.file)) return uploadInSession(item, bookId)
  const token = await getValidToken()
  return new Promise((resolve) => {
    const formData = new FormData()
    formData.append('file', item.file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/v1/books/${bookId}/files`)

    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        item.progress = Math.round((e.loaded / e.total) * 100)
      }
    }

    xhr.onload = () => {
      if (xhr.status === 201) {
        item.status = 'done'
        item.progress = 100
        try {
          item.result = JSON.parse(xhr.responseText) as AddBookFileResult
        } catch {
          // result is optional — upload still counts as done
        }
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

async function triggerRename(bookId: number): Promise<void> {
  const token = await getValidToken()
  await fetch(`/api/v1/books/${bookId}/rename-files`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).catch(() => {
    // Best-effort — rename failure does not invalidate completed uploads
  })
}

export function useAddBookFile() {
  const files = ref<BookFileUploadItem[]>([])

  const pendingCount = computed(() => files.value.filter((f) => f.status === 'pending').length)
  const isUploading = computed(() => files.value.some((f) => f.status === 'uploading'))
  const doneCount = computed(() => files.value.filter((f) => f.status === 'done').length)
  const errorCount = computed(() => files.value.filter((f) => f.status === 'error').length)

  function addFiles(incoming: File[]) {
    for (const file of incoming) {
      if (files.value.some((f) => f.file.name === file.name && f.file.size === file.size)) continue

      const error = validateFile(file)
      files.value.push({
        id: `${file.name}-${file.size}-${file.lastModified}`,
        file,
        status: error ? 'error' : 'pending',
        progress: 0,
        error: error ?? undefined,
        validationError: error !== null,
        resumeKey: createUuid(),
      })
    }
  }

  function removeFile(id: string) {
    releaseSessions(files.value.filter((f) => f.id === id))
    files.value = files.value.filter((f) => f.id !== id)
  }

  function retryFile(id: string) {
    const item = files.value.find((f) => f.id === id)
    if (!item || item.status !== 'error' || item.validationError) return
    item.status = 'pending'
    item.error = undefined
    item.progress = 0
  }

  function reset() {
    releaseSessions(files.value)
    files.value = []
  }

  async function startUpload(bookId: number, options: { renameAfter?: boolean } = {}) {
    const pending = files.value.filter((f) => f.status === 'pending')
    if (pending.length === 0) return

    const renameAfter = options.renameAfter ?? false
    let index = 0
    async function runNext(): Promise<void> {
      const item = pending[index++]
      if (!item) return
      await uploadSingle(item, bookId)
      await runNext()
    }

    const workers = Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, () => runNext())
    await Promise.all(workers)

    if (renameAfter && doneCount.value > 0) {
      await triggerRename(bookId)
    }
  }

  return {
    files,
    pendingCount,
    isUploading,
    doneCount,
    errorCount,
    addFiles,
    removeFile,
    retryFile,
    reset,
    startUpload,
  }
}
