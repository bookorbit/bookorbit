import {
  UPLOAD_CHUNK_SIZE_BYTES,
  UploadErrorCode,
  type CreateUploadSessionRequest,
  type UploadSessionResponse,
  type UploadTarget,
} from '@bookorbit/types'

import { api, getValidToken, NetworkError } from '@/lib/api'

const SESSIONS_URL = '/api/v1/uploads'
/** The waits before each retry of a request that failed on the way. A chunk that lands resets them. */
const RETRY_DELAYS_MS = [1_000, 3_000, 10_000]
const SETTLE_POLL_MS = 1_500
const SETTLE_TIMEOUT_MS = 10 * 60_000

export type UploadFailure =
  | { kind: 'network' }
  | {
      kind: 'server'
      status: number
      errorCode: string | null
      message: string | null
      /** False when the error page came from something in front of BookOrbit, such as a reverse proxy. */
      fromBookOrbit: boolean
    }

export type SessionUploadOutcome =
  | { ok: true; session: UploadSessionResponse }
  /** `sessionId` names a session the server may still hold bytes for, so it can be cancelled. */
  | { ok: false; failure: UploadFailure; sessionId: string | null }

export interface SessionUploadOptions {
  file: File
  target: UploadTarget
  /** Kept across retries of one file, so a retry carries on from the bytes the server already holds. */
  resumeKey: string
  onProgress: (fraction: number) => void
}

class UploadStepError extends Error {
  constructor(readonly failure: UploadFailure) {
    super(failure.kind === 'network' ? 'network' : `status ${failure.status}`)
  }
}

/**
 * A file that fits in one chunk gains nothing from a session, so it keeps the single request. A
 * larger one goes in chunks, which is what gets it past a proxy that caps a request's size.
 */
export function needsUploadSession(file: File): boolean {
  return file.size > UPLOAD_CHUNK_SIZE_BYTES
}

