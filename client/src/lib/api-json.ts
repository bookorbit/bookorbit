import { i18n } from '@/i18n'
import { api, NetworkError } from './api'

/**
 * A failed response carries a stable `errorCode` next to an English `message`. Client copy is
 * keyed off the code so it translates; the server's own text is kept for logging and for codes no
 * catalog entry covers yet, but it is never what the user reads.
 */
interface ApiErrorBody {
  errorCode?: unknown
  message?: unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly errorCode: string | null
  /** The server's untranslated text. Useful in a log line, never in the interface. */
  readonly serverMessage: string | null

  constructor(message: string, status: number, errorCode: string | null, serverMessage: string | null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.errorCode = errorCode
    this.serverMessage = serverMessage
  }
}

/** Reads a failed response into a localized `ApiError`. Tolerates a missing or malformed body. */
export async function apiError(response: Response, fallbackKey: string): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as ApiErrorBody | null
  const errorCode = typeof body?.errorCode === 'string' ? body.errorCode : null
  const serverMessage = typeof body?.message === 'string' && body.message.trim() ? body.message : null
  return new ApiError(translateErrorCode(errorCode) ?? i18n.global.t(fallbackKey), response.status, errorCode, serverMessage)
}

function translateErrorCode(errorCode: string | null): string | null {
  if (!errorCode) return null
  const key = `errors.codes.${errorCode}`
  return i18n.global.te(key) ? i18n.global.t(key) : null
}

/**
 * The text to show when an operation fails. A failed request only speaks for itself when the server
 * named a code the catalog covers; otherwise the caller's own wording names the action that failed,
 * which reads better than a generic message from whichever shared composable made the request.
 * Deliberate `Error`s thrown by client-side validation already carry translated text of their own,
 * but a network `TypeError` does not, so it falls back rather than surfacing the browser's wording.
 */
export function errorMessage(reason: unknown, fallbackKey: string): string {
  if (reason instanceof ApiError) return reason.errorCode ? reason.message : i18n.global.t(fallbackKey)
  // An unreachable server says nothing about which action failed, so the caller's wording is better.
  if (reason instanceof NetworkError) return i18n.global.t(fallbackKey)
  return reason instanceof Error && reason.message ? reason.message : i18n.global.t(fallbackKey)
}

/** Requests JSON, throwing a localized `ApiError` for any non-2xx answer. */
export async function apiJson<T>(input: RequestInfo | URL, init: RequestInit | undefined, fallbackKey: string): Promise<T> {
  const response = await api(input, init)
  if (!response.ok) throw await apiError(response, fallbackKey)
  return (await response.json()) as T
}

/** For endpoints that answer 204, or whose body the caller does not need. */
export async function apiSend(input: RequestInfo | URL, init: RequestInit | undefined, fallbackKey: string): Promise<void> {
  const response = await api(input, init)
  if (!response.ok) throw await apiError(response, fallbackKey)
}

/** The `method` plus JSON `Content-Type` plus `JSON.stringify` dance every mutation repeats. */
export function jsonBody(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', payload: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
}
