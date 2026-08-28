import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DownloadProgress } from '@/lib/download'

const toastMock = vi.hoisted(() => ({
  loading: vi.fn<(message: string, data?: { id?: string | number }) => string>().mockReturnValue('toast-id'),
  dismiss: vi.fn<(id: string) => void>(),
  error: vi.fn<(message: string) => void>(),
}))

const downloadMock = vi.hoisted(() => ({
  downloadFromUrl: vi
    .fn<(url: string, fallbackFileName: string, onProgress?: (progress: DownloadProgress) => void) => Promise<void>>()
    .mockResolvedValue(undefined),
}))

vi.mock('vue-sonner', () => ({
  toast: toastMock,
}))

vi.mock('@/lib/download', () => downloadMock)

/** The copy assertions below are English, so pin the locale rather than trusting the default. */
async function loadComposable() {
  const { i18n } = await import('@/i18n')
  ;(i18n.global.locale as unknown as { value: string }).value = 'en'
  return (await import('../useBookDownload')).useBookDownload
}

describe('useBookDownload', () => {
  beforeEach(() => {
    vi.resetModules()
    toastMock.loading.mockClear()
    toastMock.loading.mockReturnValue('toast-id')
    toastMock.dismiss.mockClear()
    toastMock.error.mockClear()
    downloadMock.downloadFromUrl.mockClear()
    downloadMock.downloadFromUrl.mockResolvedValue(undefined)
  })

  it('downloads a single file from its download endpoint', async () => {
    const useBookDownload = await loadComposable()
    const { downloadFile, isDownloading } = useBookDownload()

    await downloadFile(42)

    const [url, fallback] = downloadMock.downloadFromUrl.mock.calls[0] ?? []
    expect(url).toBe('/api/v1/books/files/42/download')
    expect(fallback).toBe('book')
    expect(toastMock.error).not.toHaveBeenCalled()
    expect(isDownloading.value).toBe(false)
  })

  it('reports a failed single-file download and clears the busy flag', async () => {
    downloadMock.downloadFromUrl.mockRejectedValue(new Error('Download failed with status 403'))

    const useBookDownload = await loadComposable()
    const { downloadFile, isDownloading } = useBookDownload()

    await downloadFile(42)

    expect(toastMock.error).toHaveBeenCalledWith('Download failed')
    expect(isDownloading.value).toBe(false)
  })

  it('uses primary export scope by default', async () => {
    const useBookDownload = await loadComposable()
    const { exportBooks } = useBookDownload()

    await exportBooks([1, 2], false)

    const [url, fallback] = downloadMock.downloadFromUrl.mock.calls[0] ?? []
    expect(url).toContain('/api/v1/books/export/download?')
    expect(url).toContain('bookIds=1%2C2')
    expect(url).toContain('scope=primary')
    expect(fallback).toBe('bookorbit-export.zip')
  })

  it('uses all-formats scope when requested', async () => {
    const useBookDownload = await loadComposable()
    const { exportBooks } = useBookDownload()

    await exportBooks([5], true)

    expect(downloadMock.downloadFromUrl.mock.calls[0]?.[0]).toContain('scope=all')
  })

  it('supports audio-only export scope override', async () => {
    const useBookDownload = await loadComposable()
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

    const useBookDownload = await loadComposable()
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

    const useBookDownload = await loadComposable()
    const { exportBooks, isDownloading } = useBookDownload()

    await exportBooks([1], false)

    expect(toastMock.error).toHaveBeenCalledWith('Export failed')
    expect(toastMock.dismiss).toHaveBeenCalledWith('toast-id')
    expect(isDownloading.value).toBe(false)
  })
})

