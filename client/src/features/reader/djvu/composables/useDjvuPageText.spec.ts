import { effectScope, nextTick, reactive } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useDjvuPageText } from './useDjvuPageText'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof api>() }))

describe('DjVu embedded page text', () => {
  let scope: ReturnType<typeof effectScope>
  beforeEach(() => {
    scope = effectScope()
    vi.resetAllMocks()
  })
  afterEach(() => scope.stop())

  it('loads only while open and preserves multilingual text', async () => {
    vi.mocked(api).mockResolvedValue(new Response(JSON.stringify({ text: '日本語の本' })))
    const props = reactive({ open: false, fileId: 22, pageIndex: 0 })
    const reader = scope.run(() => useDjvuPageText(props))!
    expect(api).not.toHaveBeenCalled()
    props.open = true
    await flushPromises()
    expect(api).toHaveBeenCalledWith('/api/v1/djvu/files/22/pages/0/text', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(reader.text.value).toBe('日本語の本')
    expect(reader.loading.value).toBe(false)
    expect(reader.failed.value).toBe(false)
  })

  it('allows retry when decoding is unavailable and accepts pages without OCR', async () => {
    vi.mocked(api).mockResolvedValue(new Response('', { status: 503 }))
    const reader = scope.run(() => useDjvuPageText(reactive({ open: true, fileId: 22, pageIndex: 0 })))!
    await flushPromises()
    expect(reader.failed.value).toBe(true)
    vi.mocked(api).mockResolvedValue(new Response(JSON.stringify({ text: '' })))
    await reader.loadText()
    expect(reader.failed.value).toBe(false)
    expect(reader.text.value).toBe('')
  })

  it('aborts stale requests and ignores text from an earlier page', async () => {
    let release!: (response: Response) => void
    vi.mocked(api)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'Current page' })))
    const props = reactive({ open: true, fileId: 22, pageIndex: 0 })
    const reader = scope.run(() => useDjvuPageText(props))!
    const oldSignal = vi.mocked(api).mock.calls[0]![1]!.signal
    props.pageIndex = 1
    await nextTick()
    expect(oldSignal?.aborted).toBe(true)
    await flushPromises()
    release(new Response(JSON.stringify({ text: 'Stale page' })))
    await flushPromises()
    expect(reader.text.value).toBe('Current page')
  })
})
