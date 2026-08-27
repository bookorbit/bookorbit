import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>() }))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

function setStandalone(value: boolean | undefined) {
  Object.defineProperty(navigator, 'standalone', { value, configurable: true, writable: true })
}

describe('downloadFromUrl', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.api.mockReset()
    setStandalone(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('links straight at the endpoint so the response streams from the server', async () => {
    const appendSpy = vi.spyOn(document.body, 'append')
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const removeSpy = vi.spyOn(HTMLElement.prototype, 'remove')

    const { downloadFromUrl } = await import('../download')
    await downloadFromUrl('/api/v1/books/files/42/download', 'book')

    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement
    expect(anchor.href).toContain('/api/v1/books/files/42/download')
    expect(anchor.hasAttribute('download')).toBe(false)
    expect(mocks.api).not.toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(removeSpy).toHaveBeenCalledTimes(1)
  })

  it('hands an iOS home-screen web app a blob so the app is never navigated away', async () => {
    setStandalone(true)
    const appendSpy = vi.spyOn(document.body, 'append')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url')

    mocks.api.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'Content-Disposition': `attachment; filename*=UTF-8''Winter%27s%20Orbit.epub` }),
      blob: async () => new Blob(['epub'], { type: 'application/epub+zip' }),
    } as unknown as Response)

    const { downloadFromUrl } = await import('../download')
    await downloadFromUrl('/api/v1/books/files/42/download', 'book')

    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/books/files/42/download')
    expect(anchor.href).toBe('blob:test-url')
    expect(anchor.download).toBe("Winter's Orbit.epub")
  })

  it('names the blob from the fallback when the response carries no disposition', async () => {
    setStandalone(true)
    const appendSpy = vi.spyOn(document.body, 'append')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url')

    mocks.api.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      blob: async () => new Blob(['zip'], { type: 'application/zip' }),
    } as unknown as Response)

    const { downloadFromUrl } = await import('../download')
    await downloadFromUrl('/api/v1/books/export/download?scope=all', 'bookorbit-export.zip')

    const anchor = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement
    expect(anchor.download).toBe('bookorbit-export.zip')
  })

  it('rejects on a failed blob download so callers can report it', async () => {
    setStandalone(true)
    mocks.api.mockResolvedValue({ ok: false, status: 403, headers: new Headers() } as unknown as Response)

    const { downloadFromUrl } = await import('../download')
    await expect(downloadFromUrl('/api/v1/books/files/42/download', 'book')).rejects.toThrow('403')
  })

  it('outlives the click before revoking the object URL', async () => {
    vi.useFakeTimers()
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test-url')
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    const { triggerBlobDownload } = await import('../download')
    triggerBlobDownload(new Blob(['x']), 'x.txt')

    expect(revokeSpy).not.toHaveBeenCalled()
    vi.advanceTimersByTime(60_000)
    expect(revokeSpy).toHaveBeenCalledWith('blob:test-url')
  })
})

describe('fileNameFromContentDisposition', () => {
  it('prefers the UTF-8 filename, falls back to ASCII, then to the caller fallback', async () => {
    const { fileNameFromContentDisposition } = await import('../download')

    expect(fileNameFromContentDisposition(`attachment; filename="plain.epub"`, 'fallback')).toBe('plain.epub')
    expect(fileNameFromContentDisposition(`attachment; filename="ascii.epub"; filename*=UTF-8''caf%C3%A9.epub`, 'fallback')).toBe('café.epub')
    expect(fileNameFromContentDisposition(null, 'fallback')).toBe('fallback')
    expect(fileNameFromContentDisposition('attachment', 'fallback')).toBe('fallback')
  })
})