describe('useBookDownload progress reporting', () => {
  beforeEach(() => {
    vi.resetModules()
    toastMock.loading.mockClear()
    toastMock.loading.mockReturnValue('toast-id')
    toastMock.dismiss.mockClear()
    toastMock.error.mockClear()
    downloadMock.downloadFromUrl.mockClear()
    downloadMock.downloadFromUrl.mockResolvedValue(undefined)
  })

  it('says nothing for a single file when no progress is reported', async () => {
    const useBookDownload = await loadComposable()
    const { downloadFile } = useBookDownload()

    await downloadFile(42)

    expect(toastMock.loading).not.toHaveBeenCalled()
    expect(toastMock.dismiss).not.toHaveBeenCalled()
  })

  it('raises a toast as soon as a buffered single-file download starts', async () => {
    downloadMock.downloadFromUrl.mockImplementation(async (_url, _fallback, onProgress) => {
      onProgress?.({ loaded: 0, total: null })
    })

    const useBookDownload = await loadComposable()
    const { downloadFile } = useBookDownload()

    await downloadFile(42)

    expect(toastMock.loading).toHaveBeenCalledWith('Preparing download...')
    expect(toastMock.dismiss).toHaveBeenCalledWith('toast-id')
  })

  it('shows how far along a measurable download is', async () => {
    downloadMock.downloadFromUrl.mockImplementation(async (_url, _fallback, onProgress) => {
      onProgress?.({ loaded: 0, total: null })
      onProgress?.({ loaded: 0, total: 100 * 1024 * 1024 })
      onProgress?.({ loaded: 42 * 1024 * 1024, total: 100 * 1024 * 1024 })
    })

    const useBookDownload = await loadComposable()
    const { downloadFile } = useBookDownload()

    await downloadFile(42)

    expect(toastMock.loading.mock.calls.map((call) => call[0])).toEqual([
      'Preparing download...',
      'Downloading 0% of 100 MB',
      'Downloading 42% of 100 MB',
    ])
  })

  it('updates the one toast in place instead of stacking a new one per chunk', async () => {
    downloadMock.downloadFromUrl.mockImplementation(async (_url, _fallback, onProgress) => {
      onProgress?.({ loaded: 0, total: 1000 })
      onProgress?.({ loaded: 500, total: 1000 })
    })

    const useBookDownload = await loadComposable()
    const { downloadFile } = useBookDownload()

    await downloadFile(42)

    expect(toastMock.loading.mock.calls[0]?.[1]).toBeUndefined()
    expect(toastMock.loading.mock.calls[1]?.[1]).toEqual({ id: 'toast-id' })
    expect(toastMock.dismiss).toHaveBeenCalledTimes(1)
  })

  it('collapses the thousands of chunks inside one percent into a single update', async () => {
    const total = 100 * 1024 * 1024
    downloadMock.downloadFromUrl.mockImplementation(async (_url, _fallback, onProgress) => {
      // Every 64KB chunk across the first two percent: ~32 reports, two distinct messages.
      for (let loaded = 0; loaded <= total * 0.02; loaded += 64 * 1024) onProgress?.({ loaded, total })
    })

    const useBookDownload = await loadComposable()
    const { downloadFile } = useBookDownload()

    await downloadFile(42)

    expect(toastMock.loading.mock.calls.map((call) => call[0])).toEqual([
      'Downloading 0% of 100 MB',
      'Downloading 1% of 100 MB',
      'Downloading 2% of 100 MB',
    ])
  })

  it('falls back to transferred bytes when the response declares no length', async () => {
    downloadMock.downloadFromUrl.mockImplementation(async (_url, _fallback, onProgress) => {
      onProgress?.({ loaded: 0, total: null })
      onProgress?.({ loaded: 5 * 1024 * 1024, total: null })
    })

    const useBookDownload = await loadComposable()
    const { downloadFile } = useBookDownload()

    await downloadFile(42)

    expect(toastMock.loading.mock.calls.map((call) => call[0])).toEqual(['Preparing download...', 'Downloading 5 MB'])
  })

  it('keeps the export label until real progress replaces it', async () => {
    downloadMock.downloadFromUrl.mockImplementation(async (_url, _fallback, onProgress) => {
      onProgress?.({ loaded: 0, total: null })
      onProgress?.({ loaded: 25, total: 100 })
    })

    const useBookDownload = await loadComposable()
    const { exportBooks } = useBookDownload()

    await exportBooks([1, 2, 3], false)

    expect(toastMock.loading.mock.calls.map((call) => call[0])).toEqual(['Preparing 3 books for download...', 'Downloading 25% of 100 B'])
  })

  it('pluralises the export label for a single book', async () => {
    const useBookDownload = await loadComposable()
    const { exportBooks } = useBookDownload()

    await exportBooks([7], false)

    expect(toastMock.loading).toHaveBeenCalledWith('Preparing 1 book for download...')
  })

  it('dismisses the progress toast when a buffered download fails', async () => {
    downloadMock.downloadFromUrl.mockImplementation(async (_url, _fallback, onProgress) => {
      onProgress?.({ loaded: 0, total: null })
      throw new Error('Download failed with status 500')
    })

    const useBookDownload = await loadComposable()
    const { downloadFile, isDownloading } = useBookDownload()

    await downloadFile(42)

    expect(toastMock.error).toHaveBeenCalledWith('Download failed')
    expect(toastMock.dismiss).toHaveBeenCalledWith('toast-id')
    expect(isDownloading.value).toBe(false)
  })
})
