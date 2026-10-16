import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getValidTokenMock } = vi.hoisted(() => ({ getValidTokenMock: vi.fn<() => Promise<string | null>>() }))

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(),
  getValidToken: getValidTokenMock,
}))

const MB = 1024 * 1024

class FakeXhr {
  static sent: FakeXhr[] = []
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: FormData | null = null
  status = 0
  responseText = ''
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null }
  onloadend: (() => void) | null = null

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }

  send(body: FormData) {
    this.body = body
    FakeXhr.sent.push(this)
  }

  respond(status: number, body: string | object) {
    this.status = status
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body)
    this.onloadend?.()
  }

  /** What a browser reports for a dropped connection, an abort and a timeout alike. */
  drop() {
    this.status = 0
    this.onloadend?.()
  }

  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent)
  }
}

function bookOrbitError(statusCode: number, message: string, errorCode?: string) {
  return {
    statusCode,
    message,
    path: '/api/v1/book-dock/upload',
    timestamp: '2026-10-12T00:00:00.000Z',
    requestId: 'req-1',
    ...(errorCode ? { errorCode } : {}),
  }
}

function book(name: string, sizeBytes = 16): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'application/epub+zip' })
}

async function loadComposable() {
  const module = await import('../useBookDockUpload')
  const { useAppInfo } = await import('@/features/settings/composables/useAppInfo')
  return { upload: module.useBookDockUpload(), useBookDockUpload: module.useBookDockUpload, appInfo: useAppInfo() }
}

beforeEach(() => {
  vi.resetModules()
  FakeXhr.sent = []
  getValidTokenMock.mockReset()
  getValidTokenMock.mockResolvedValue('token')
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useBookDockUpload client-side validation', () => {
  it('records an unsupported file as a failure without sending it', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('notes.docx')])
    await flushPromises()

    expect(FakeXhr.sent).toHaveLength(0)
    expect(upload.failures.value.map((f) => f.failure)).toEqual([{ kind: 'unsupported', extension: 'docx' }])
    expect(upload.isUploading.value).toBe(false)
  })

  it('records a file with no extension as unsupported', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('README')])

    expect(upload.failures.value[0]?.failure).toEqual({ kind: 'unsupported', extension: '' })
  })

  it('accepts a supported extension regardless of case', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('Dune.EPUB')])
    await flushPromises()

    expect(FakeXhr.sent).toHaveLength(1)
    expect(upload.failures.value).toHaveLength(0)
  })

  it('sends DjVu to the Book Dock instead of rejecting it as unsupported', async () => {
    const { upload } = await loadComposable()
    upload.addFiles([book('DjVuLibre-book.DJVU')])
    await flushPromises()
    expect(FakeXhr.sent).toHaveLength(1)
    expect(upload.failures.value).toHaveLength(0)
  })

  it('rejects a file over the configured upload limit before sending it', async () => {
    const { upload, appInfo } = await loadComposable()
    appInfo.maxUploadSizeMb.value = 1

    upload.addFiles([book('huge.epub', 2 * MB)])
    await flushPromises()

    expect(FakeXhr.sent).toHaveLength(0)
    expect(upload.failures.value[0]?.failure).toEqual({ kind: 'tooLarge', limitBytes: MB })
  })

  it('sends the valid files of a mixed selection and reports only the invalid one', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('good.epub'), book('cover.jpg')])
    await flushPromises()

    expect(FakeXhr.sent).toHaveLength(1)
    expect(upload.failures.value.map((f) => f.file.name)).toEqual(['cover.jpg'])
  })
})

