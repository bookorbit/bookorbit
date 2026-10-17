import { beforeEach, describe, expect, it, vi } from 'vitest'
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
