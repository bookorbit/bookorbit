import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error public Foliate asset has no TypeScript declarations.
import { loadIframeDocument } from '../../../../../public/assets/foliate/iframe-loader.js'

const chapter =
  '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><div id="empty"/><p id="sentence">Saved sentence</p><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg></body></html>'

describe('chapter iframe loading', () => {
  let iframe: HTMLIFrameElement
  let currentDocument: Document
  const src = 'blob:http://localhost/chapter'
  const fetchMock = vi.fn<typeof fetch>()

  function complete(url: string) {
    currentDocument = new DOMParser().parseFromString(chapter, 'application/xhtml+xml')
    Object.defineProperty(currentDocument, 'URL', { value: url })
    iframe.dispatchEvent(new Event('load'))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    iframe = document.createElement('iframe')
    currentDocument = document.implementation.createHTMLDocument('')
    Object.defineProperty(currentDocument, 'URL', { value: 'about:blank', configurable: true })
    Object.defineProperty(iframe, 'contentDocument', { get: () => currentDocument })
    fetchMock.mockResolvedValue(new Response(chapter, { headers: { 'content-type': 'application/xhtml+xml' } }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps normal blob navigation and never fetches an inline fallback after loading', async () => {
    iframe.srcdoc = '<p>Previous chapter</p>'
    const loaded = loadIframeDocument(iframe, src)
    expect(iframe.hasAttribute('srcdoc')).toBe(false)
    complete(src)
    await expect(loaded).resolves.toBe(currentDocument)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(iframe.srcdoc).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores the initial blank load event, then falls back without changing XHTML structure', async () => {
    iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts')
    const loaded = loadIframeDocument(iframe, src)
    iframe.dispatchEvent(new Event('load'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(src, { signal: expect.any(AbortSignal) })
    const inline = new DOMParser().parseFromString(iframe.srcdoc, 'text/html')
    expect(inline.querySelector('#empty')?.children).toHaveLength(0)
    expect(inline.querySelector('#sentence')?.parentElement).toBe(inline.body)
    expect(inline.querySelector('svg')?.namespaceURI).toBe('http://www.w3.org/2000/svg')
    expect(inline.querySelector('base')?.getAttribute('href')).toBe(src)
    expect(iframe.getAttribute('sandbox')).toBe('allow-same-origin allow-scripts')
    complete(src)
    expect(vi.getTimerCount()).toBe(1)
    complete('about:srcdoc')
    await expect(loaded).resolves.toBe(currentDocument)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not replace a chapter that has already navigated away from about:blank', async () => {
    const loaded = loadIframeDocument(iframe, src)
    Object.defineProperty(currentDocument, 'URL', { value: src, configurable: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).not.toHaveBeenCalled()
    complete(src)
    await expect(loaded).resolves.toBe(currentDocument)
  })

  it('preserves XHTML table nodes instead of saving CFIs against an inserted HTML tbody', async () => {
    const tableChapter = chapter.replace('<div id="empty"/>', '<table id="table"><tr><td>Text</td></tr></table>')
    fetchMock.mockResolvedValueOnce(new Response(tableChapter, { headers: { 'content-type': 'application/xhtml+xml' } }))
    const loaded = loadIframeDocument(iframe, src)
    await vi.advanceTimersByTimeAsync(1000)
    currentDocument = new DOMParser().parseFromString(iframe.srcdoc, 'text/html')
    expect(currentDocument.querySelector('tbody')).not.toBeNull()
    Object.defineProperty(currentDocument, 'URL', { value: 'about:srcdoc' })
    iframe.dispatchEvent(new Event('load'))
    const doc = await loaded
    expect(doc.querySelector('tbody')).toBeNull()
    expect(doc.querySelector('tr')?.parentElement).toBe(doc.querySelector('#table'))
    expect(doc.querySelector('#sentence')?.parentElement).toBe(doc.body)
  })

  it('cancels fallback work when the reader is destroyed', async () => {
    const controller = new AbortController()
    const loaded = loadIframeDocument(iframe, src, controller.signal)
    const rejected = loaded.catch((error: unknown) => error)
    controller.abort()
    expect(await rejected).toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects failed fallback fetches and removes its pending timers', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const loaded = loadIframeDocument(iframe, src)
    const rejected = loaded.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await rejected).toBeInstanceOf(TypeError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds waiting when even the inline document cannot load', async () => {
    const loaded = loadIframeDocument(iframe, src)
    const rejected = loaded.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await rejected).toMatchObject({ name: 'TimeoutError' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
