import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useBookUpload, SUPPORTED_FORMATS_ACCEPT } from '../useBookUpload'

vi.mock('@/lib/api', () => ({ getValidToken: vi.fn<() => Promise<string>>().mockResolvedValue('test-token') }))
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
