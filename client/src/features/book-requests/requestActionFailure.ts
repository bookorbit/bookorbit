import { bookRequestActionErrorCode, bookRequestSubmitErrorCode } from '@bookorbit/types'
import type { BookRequestFailureMeta } from '@bookorbit/types'

export interface RequestActionFailure {
  reason: string | null
  errorCode: unknown
  errorMeta?: BookRequestFailureMeta | null
}

export interface LocalizedRequestActionFailure {
  key: string
  params: BookRequestFailureMeta
}

/** App-authored refusals have stable copy; external tracker and client prose stays verbatim. */
export function localizedRequestActionFailure(failure: RequestActionFailure): LocalizedRequestActionFailure | null {
  const actionCode = bookRequestActionErrorCode(failure.errorCode)
  if (actionCode) return { key: `bookRequests.actionError.${actionCode}`, params: failure.errorMeta ?? {} }

  const submitCode = bookRequestSubmitErrorCode(failure.errorCode)
  if (submitCode) return { key: `bookRequests.submitError.${submitCode}`, params: failure.errorMeta ?? {} }

  return null
}
