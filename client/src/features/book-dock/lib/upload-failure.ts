import { UploadErrorCode } from '@bookorbit/types'

import { formatBytes } from '@/lib/formatting'

export type BookDockUploadFailure =
  | { kind: 'unsupported'; extension: string }
  | { kind: 'tooLarge'; limitBytes: number }
  | {
      kind: 'server'
      status: number
      errorCode: string | null
      message: string | null
      /** False when the error page came from something in front of BookOrbit, such as a reverse proxy. */
      fromBookOrbit: boolean
    }
  | { kind: 'network' }

/** A translation key, or server-authored text shown as-is when no translated reason fits. */
export type UploadFailureReason = { key: string; params?: Record<string, string> } | { text: string }

const REASON_KEY_BY_ERROR_CODE: Partial<Record<string, string>> = {
  [UploadErrorCode.TooLarge]: 'bookDock.uploadFailures.reason.tooLargeServer',
  [UploadErrorCode.StorageFull]: 'bookDock.uploadFailures.reason.storageFull',
}

const RETRYABLE_STATUSES = new Set([401, 408, 429])

/** A retry can only help when the failure was transient; a rejected file fails the same way again. */
export function isRetryableUploadFailure(failure: BookDockUploadFailure): boolean {
  if (failure.kind === 'network') return true
  if (failure.kind !== 'server') return false
  return failure.status >= 500 || RETRYABLE_STATUSES.has(failure.status)
}

export function describeUploadFailure(failure: BookDockUploadFailure): UploadFailureReason {
  switch (failure.kind) {
    case 'unsupported':
      return failure.extension
        ? { key: 'bookDock.uploadFailures.reason.unsupported', params: { extension: failure.extension } }
        : { key: 'bookDock.uploadFailures.reason.noExtension' }
    case 'tooLarge':
      return { key: 'bookDock.uploadFailures.reason.tooLarge', params: { limit: formatBytes(failure.limitBytes) } }
    case 'network':
      return { key: 'bookDock.uploadFailures.reason.network' }
    case 'server': {
      const key = failure.errorCode ? REASON_KEY_BY_ERROR_CODE[failure.errorCode] : undefined
      if (key) return { key }
      if (failure.status === 413) {
        return { key: failure.fromBookOrbit ? 'bookDock.uploadFailures.reason.tooLargeServer' : 'bookDock.uploadFailures.reason.tooLargeProxy' }
      }
      if (failure.message) return { text: failure.message }
      return { key: 'bookDock.uploadFailures.reason.status', params: { status: String(failure.status) } }
    }
  }
}