describe('useBookDockUpload requests', () => {
  it('posts the file to the Book Dock with the session token', async () => {
    const { upload } = await loadComposable()
    const file = book('dune.epub')

    upload.addFiles([file])
    await flushPromises()

    const [xhr] = FakeXhr.sent
    expect(xhr?.method).toBe('POST')
    expect(xhr?.url).toBe('/api/v1/book-dock/upload')
    expect(xhr?.headers.Authorization).toBe('Bearer token')
    expect(xhr?.body?.get('file')).toBe(file)
    expect(upload.isUploading.value).toBe(true)
  })

  it('omits the authorization header when there is no session token', async () => {
    getValidTokenMock.mockResolvedValue(null)
    const { upload } = await loadComposable()

    upload.addFiles([book('dune.epub')])
    await flushPromises()

    expect(FakeXhr.sent[0]?.headers).toEqual({})
  })

  it('reports upload progress while the file is sending', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('dune.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.progress(25, 100)

    expect(upload.files.value[0]?.status).toBe('uploading')
    expect(upload.files.value[0]?.progress).toBe(25)
  })

  it('drops a file from the queue once the server accepts it', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('dune.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.respond(201, { id: 7, fileName: 'dune.epub' })
    await flushPromises()

    expect(upload.files.value).toHaveLength(0)
    expect(upload.failures.value).toHaveLength(0)
    expect(upload.isUploading.value).toBe(false)
  })

  it('uploads at most three files at a time and finishes the rest', async () => {
    const { upload } = await loadComposable()

    upload.addFiles(['a', 'b', 'c', 'd', 'e'].map((name) => book(`${name}.epub`)))
    await flushPromises()
    expect(FakeXhr.sent).toHaveLength(3)

    for (const xhr of FakeXhr.sent) xhr.respond(201, {})
    await flushPromises()
    expect(FakeXhr.sent).toHaveLength(5)

    for (const xhr of FakeXhr.sent.slice(3)) xhr.respond(201, {})
    await flushPromises()
    expect(upload.files.value).toHaveLength(0)
    expect(upload.isUploading.value).toBe(false)
  })

  it('keeps going with the rest of a batch after one upload fails', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('a.epub'), book('b.epub'), book('c.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.respond(500, bookOrbitError(500, 'Internal server error'))
    FakeXhr.sent[1]?.respond(201, {})
    FakeXhr.sent[2]?.respond(201, {})
    await flushPromises()

    expect(upload.failures.value.map((f) => f.file.name)).toEqual(['a.epub'])
    expect(upload.files.value).toHaveLength(1)
    expect(upload.isUploading.value).toBe(false)
  })
})

describe('useBookDockUpload server failures', () => {
  it('keeps the error code and message from a BookOrbit rejection', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('dune.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.respond(413, bookOrbitError(413, 'File exceeds the 1 MB upload limit', 'UPLOAD_TOO_LARGE'))
    await flushPromises()

    expect(upload.failures.value[0]?.failure).toEqual({
      kind: 'server',
      status: 413,
      errorCode: 'UPLOAD_TOO_LARGE',
      message: 'File exceeds the 1 MB upload limit',
      fromBookOrbit: true,
    })
  })

  it('takes the first message from a validation error list', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('dune.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.respond(400, { ...bookOrbitError(400, ''), message: ['file must be provided', 'second'] })
    await flushPromises()

    expect(upload.failures.value[0]?.failure).toMatchObject({ kind: 'server', status: 400, message: 'file must be provided' })
  })

  it('marks an HTML error page as coming from in front of BookOrbit', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('dune.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.respond(413, '<html><body><h1>413 Request Entity Too Large</h1></body></html>')
    await flushPromises()

    expect(upload.failures.value[0]?.failure).toEqual({ kind: 'server', status: 413, errorCode: null, message: null, fromBookOrbit: false })
  })

  it('does not trust a JSON body that lacks the BookOrbit error envelope', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('dune.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.respond(502, { error: 'bad gateway' })
    await flushPromises()

    expect(upload.failures.value[0]?.failure).toEqual({ kind: 'server', status: 502, errorCode: null, message: null, fromBookOrbit: false })
  })

  it('treats a blank message as no message', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('dune.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.respond(500, bookOrbitError(500, '   '))
    await flushPromises()

    expect(upload.failures.value[0]?.failure).toMatchObject({ message: null, fromBookOrbit: true })
  })
})

