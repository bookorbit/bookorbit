import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  getAccessToken: vi.fn<() => string>().mockReturnValue('test-token'),
}))

interface MockXhrInstance {
  open: ReturnType<typeof vi.fn>
  setRequestHeader: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  upload: { onprogress: ((e: ProgressEvent) => void) | null }
  onload: (() => void) | null
  onerror: (() => void) | null
  status: number
  responseText: string
}

const mockXhrInstances: MockXhrInstance[] = []

const defaultResponseText = JSON.stringify({
  id: 55,
  format: 'epub',
  role: 'content',
  sizeBytes: 1024,
  absolutePath: '/library/Book/file.epub',
  createdAt: '2025-01-01T00:00:00.000Z',
  filename: 'file.epub',
  durationSeconds: null,
  bookStatus: 'present',
})

class MockXMLHttpRequest implements MockXhrInstance {
  open = vi.fn<(method: string, url: string) => void>()
  setRequestHeader = vi.fn<(name: string, value: string) => void>()
  send = vi.fn<() => void>()
  upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  status = 201
  responseText = defaultResponseText

  constructor() {
    mockXhrInstances.push(this)
  }
}

vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest)

import { useAddBookFile, SUPPORTED_FORMATS, MAX_FILE_BYTES } from '../useAddBookFile'

function makeFile(name: string, sizeBytes = 1024, lastModified = 1000): File {
  const blob = new Blob(['x'])
  const file = new File([blob], name, { lastModified })
  Object.defineProperty(file, 'size', { value: sizeBytes, configurable: true })
  return file
}

