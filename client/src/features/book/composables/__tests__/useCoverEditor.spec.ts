// @vitest-environment node
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useCoverEditor } from '../useCoverEditor'

const bumpVersion = vi.fn<(bookId: number) => void>()

vi.mock('vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue')>()),
  onUnmounted: vi.fn<() => void>(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('../useCoverVersions', () => ({
  useCoverVersions: () => ({ bumpVersion }),
}))

function response(ok: boolean, body: unknown = {}): Response {
  return { ok, status: ok ? 200 : 423, json: async () => body } as Response
}

describe('useCoverEditor', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
    bumpVersion.mockReset()
  })

  it('writes an uploaded file to its own slot', async () => {
    vi.mocked(api).mockResolvedValue(response(true))
    const editor = useCoverEditor(ref(7), 'audio')
    editor.selectFile(new File(['x'], 'square.jpg', { type: 'image/jpeg' }))

    await expect(editor.confirm()).resolves.toBe(true)

    expect(vi.mocked(api).mock.calls[0]![0]).toBe('/api/v1/books/7/cover?medium=audio')
    expect(vi.mocked(api).mock.calls[0]![1]).toMatchObject({ method: 'POST' })
    expect(bumpVersion).toHaveBeenCalledWith(7)
    expect(editor.pendingFile.value).toBeNull()
  })

  it('saves a URL to its own slot', async () => {
    vi.mocked(api).mockResolvedValue(response(true))
    const editor = useCoverEditor(ref(7), 'ebook')
    editor.setUrl(' https://example.com/cover.jpg ')

    await expect(editor.confirm()).resolves.toBe(true)

    expect(vi.mocked(api)).toHaveBeenCalledWith('/api/v1/books/7/cover/from-url?medium=ebook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/cover.jpg' }),
    })
  })

  it('leaves the medium off for a book with no content files, so the server routes it', async () => {
    vi.mocked(api).mockResolvedValue(response(true, { coverSource: null }))
    const editor = useCoverEditor(ref(7), null)

    await editor.revert()

    expect(vi.mocked(api)).toHaveBeenCalledWith('/api/v1/books/7/cover', { method: 'DELETE' })
  })

  it('keeps the pending image and shows a translated error when the save fails', async () => {
    vi.mocked(api).mockResolvedValue(response(false))
    const editor = useCoverEditor(ref(7), 'audio')
    editor.setUrl('https://example.com/cover.jpg')

    await expect(editor.confirm()).resolves.toBe(false)

    expect(editor.error.value).toBe('book.detail.coverEditor.saveFailed')
    expect(editor.pendingUrl.value).toBe('https://example.com/cover.jpg')
    expect(editor.uploading.value).toBe(false)
    expect(bumpVersion).not.toHaveBeenCalled()
  })

  it('does nothing without a pending image', async () => {
    const editor = useCoverEditor(ref(7), 'ebook')

    await expect(editor.confirm()).resolves.toBe(false)

    expect(api).not.toHaveBeenCalled()
  })

  it('reverts its slot and returns what the slot falls back to', async () => {
    vi.mocked(api).mockResolvedValue(response(true, { coverSource: 'extracted' }))
    const editor = useCoverEditor(ref(7), 'audio')

    await expect(editor.revert()).resolves.toBe('extracted')

    expect(vi.mocked(api)).toHaveBeenCalledWith('/api/v1/books/7/cover?medium=audio', { method: 'DELETE' })
    expect(bumpVersion).toHaveBeenCalledWith(7)
  })

  it('reports a failed revert', async () => {
    vi.mocked(api).mockResolvedValue(response(false))
    const editor = useCoverEditor(ref(7), 'audio')

    await expect(editor.revert()).resolves.toBe(false)

    expect(editor.error.value).toBe('book.detail.coverEditor.revertFailed')
  })

  it('regenerates its slot and checks the response', async () => {
    vi.mocked(api).mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response(false))
    const editor = useCoverEditor(ref(7), 'ebook')

    await expect(editor.regenerate()).resolves.toBe(true)
    expect(vi.mocked(api)).toHaveBeenCalledWith('/api/v1/books/7/re-extract-cover?medium=ebook', { method: 'POST' })
    expect(bumpVersion).toHaveBeenCalledTimes(1)

    await expect(editor.regenerate()).resolves.toBe(false)
    expect(editor.error.value).toBe('book.coverRegeneration.failed')
    expect(editor.regenerating.value).toBe(false)
    expect(bumpVersion).toHaveBeenCalledTimes(1)
  })

  it('follows the current book id', async () => {
    vi.mocked(api).mockResolvedValue(response(true))
    const bookId = ref(7)
    const editor = useCoverEditor(bookId, 'ebook')
    bookId.value = 9

    await editor.regenerate()

    expect(vi.mocked(api)).toHaveBeenCalledWith('/api/v1/books/9/re-extract-cover?medium=ebook', { method: 'POST' })
  })
})