describe('useBookDockUpload requests that never complete', () => {
  it('records a dropped connection as a network failure and keeps the queue moving', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('a.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.drop()
    await flushPromises()

    expect(upload.failures.value[0]?.failure).toEqual({ kind: 'network' })
    expect(upload.isUploading.value).toBe(false)

    upload.addFiles([book('b.epub')])
    await flushPromises()
    expect(FakeXhr.sent).toHaveLength(2)
  })

  it('fails the file instead of hanging when the session token cannot be refreshed', async () => {
    getValidTokenMock.mockRejectedValueOnce(new Error('refresh failed'))
    const { upload } = await loadComposable()

    upload.addFiles([book('a.epub')])
    await flushPromises()

    expect(FakeXhr.sent).toHaveLength(0)
    expect(upload.failures.value[0]?.failure).toEqual({ kind: 'network' })
    expect(upload.isUploading.value).toBe(false)

    upload.addFiles([book('b.epub')])
    await flushPromises()
    expect(FakeXhr.sent).toHaveLength(1)
  })

  it('fails the file when the browser refuses to send the request', async () => {
    vi.spyOn(FakeXhr.prototype, 'send').mockImplementationOnce(() => {
      throw new DOMException('The object is in an invalid state.', 'InvalidStateError')
    })
    const { upload } = await loadComposable()

    upload.addFiles([book('a.epub')])
    await flushPromises()

    expect(upload.failures.value[0]?.failure).toEqual({ kind: 'network' })
    expect(upload.isUploading.value).toBe(false)
  })
})

describe('useBookDockUpload retry and dismiss', () => {
  it('retries a transient failure and clears it once the upload succeeds', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('a.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.respond(503, bookOrbitError(503, 'Service unavailable'))
    await flushPromises()
    const id = upload.failures.value[0]!.id

    upload.retryFailure(id)
    await flushPromises()
    expect(FakeXhr.sent).toHaveLength(2)
    expect(upload.failures.value).toHaveLength(0)

    FakeXhr.sent[1]?.respond(201, {})
    await flushPromises()
    expect(upload.files.value).toHaveLength(0)
  })

  it('picks up a retry while another upload is still in flight', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('a.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.drop()
    await flushPromises()
    upload.addFiles([book('b.epub')])
    await flushPromises()

    upload.retryFailure(upload.failures.value[0]!.id)
    FakeXhr.sent[1]?.respond(201, {})
    await flushPromises()

    expect(FakeXhr.sent).toHaveLength(3)
    expect(FakeXhr.sent[2]?.body?.get('file')).toMatchObject({ name: 'a.epub' })
  })

  it('refuses to retry failures that would fail the same way again', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('notes.docx'), book('a.epub')])
    await flushPromises()
    FakeXhr.sent[0]?.respond(413, bookOrbitError(413, 'File exceeds the 1 MB upload limit', 'UPLOAD_TOO_LARGE'))
    await flushPromises()

    for (const failure of upload.failures.value) upload.retryFailure(failure.id)
    await flushPromises()

    expect(FakeXhr.sent).toHaveLength(1)
    expect(upload.failures.value).toHaveLength(2)
  })

  it('ignores a retry for an unknown id', async () => {
    const { upload } = await loadComposable()

    upload.retryFailure('missing')
    await flushPromises()

    expect(FakeXhr.sent).toHaveLength(0)
    expect(upload.isUploading.value).toBe(false)
  })

  it('dismisses one failure or all of them', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('a.docx'), book('b.docx'), book('c.docx')])
    upload.dismissFailure(upload.failures.value[0]!.id)
    expect(upload.failures.value.map((f) => f.file.name)).toEqual(['b.docx', 'c.docx'])

    upload.dismissAllFailures()
    expect(upload.failures.value).toHaveLength(0)
  })

  it('never dismisses an upload that is still in flight', async () => {
    const { upload } = await loadComposable()

    upload.addFiles([book('a.epub'), book('b.docx')])
    await flushPromises()
    const inFlight = upload.files.value.find((f) => f.status === 'uploading')!

    upload.dismissFailure(inFlight.id)
    upload.dismissAllFailures()

    expect(upload.files.value.map((f) => f.id)).toEqual([inFlight.id])
  })

  it('shares failures between every caller, such as the toolbar and the page', async () => {
    const { upload, useBookDockUpload } = await loadComposable()
    const other = useBookDockUpload()

    upload.addFiles([book('notes.docx')])

    expect(other.failures.value).toHaveLength(1)
    other.dismissAllFailures()
    expect(upload.failures.value).toHaveLength(0)
  })
})