describe('useAddBookFile', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockXhrInstances.length = 0
    mockFetch = vi.fn<() => Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)
  })

  describe('addFiles', () => {
    it('adds a valid file to the queue as pending', () => {
      const { files, addFiles } = useAddBookFile()
      addFiles([makeFile('book.epub')])
      expect(files.value).toHaveLength(1)
      expect(files.value[0].status).toBe('pending')
      expect(files.value[0].file.name).toBe('book.epub')
    })

    it('marks unsupported format as error without attempting upload', () => {
      const { files, addFiles } = useAddBookFile()
      addFiles([makeFile('book.xyz')])
      expect(files.value[0].status).toBe('error')
      expect(files.value[0].error).toContain('.xyz')
    })

    it('sets validationError=true for unsupported format', () => {
      const { files, addFiles } = useAddBookFile()
      addFiles([makeFile('book.xyz')])
      expect(files.value[0].validationError).toBe(true)
    })

    it('sets validationError=false for valid files', () => {
      const { files, addFiles } = useAddBookFile()
      addFiles([makeFile('book.epub')])
      expect(files.value[0].validationError).toBe(false)
    })

    it('marks file exceeding 500 MB as error', () => {
      const { files, addFiles } = useAddBookFile()
      const oversized = makeFile('big.epub', MAX_FILE_BYTES + 1)
      Object.defineProperty(oversized, 'size', { value: MAX_FILE_BYTES + 1 })
      addFiles([oversized])
      expect(files.value[0].status).toBe('error')
      expect(files.value[0].error).toContain('500 MB')
    })

    it('accepts all supported formats', () => {
      const { files, addFiles } = useAddBookFile()
      const validFiles = SUPPORTED_FORMATS.map((fmt) => makeFile(`book.${fmt}`))
      addFiles(validFiles)
      expect(files.value.every((f) => f.status === 'pending')).toBe(true)
    })

    it('deduplicates files with same name and size', () => {
      const { files, addFiles } = useAddBookFile()
      const file = makeFile('book.epub', 1024)
      addFiles([file])
      addFiles([file])
      expect(files.value).toHaveLength(1)
    })

    it('allows two files with same name but different size', () => {
      const { files, addFiles } = useAddBookFile()
      addFiles([makeFile('book.epub', 1024), makeFile('book.epub', 2048)])
      expect(files.value).toHaveLength(2)
    })
  })

  describe('removeFile', () => {
    it('removes file by id', () => {
      const { files, addFiles, removeFile } = useAddBookFile()
      addFiles([makeFile('book.epub')])
      const id = files.value[0].id
      removeFile(id)
      expect(files.value).toHaveLength(0)
    })

    it('is a no-op for unknown id', () => {
      const { files, addFiles, removeFile } = useAddBookFile()
      addFiles([makeFile('book.epub')])
      removeFile('non-existent')
      expect(files.value).toHaveLength(1)
    })
  })

  describe('retryFile', () => {
    it('resets a server/network error file back to pending', async () => {
      const { files, addFiles, retryFile, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(7)
      const xhr = mockXhrInstances[0]
      xhr.onerror?.()
      await uploadPromise

      expect(files.value[0].status).toBe('error')
      retryFile(files.value[0].id)
      expect(files.value[0].status).toBe('pending')
      expect(files.value[0].error).toBeUndefined()
      expect(files.value[0].progress).toBe(0)
    })

    it('does not retry files that failed client-side validation', () => {
      const { files, addFiles, retryFile } = useAddBookFile()
      addFiles([makeFile('book.xyz')]) // validation error
      const id = files.value[0].id
      retryFile(id)
      expect(files.value[0].status).toBe('error') // unchanged
      expect(files.value[0].error).toBeDefined() // error message preserved
    })

    it('is a no-op for files not in error state', () => {
      const { files, addFiles, retryFile } = useAddBookFile()
      addFiles([makeFile('book.epub')])
      retryFile(files.value[0].id)
      expect(files.value[0].status).toBe('pending')
    })
  })

  describe('reset', () => {
    it('clears all files from the queue', () => {
      const { files, addFiles, reset } = useAddBookFile()
      addFiles([makeFile('a.epub'), makeFile('b.pdf')])
      reset()
      expect(files.value).toHaveLength(0)
    })
  })

  describe('computed counts', () => {
    it('pendingCount reflects pending files', () => {
      const { pendingCount, addFiles } = useAddBookFile()
      addFiles([makeFile('a.epub'), makeFile('b.pdf')])
      expect(pendingCount.value).toBe(2)
    })

    it('errorCount reflects error files', () => {
      const { errorCount, addFiles } = useAddBookFile()
      addFiles([makeFile('bad.xyz'), makeFile('b.pdf')])
      expect(errorCount.value).toBe(1)
    })

    it('isUploading is false when no uploads in flight', () => {
      const { isUploading } = useAddBookFile()
      expect(isUploading.value).toBe(false)
    })
  })

  describe('startUpload', () => {
    it('sends XHR POST to /api/v1/books/:bookId/files', async () => {
      const { addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(42)
      const xhr = mockXhrInstances[0]
      xhr.onload?.()
      await uploadPromise

      expect(xhr.open).toHaveBeenCalledWith('POST', '/api/v1/books/42/files')
    })

    it('sets Authorization header with token', async () => {
      const { addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(42)
      const xhr = mockXhrInstances[0]
      xhr.onload?.()
      await uploadPromise

      expect(xhr.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer test-token')
    })

    it('marks file as done on 201 and stores result', async () => {
      const { files, addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(7)
      const xhr = mockXhrInstances[0]
      xhr.status = 201
      xhr.onload?.()
      await uploadPromise

      expect(files.value[0].status).toBe('done')
      expect(files.value[0].result?.bookStatus).toBe('present')
    })

    it('marks file as error on non-201 response', async () => {
      const { files, addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(7)
      const xhr = mockXhrInstances[0]
      xhr.status = 409
      xhr.responseText = JSON.stringify({ message: 'File already attached' })
      xhr.onload?.()
      await uploadPromise

      expect(files.value[0].status).toBe('error')
      expect(files.value[0].error).toBe('File already attached')
    })

    it('marks file as error on network failure', async () => {
      const { files, addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(7)
      const xhr = mockXhrInstances[0]
      xhr.onerror?.()
      await uploadPromise

      expect(files.value[0].status).toBe('error')
      expect(files.value[0].error).toBe('Network error')
    })

    it('skips already-done or error files on startUpload', async () => {
      const { files, addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('bad.xyz'), makeFile('book.epub')])

      const uploadPromise = startUpload(7)
      const xhr = mockXhrInstances[0]
      xhr.onload?.()
      await uploadPromise

      expect(files.value[0].status).toBe('error') // was already error, not re-uploaded
      expect(mockXhrInstances).toHaveLength(1) // only 1 XHR created
    })

    it('updates progress during upload', async () => {
      const { files, addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(7)
      const xhr = mockXhrInstances[0]
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 } as ProgressEvent)

      expect(files.value[0].progress).toBe(50)
      expect(files.value[0].status).toBe('uploading')

      xhr.onload?.()
      await uploadPromise
    })

    it('is a no-op when there are no pending files', async () => {
      const { startUpload } = useAddBookFile()
      await startUpload(7)
      expect(mockXhrInstances).toHaveLength(0)
    })

    it('falls back gracefully when response body is not valid JSON', async () => {
      const { files, addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(7)
      const xhr = mockXhrInstances[0]
      xhr.status = 201
      xhr.responseText = 'not-json'
      xhr.onload?.()
      await uploadPromise

      expect(files.value[0].status).toBe('done')
      expect(files.value[0].result).toBeUndefined()
    })

    it('shows fallback error message when error response is not JSON', async () => {
      const { files, addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(7)
      const xhr = mockXhrInstances[0]
      xhr.status = 500
      xhr.responseText = 'Internal Server Error'
      xhr.onload?.()
      await uploadPromise

      expect(files.value[0].status).toBe('error')
      expect(files.value[0].error).toBe('Upload failed (500)')
    })
  })

  describe('rename after upload', () => {
    it('calls POST /api/v1/books/:id/rename-files after all uploads complete when renameAfter=true and some succeeded', async () => {
      const { addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(42, { renameAfter: true })
      const xhr = mockXhrInstances[0]
      xhr.status = 201
      xhr.onload?.()
      await uploadPromise

      expect(mockFetch).toHaveBeenCalledWith('/api/v1/books/42/rename-files', expect.objectContaining({ method: 'POST' }))
    })

    it('does not call rename endpoint when renameAfter=false', async () => {
      const { addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(42, { renameAfter: false })
      const xhr = mockXhrInstances[0]
      xhr.onload?.()
      await uploadPromise

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('does not call rename endpoint by default (renameAfter omitted)', async () => {
      const { addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(42)
      const xhr = mockXhrInstances[0]
      xhr.onload?.()
      await uploadPromise

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('does not call rename endpoint when renameAfter=true but no uploads succeeded', async () => {
      const { addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(42, { renameAfter: true })
      const xhr = mockXhrInstances[0]
      xhr.status = 409
      xhr.responseText = JSON.stringify({ message: 'Already exists' })
      xhr.onload?.()
      await uploadPromise

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('does not fail startUpload if rename endpoint throws', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const { addFiles, startUpload } = useAddBookFile()
      addFiles([makeFile('book.epub')])

      const uploadPromise = startUpload(42, { renameAfter: true })
      const xhr = mockXhrInstances[0]
      xhr.status = 201
      xhr.onload?.()

      await expect(uploadPromise).resolves.toBeUndefined()
    })
  })
})
