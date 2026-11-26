import {
  UPLOAD_CHUNK_SIZE_BYTES,
  UploadErrorCode,
  type CreateUploadSessionRequest,
  type UploadSessionResponse,
  type UploadTarget,
} from '@bookorbit/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class NetworkError extends Error {}
  return {
    api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
    getValidToken: vi.fn<() => Promise<string | null>>(),
    NetworkError,
  }
})

vi.mock('@/lib/api', () => ({ api: mocks.api, getValidToken: mocks.getValidToken, NetworkError: mocks.NetworkError }))

import { cancelUploadSession, needsUploadSession, parseUploadFailure, uploadWithSession } from '../upload-session'

type ChunkFault = 'drop' | 'dropAfterStoring' | { status: number; body: unknown }

/** The upload-session routes as the server answers them, with faults to inject on the way. */
class FakeServer {
  state: UploadSessionResponse
  creates: CreateUploadSessionRequest[] = []
  chunks: Array<{ offset: number; size: number; authorization: string | undefined }> = []
  chunkFaults: ChunkFault[] = []
  /** What `complete` turns the session into, and then what each later status read finds. */
  onComplete: Partial<UploadSessionResponse> = { status: 'completed' }
  laterReads: Array<Partial<UploadSessionResponse>> = []
  statusReads = 0
  completes = 0
  cancels: string[] = []

  constructor(overrides: Partial<UploadSessionResponse> = {}) {
    this.state = session(overrides)
  }
}

let server: FakeServer

function session(overrides: Partial<UploadSessionResponse> = {}): UploadSessionResponse {
  return {
    id: 'session-1',
    filename: 'big.m4b',
    sizeBytes: 10,
    receivedBytes: 0,
    chunkSizeBytes: 4,
    status: 'receiving',
    target: { kind: 'library', libraryId: 3 },
    errorCode: null,
    errorMessage: null,
    bookId: null,
    bookDockFileId: null,
    expiresAt: '2026-12-03T00:00:00.000Z',
    createdAt: '2026-11-26T00:00:00.000Z',
    updatedAt: '2026-11-26T00:00:00.000Z',
    completedAt: null,
    ...overrides,
  }
}

function response(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  return { ok: status >= 200 && status < 300, status, text: async () => text } as Response
}

function bookOrbitError(statusCode: number, message: string, errorCode?: string, extra: object = {}) {
  return { statusCode, message, requestId: 'req-1', ...(errorCode ? { errorCode } : {}), ...extra }
}

class FakeXhr {
  method = ''
  url = ''
  headers: Record<string, string> = {}
  status = 0
  responseText = ''
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  onloadend: (() => void) | null = null

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value
  }

  send(form: FormData) {
    const chunk = form.get('chunk') as File
    const offset = Number(this.headers['upload-offset'])
    const fault = server.chunkFaults.shift()
    queueMicrotask(() => {
      if (fault === 'drop') return this.finish(0, '')
      if (fault && typeof fault === 'object') return this.finish(fault.status, JSON.stringify(fault.body))
      if (offset !== server.state.receivedBytes) {
        const body = bookOrbitError(409, 'offset', UploadErrorCode.OffsetMismatch, { expectedOffset: server.state.receivedBytes })
        return this.finish(409, JSON.stringify(body))
      }
      server.chunks.push({ offset, size: chunk.size, authorization: this.headers.authorization })
      server.state = { ...server.state, receivedBytes: server.state.receivedBytes + chunk.size }
      this.upload.onprogress?.({ lengthComputable: true, loaded: chunk.size, total: chunk.size } as ProgressEvent)
      if (fault === 'dropAfterStoring') return this.finish(0, '')
      this.finish(201, JSON.stringify(server.state))
    })
  }

  private finish(status: number, text: string) {
    this.status = status
    this.responseText = text
    this.onloadend?.()
  }
}

function routeApi(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input)
  const method = init?.method ?? 'GET'
  if (url === '/api/v1/uploads' && method === 'POST') {
    server.creates.push(JSON.parse(String(init?.body)) as CreateUploadSessionRequest)
    return Promise.resolve(response(201, server.state))
  }
  if (url.endsWith('/complete')) {
    server.completes++
    server.state = { ...server.state, ...server.onComplete }
    return Promise.resolve(response(202, server.state))
  }
  if (method === 'DELETE') {
    server.cancels.push(url)
    return Promise.resolve(response(200, { ...server.state, status: 'cancelled' }))
  }
  server.statusReads++
  const next = server.laterReads.shift()
  if (next) server.state = { ...server.state, ...next }
  return Promise.resolve(response(200, server.state))
}

