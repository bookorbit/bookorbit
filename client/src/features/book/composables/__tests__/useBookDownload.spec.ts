import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastMock = vi.hoisted(() => ({
  loading: vi.fn<(message: string) => string>().mockReturnValue('toast-id'),
  dismiss: vi.fn<(id: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}))

vi.mock('vue-sonner', () => ({
  toast: toastMock,
}))

describe('useBookDownload', () => {
  beforeEach(() => {
    vi.resetModules()
    toastMock.loading.mockClear()
    toastMock.dismiss.mockClear()
    toastMock.error.mockClear()
  })

  it('triggers browser-native single-file download endpoint', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const appendSpy = vi.spyOn(document.body, 'append')
    const removeSpy = vi.spyOn(HTMLElement.prototype, 'remove')

    const { useBookDownload } = await import('../useBookDownload')
    const { downloadFile } = useBookDownload()

    await downloadFile(42)

    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement
    expect(anchor.href).toContain('/api/v1/books/files/42/download')
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledTimes(1)

    clickSpy.mockRestore()
    appendSpy.mockRestore()
    removeSpy.mockRestore()
  })

  it('uses primary export scope by default', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const appendSpy = vi.spyOn(document.body, 'append')

    const { useBookDownload } = await import('../useBookDownload')
    const { exportBooks } = useBookDownload()

    await exportBooks([1, 2], false)

    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement
    expect(anchor.href).toContain('/api/v1/books/export/download?')
    expect(anchor.href).toContain('bookIds=1%2C2')
    expect(anchor.href).toContain('scope=primary')
    expect(clickSpy).toHaveBeenCalledTimes(1)

    clickSpy.mockRestore()
    appendSpy.mockRestore()
  })

  it('uses all-formats scope when requested', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const appendSpy = vi.spyOn(document.body, 'append')

    const { useBookDownload } = await import('../useBookDownload')
    const { exportBooks } = useBookDownload()

    await exportBooks([5], true)

    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement
    expect(anchor.href).toContain('scope=all')
    expect(clickSpy).toHaveBeenCalledTimes(1)

    clickSpy.mockRestore()
    appendSpy.mockRestore()
  })

  it('supports audio-only export scope override', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const appendSpy = vi.spyOn(document.body, 'append')

    const { useBookDownload } = await import('../useBookDownload')
    const { exportBooks } = useBookDownload()

    await exportBooks([9], false, 'audio')

    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement
    expect(anchor.href).toContain('scope=audio')
    expect(clickSpy).toHaveBeenCalledTimes(1)

    clickSpy.mockRestore()
    appendSpy.mockRestore()
  })
})
