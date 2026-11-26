import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionUploadOptions } from '@/lib/upload-session'
import { ref } from 'vue'
import { useBookUpload, SUPPORTED_FORMATS_ACCEPT } from '../useBookUpload'

const sessionMocks = vi.hoisted(() => ({
  uploadWithSession: vi.fn<(options: SessionUploadOptions) => Promise<unknown>>(),
  cancelUploadSession: vi.fn<(sessionId: string) => void>(),
}))

vi.mock('@/lib/api', () => ({ getValidToken: vi.fn<() => Promise<string>>().mockResolvedValue('test-token') }))
vi.mock('@/lib/upload-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/upload-session')>()),
  needsUploadSession: (file: File) => file.name.startsWith('big'),
  uploadWithSession: sessionMocks.uploadWithSession,
  cancelUploadSession: sessionMocks.cancelUploadSession,
}))
vi.mock('@/features/settings/composables/useAppInfo', () => ({ useAppInfo: () => ({ maxUploadSizeMb: ref(500) }) }))

describe('library DjVu upload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts DjVu in file selection and drag-and-drop validation regardless of case', () => {
    const upload = useBookUpload()
    upload.addFiles([new File(['document'], 'scanned-book.djvu'), new File(['document'], 'second.DJVU'), new File(['document'], 'notes.docx')])
    expect(SUPPORTED_FORMATS_ACCEPT.split(',')).toContain('.djvu')
    expect(upload.files.value.map((file) => [file.file.name, file.status])).toEqual([
      ['scanned-book.djvu', 'pending'],
      ['second.DJVU', 'pending'],
      ['notes.docx', 'error'],
    ])
    expect(upload.pendingCount.value).toBe(2)
  })
})

describe('library upload formats and docks', () => {
  class FakeXhr {
    static sent: FakeXhr[] = []
    url = ''
    status = 0
    responseText = ''
    upload = { onprogress: null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    open(_method: string, url: string) {
      this.url = url
    }
    setRequestHeader() {}
    send() {
      FakeXhr.sent.push(this)
      this.status = 201
      this.responseText = JSON.stringify({ id: 41, fileName: 'book.epub' })
      queueMicrotask(() => this.onload?.())
    }
  }

  beforeEach(() => {
    FakeXhr.sent = []
    vi.stubGlobal('XMLHttpRequest', FakeXhr)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('holds back a format the library does not take, and lets it go when the library changes', () => {
    const upload = useBookUpload()
    upload.addFiles([new File(['a'], 'a.epub'), new File(['b'], 'b.cbz')])

    upload.applyAllowedFormats(['epub'])
    expect(upload.files.value.map((file) => [file.file.name, file.status, file.refusedFormat ?? false])).toEqual([
      ['a.epub', 'pending', false],
      ['b.cbz', 'error', true],
    ])

    upload.applyAllowedFormats([])
    expect(upload.files.value.map((file) => file.status)).toEqual(['pending', 'pending'])
  })

  it("sends a review upload to the library's dock and keeps the dock file it made", async () => {
    const upload = useBookUpload()
    upload.addFiles([new File(['a'], 'a.epub')])

    await upload.startDockUpload(3)

    expect(FakeXhr.sent.map((xhr) => xhr.url)).toEqual(['/api/v1/book-dock/upload?libraryId=3'])
    expect(upload.files.value[0]).toMatchObject({ status: 'done', dockFileId: 41 })
    expect(upload.uploadedBookIds.value).toEqual([])
  })
})

describe('library upload of a large file', () => {
  beforeEach(() => {
    sessionMocks.uploadWithSession.mockReset()
    sessionMocks.cancelUploadSession.mockReset()
  })

  it('sends it as a session to the library and folder, and keeps the book it made', async () => {
    sessionMocks.uploadWithSession.mockImplementation(async ({ onProgress }) => {
      onProgress(0.5)
      return { ok: true, session: { bookId: 41, bookDockFileId: null } }
    })
    const upload = useBookUpload()
    upload.addFiles([new File(['a'], 'big.m4b')])

    await upload.startUpload(3, 9)

    expect(sessionMocks.uploadWithSession).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: 'library', libraryId: 3, folderId: 9 }, resumeKey: upload.files.value[0]!.resumeKey }),
    )
    expect(upload.files.value[0]).toMatchObject({ status: 'done', progress: 100, bookId: 41 })
    expect(upload.uploadedBookIds.value).toEqual([41])
  })

  it("sends a review upload to the library's dock", async () => {
    sessionMocks.uploadWithSession.mockResolvedValue({ ok: true, session: { bookId: null, bookDockFileId: 12 } })
    const upload = useBookUpload()
    upload.addFiles([new File(['a'], 'big.m4b')])

    await upload.startDockUpload(3)

    expect(sessionMocks.uploadWithSession).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'book_dock', libraryId: 3 } }))
    expect(upload.files.value[0]).toMatchObject({ status: 'done', dockFileId: 12 })
  })

  it('resumes a retry under the same key, and cancels the session when the file is removed', async () => {
    sessionMocks.uploadWithSession.mockResolvedValue({ ok: false, sessionId: 'session-1', failure: { kind: 'network' } })
    const upload = useBookUpload()
    upload.addFiles([new File(['a'], 'big.m4b')])
    const item = upload.files.value[0]!

    await upload.startUpload(3)
    expect(item).toMatchObject({ status: 'error', error: 'Network error', uploadSessionId: 'session-1' })

    upload.retryFile(item.id)
    await upload.startUpload(3)
    const keys = sessionMocks.uploadWithSession.mock.calls.map(([options]) => options.resumeKey)
    expect(new Set(keys).size).toBe(1)

    upload.removeFile(item.id)
    expect(sessionMocks.cancelUploadSession).toHaveBeenCalledWith('session-1')
  })

  it("shows the server's reason for a refused file", async () => {
    sessionMocks.uploadWithSession.mockResolvedValue({
      ok: false,
      sessionId: 'session-1',
      failure: { kind: 'server', status: 422, errorCode: 'UPLOAD_CONTENT_INVALID', message: 'Not an audiobook', fromBookOrbit: true },
    })
    const upload = useBookUpload()
    upload.addFiles([new File(['a'], 'big.m4b')])

    await upload.startUpload(3)

    expect(upload.files.value[0]).toMatchObject({ status: 'error', error: 'Not an audiobook' })
  })
})