function upload(target: UploadTarget = { kind: 'library', libraryId: 3 }, content = '0123456789') {
  const progress: number[] = []
  const pending = uploadWithSession({
    file: new File([content], 'big.m4b', { type: 'audio/mp4' }),
    target,
    resumeKey: 'item-key-1',
    onProgress: (fraction) => progress.push(fraction),
  })
  return { pending, progress }
}

/** Runs the retry waits and status polls until the upload settles. */
async function settled<T>(pending: Promise<T>): Promise<T> {
  let done = false
  void pending.finally(() => {
    done = true
  })
  for (let step = 0; step < 50 && !done; step++) await vi.advanceTimersByTimeAsync(1_000)
  return pending
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  server = new FakeServer()
  mocks.api.mockReset().mockImplementation(routeApi)
  mocks.getValidToken.mockReset().mockResolvedValue('token-1')
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('needsUploadSession', () => {
  it('keeps a file that fits in one chunk on the single request', () => {
    expect(needsUploadSession({ size: UPLOAD_CHUNK_SIZE_BYTES } as File)).toBe(false)
    expect(needsUploadSession({ size: UPLOAD_CHUNK_SIZE_BYTES + 1 } as File)).toBe(true)
  })
})

describe('uploadWithSession', () => {
  it('creates the session, sends each chunk at its offset, and completes it', async () => {
    const { pending, progress } = upload({ kind: 'library', libraryId: 3, folderId: 9 })

    const outcome = await settled(pending)

    expect(outcome).toMatchObject({ ok: true, session: { status: 'completed' } })
    expect(server.creates).toEqual([
      {
        filename: 'big.m4b',
        sizeBytes: 10,
        idempotencyKey: 'item-key-1.l3.f9',
        target: { kind: 'library', libraryId: 3, folderId: 9 },
        contentType: 'audio/mp4',
      },
    ])
    expect(server.chunks).toEqual([
      { offset: 0, size: 4, authorization: 'Bearer token-1' },
      { offset: 4, size: 4, authorization: 'Bearer token-1' },
      { offset: 8, size: 2, authorization: 'Bearer token-1' },
    ])
    expect(server.completes).toBe(1)
    expect(progress).toEqual([0.4, 0.8, 1])
  })

  it('gives each target its own key, so a retry to another target never meets the old session', async () => {
    const keys: string[] = []
    for (const target of [{ kind: 'existing_book', bookId: 5 }, { kind: 'book_dock' }, { kind: 'book_dock', libraryId: 2 }] as UploadTarget[]) {
      server = new FakeServer()
      await settled(upload(target).pending)
      keys.push(server.creates[0]!.idempotencyKey)
    }

    expect(keys).toEqual(['item-key-1.b5', 'item-key-1.d', 'item-key-1.d2'])
  })

  it('carries on from the bytes the server already has when the session is handed back', async () => {
    server = new FakeServer({ receivedBytes: 8 })

    const outcome = await settled(upload().pending)

    expect(outcome.ok).toBe(true)
    expect(server.chunks).toEqual([{ offset: 8, size: 2, authorization: 'Bearer token-1' }])
  })

  it('goes straight to the result when the session already finished', async () => {
    server = new FakeServer({ receivedBytes: 10, status: 'processing', bookId: 41 })

    const outcome = await settled(upload().pending)

    expect(outcome).toMatchObject({ ok: true, session: { bookId: 41 } })
    expect(server.chunks).toEqual([])
  })

  it('asks where the session stands after a dropped chunk, and never sends a chunk the server kept', async () => {
    server.chunkFaults = [undefined as never, 'dropAfterStoring', 'drop']

    const outcome = await settled(upload().pending)

    expect(outcome.ok).toBe(true)
    expect(server.chunks.map((chunk) => chunk.offset)).toEqual([0, 4, 8])
    expect(server.statusReads).toBe(2)
  })

  it('takes the offset the server reports after a mismatch', async () => {
    server = new FakeServer({ receivedBytes: 0 })
    let reads = 0
    mocks.api.mockImplementation((input, init) => {
      // The first status read finds a chunk another tab sent meanwhile.
      if ((init?.method ?? 'GET') === 'GET' && reads++ === 0) server.state = { ...server.state, receivedBytes: 4 }
      return routeApi(input, init)
    })
    server.chunkFaults = [{ status: 409, body: bookOrbitError(409, 'offset', UploadErrorCode.OffsetMismatch, { expectedOffset: 4 }) }]

    const outcome = await settled(upload().pending)

    expect(outcome.ok).toBe(true)
    expect(server.chunks.map((chunk) => chunk.offset)).toEqual([4, 8])
  })

  it('retries a proxy error but not one BookOrbit wrote', async () => {
    server.chunkFaults = [{ status: 502, body: '<html>Bad gateway</html>' }]
    expect((await settled(upload().pending)).ok).toBe(true)

    server = new FakeServer()
    server.chunkFaults = [{ status: 500, body: bookOrbitError(500, 'Internal server error') }]
    const outcome = await settled(upload().pending)

    expect(outcome).toEqual({
      ok: false,
      sessionId: 'session-1',
      failure: { kind: 'server', status: 500, errorCode: null, message: 'Internal server error', fromBookOrbit: true },
    })
    expect(server.chunks).toEqual([])
  })

  it('stops on a refused file and names the session it leaves', async () => {
    server.chunkFaults = [{ status: 422, body: bookOrbitError(422, 'Not an audiobook', UploadErrorCode.InvalidContent) }]

    const outcome = await settled(upload().pending)

    expect(outcome).toEqual({
      ok: false,
      sessionId: 'session-1',
      failure: { kind: 'server', status: 422, errorCode: UploadErrorCode.InvalidContent, message: 'Not an audiobook', fromBookOrbit: true },
    })
    expect(server.completes).toBe(0)
  })

  it('gives up after the retries run out on a connection that keeps dropping', async () => {
    server.chunkFaults = ['drop', 'drop', 'drop', 'drop']

    const outcome = await settled(upload().pending)

    expect(outcome).toEqual({ ok: false, sessionId: 'session-1', failure: { kind: 'network' } })
  })

  it('reports a failure to create the session with no session to cancel', async () => {
    mocks.api.mockResolvedValue(response(413, '<html>413 Request Entity Too Large</html>'))

    const outcome = await settled(upload().pending)

    expect(outcome).toEqual({
      ok: false,
      sessionId: null,
      failure: { kind: 'server', status: 413, errorCode: null, message: null, fromBookOrbit: false },
    })
  })

  it('treats a library upload as done once it has its book, as the single request does', async () => {
    server.onComplete = { status: 'processing', bookId: 41 }

    const outcome = await settled(upload().pending)

    expect(outcome).toMatchObject({ ok: true, session: { status: 'processing', bookId: 41 } })
    expect(server.statusReads).toBe(0)
  })

  it('waits for a dock upload still being filed, and reports how it ended', async () => {
    server = new FakeServer({ target: { kind: 'book_dock' } })
    server.onComplete = { status: 'processing' }
    server.laterReads = [{}, { status: 'completed', bookDockFileId: 12 }]
    expect(await settled(upload({ kind: 'book_dock' }).pending)).toMatchObject({ ok: true, session: { bookDockFileId: 12 } })

    server = new FakeServer({ target: { kind: 'book_dock' } })
    server.onComplete = { status: 'processing' }
    server.laterReads = [{ status: 'failed', errorCode: UploadErrorCode.Duplicate, errorMessage: 'Already in the dock' }]
    expect(await settled(upload({ kind: 'book_dock' }).pending)).toEqual({
      ok: false,
      sessionId: 'session-1',
      failure: { kind: 'server', status: 422, errorCode: UploadErrorCode.Duplicate, message: 'Already in the dock', fromBookOrbit: true },
    })
  })

  it('reports a dropped network on the session requests as a network failure', async () => {
    mocks.api.mockRejectedValue(new mocks.NetworkError('offline'))

    expect(await settled(upload().pending)).toEqual({ ok: false, sessionId: null, failure: { kind: 'network' } })
    expect(mocks.api).toHaveBeenCalledTimes(4)
  })
})

describe('cancelUploadSession', () => {
  it('cancels the session and ignores a failure to reach the server', async () => {
    cancelUploadSession('session-1')
    expect(server.cancels).toEqual(['/api/v1/uploads/session-1'])

    mocks.api.mockRejectedValue(new mocks.NetworkError('offline'))
    expect(() => cancelUploadSession('session-2')).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)
  })
})

describe('parseUploadFailure', () => {
  it('reads a BookOrbit error, a proxy page, and a request that got no answer', () => {
    expect(parseUploadFailure(400, JSON.stringify(bookOrbitError(400, ['first', 'second'] as never)))).toEqual({
      kind: 'server',
      status: 400,
      errorCode: null,
      message: 'first',
      fromBookOrbit: true,
    })
    expect(parseUploadFailure(413, '<html>Payload Too Large</html>')).toEqual({
      kind: 'server',
      status: 413,
      errorCode: null,
      message: null,
      fromBookOrbit: false,
    })
    expect(parseUploadFailure(0, '')).toEqual({ kind: 'network' })
  })
})