export function parseUploadFailure(status: number, responseText: string): UploadFailure {
  if (status === 0) return { kind: 'network' }
  let body: unknown = null
  try {
    body = JSON.parse(responseText)
  } catch {
    // A proxy's HTML error page carries no structured reason.
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  const rawMessage = Array.isArray(record?.message) ? record.message[0] : record?.message
  const message = typeof rawMessage === 'string' && rawMessage.trim() ? rawMessage.trim() : null
  return {
    kind: 'server',
    status,
    errorCode: typeof record?.errorCode === 'string' ? record.errorCode : null,
    message,
    fromBookOrbit: typeof record?.statusCode === 'number' && typeof record?.requestId === 'string',
  }
}

/**
 * Sends a file as an upload session: created, filled chunk by chunk, then completed. A request that
 * fails on the way is retried, and a chunk the server already took is never sent twice.
 */
export async function uploadWithSession(options: SessionUploadOptions): Promise<SessionUploadOutcome> {
  let sessionId: string | null = null
  try {
    let session = await retrying(() => createSession(options))
    sessionId = session.id
    session = await sendChunks(session, options)
    const completed = await retrying(() => requestSession(`${SESSIONS_URL}/${session.id}/complete`, { method: 'POST' }))
    return { ok: true, session: await settle(completed) }
  } catch (error) {
    return { ok: false, failure: error instanceof UploadStepError ? error.failure : { kind: 'network' }, sessionId }
  }
}

/** Frees the bytes a session holds. Best effort: the server expires an abandoned session anyway. */
export function cancelUploadSession(sessionId: string): void {
  void api(`${SESSIONS_URL}/${sessionId}`, { method: 'DELETE' }).catch(() => undefined)
}

function createSession({ file, target, resumeKey }: SessionUploadOptions): Promise<UploadSessionResponse> {
  const body: CreateUploadSessionRequest = {
    filename: file.name,
    sizeBytes: file.size,
    // A different target is a different upload: the server refuses a key it already holds for another.
    idempotencyKey: `${resumeKey}.${targetKey(target)}`,
    target,
    ...(file.type ? { contentType: file.type } : {}),
  }
  return requestSession(SESSIONS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

function targetKey(target: UploadTarget): string {
  switch (target.kind) {
    case 'library':
      return target.folderId === undefined ? `l${target.libraryId}` : `l${target.libraryId}.f${target.folderId}`
    case 'existing_book':
      return `b${target.bookId}`
    case 'book_dock':
      return target.libraryId === undefined ? 'd' : `d${target.libraryId}`
  }
}

async function sendChunks(session: UploadSessionResponse, options: SessionUploadOptions): Promise<UploadSessionResponse> {
  let current = session
  let setbacks = 0
  while (current.status === 'receiving' && current.receivedBytes < current.sizeBytes) {
    try {
      current = await sendChunk(current, options)
      setbacks = 0
    } catch (error) {
      if (!(error instanceof UploadStepError)) throw error
      const offsetMoved = isOffsetMismatch(error.failure)
      if ((!offsetMoved && !isTransient(error.failure)) || setbacks >= RETRY_DELAYS_MS.length) throw error
      if (!offsetMoved) await delay(RETRY_DELAYS_MS[setbacks]!)
      setbacks++
      // The server may have kept the chunk even though its answer was lost, so ask where it stands.
      const sessionId = current.id
      current = await retrying(() => requestSession(`${SESSIONS_URL}/${sessionId}`))
    }
  }
  if (current.status !== 'receiving' && current.status !== 'processing' && current.status !== 'completed') {
    throw new UploadStepError(endedFailure(current))
  }
  return current
}

async function sendChunk(session: UploadSessionResponse, { file, onProgress }: SessionUploadOptions): Promise<UploadSessionResponse> {
  const start = session.receivedBytes
  const end = Math.min(start + session.chunkSizeBytes, session.sizeBytes)
  let token: string | null
  try {
    token = await getValidToken()
  } catch {
    throw new UploadStepError({ kind: 'network' })
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${SESSIONS_URL}/${session.id}/chunks`)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('Upload-Offset', String(start))

    xhr.upload.onprogress = (event) => {
      onProgress((start + Math.min(event.loaded, end - start)) / session.sizeBytes)
    }

    // loadend follows load, error, abort and timeout alike, so the promise always settles.
    xhr.onloadend = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadSessionResponse)
        } catch {
          reject(new UploadStepError(parseUploadFailure(xhr.status, xhr.responseText)))
        }
        return
      }
      reject(new UploadStepError(parseUploadFailure(xhr.status, xhr.responseText)))
    }

    const form = new FormData()
    form.append('chunk', file.slice(start, end), file.name)
    xhr.send(form)
  })
}

/**
 * A library upload is in place once it has its book, as with the single request: the import that
 * follows runs on the server. Anything else is waited for until the server says how it ended.
 */
async function settle(session: UploadSessionResponse): Promise<UploadSessionResponse> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS
  let current = session
  while (current.status === 'processing' && !(current.target.kind === 'library' && current.bookId != null)) {
    if (Date.now() > deadline) throw new UploadStepError({ kind: 'server', status: 504, errorCode: null, message: null, fromBookOrbit: false })
    await delay(SETTLE_POLL_MS)
    const sessionId = current.id
    current = await retrying(() => requestSession(`${SESSIONS_URL}/${sessionId}`))
  }
  if (current.status !== 'completed' && current.status !== 'processing') throw new UploadStepError(endedFailure(current))
  return current
}

async function requestSession(url: string, init?: RequestInit): Promise<UploadSessionResponse> {
  let response: Response
  try {
    response = await api(url, init)
  } catch (error) {
    // `api` gives up with a plain error once the session cannot be refreshed.
    throw new UploadStepError(
      error instanceof NetworkError ? { kind: 'network' } : { kind: 'server', status: 401, errorCode: null, message: null, fromBookOrbit: true },
    )
  }
  const text = await response.text().catch(() => '')
  if (!response.ok) throw new UploadStepError(parseUploadFailure(response.status, text))
  try {
    return JSON.parse(text) as UploadSessionResponse
  } catch {
    throw new UploadStepError(parseUploadFailure(response.status, text))
  }
}

async function retrying<T>(step: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await step()
    } catch (error) {
      if (!(error instanceof UploadStepError) || !isTransient(error.failure) || attempt >= RETRY_DELAYS_MS.length) throw error
      await delay(RETRY_DELAYS_MS[attempt]!)
    }
  }
}

/** Lost on the way, or answered by something in front of BookOrbit that may not answer so next time. */
function isTransient(failure: UploadFailure): boolean {
  if (failure.kind === 'network') return true
  return failure.status === 408 || failure.status === 429 || (failure.status >= 500 && !failure.fromBookOrbit)
}

function isOffsetMismatch(failure: UploadFailure): boolean {
  return failure.kind === 'server' && failure.status === 409 && failure.errorCode === UploadErrorCode.OffsetMismatch
}

function endedFailure(session: UploadSessionResponse): UploadFailure {
  return {
    kind: 'server',
    status: 422,
    errorCode: session.errorCode ?? (session.status === 'expired' ? UploadErrorCode.SessionExpired : null),
    message: session.errorMessage ?? null,
    fromBookOrbit: true,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
