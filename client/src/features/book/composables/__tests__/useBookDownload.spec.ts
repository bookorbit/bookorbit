import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastMock = vi.hoisted(() => ({
  loading: vi.fn<(message: string) => string>().mockReturnValue('toast-id'),
  dismiss: vi.fn<(id: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}))

const downloadMock = vi.hoisted(() => ({
  downloadFromUrl: vi.fn<(url: string, fallbackFileName: string) => Promise<void>>().mockResolvedValue(undefined),
}))

vi.mock('vue-sonner', () => ({
  toast: toastMock,
}))

vi.mock('@/lib/download', () => downloadMock)

describe('useBookDownload', () => {
  beforeEach(() => {
    vi.resetModules()
    toastMock.loading.mockClear()
    toastMock.dismiss.mockClear()
    toastMock.error.mockClear()
    downloadMock.downloadFromUrl.mockClear()
    downloadMock.downloadFromUrl.mockResolvedValue(undefined)
  })

  it('downloads a single file from its download endpoint', async () => {
    const { useBookDownload } = await import('../useBookDownload')
    const { downloadFile, isDownloading } = useBookDownload()

    await downloadFile(42)

    expect(downloadMock.downloadFromUrl).toHaveBeenCalledWith('/api/v1/books/files/42/download', 'book')
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(isDownloading.value).toBe(false)
  })

  it('reports a failed single-file download and clears the busy flag', async () => {
    downloadMock.downloadFromUrl.mockRejectedValue(new Error('Download failed with status 403'))

    const { useBookDownload } = await import('../useBookDownload')
    const { downloadFile, isDownloading } = useBookDownload()

    await downloadFile(42)

    expect(toastMock.error).toHaveBeenCalledWith('Download failed')
    expect(isDownloading.value).toBe(false)
  })

  it('uses primary export scope by default', async () => {
    const { useBookDownload } = await import('../useBookDownload')
    const { exportBooks } = useBookDownload()

    await exportBooks([1, 2], false)

    const [url, fallback] = downloadMock.downloadFromUrl.mock.calls[0] ?? []
    expect(url).toContain('/api/v1/books/export/download?')
    expect(url).toContain('bookIds=1%2C2')
    expect(url).toContain('scope=primary')
    expect(fallback).toBe('bookorbit-export.zip')
  })

  it('uses all-formats scope when requested', async () => {
    const { useBookDownload } = await import('../useBookDownload')
    const { exportBooks } = useBookDownload()

    await exportBooks([5], true)

    expect(downloadMock.downloadFromUrl.mock.calls[0]?.[0]).toContain('scope=all')
  })

  it('supports audio-only export scope override', async () => {
    const { useBookDownload } = await import('../useBookDownload')
    const { exportBooks } = useBookDownload()

    await exportBooks([9], false, 'audio')

    expect(downloadMock.downloadFromUrl.mock.calls[0]?.[0]).toContain('scope=audio')
  })

  it('keeps the preparing toast up until the export has been handed over', async () => {
    let release: (() => void) | undefined
    downloadMock.downloadFromUrl.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve
      }),
    )

    const { useBookDownload } = await import('../useBookDownload')
    const { exportBooks } = useBookDownload()

    const pending = exportBooks([1], false)
    await Promise.resolve()
    expect(toastMock.dismiss).not.toHaveBeenCalled()

    release?.()
    await pending
    expect(toastMock.dismiss).toHaveBeenCalledWith('toast-id')
  })

  it('reports a failed export', async () => {
    downloadMock.downloadFromUrl.mockRejectedValue(new Error('Download failed with status 500'))

    const { useBookDownload } = await import('../useBookDownload')
    const { exportBooks, isDownloading } = useBookDownload()

    await exportBooks([1], false)

    expect(toastMock.error).toHaveBeenCalledWith('Export failed')
    expect(toastMock.dismiss).toHaveBeenCalledWith('toast-id')
    expect(isDownloading.value).toBe(false)
  })
})
