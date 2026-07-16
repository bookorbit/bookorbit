import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  getAccessToken: vi.fn<() => string | null>(),
}))

vi.mock('../useFoliateAnnotations', () => ({
  useFoliateAnnotations: () => ({
    annotationStyleMap: new Map(),
    addAnnotation: vi.fn<() => void>(),
    addAnnotations: vi.fn<() => void>(),
    deleteAnnotation: vi.fn<() => void>(),
    redrawAnnotation: vi.fn<() => void>(),
    reAddAll: vi.fn<() => void>(),
    handleDrawAnnotationEvent: vi.fn<() => void>(),
  }),
}))

vi.mock('../useFoliateSelection', () => ({
  useFoliateSelection: () => ({
    setHandler: vi.fn<() => void>(),
    handleSelectionEnd: vi.fn<() => void>(),
    handleSelectionChange: vi.fn<() => void>(),
  }),
}))

const inputMock = vi.hoisted(() => ({
  cleanup: vi.fn<() => void>(),
  attachIframeClicks: vi.fn<() => void>(),
  suppressNextTapNavigation: vi.fn<() => void>(),
}))

vi.mock('../useFoliateInput', () => ({
  useFoliateInput: () => inputMock,
}))

import { api, getAccessToken } from '@/lib/api'
import { useFoliate } from '../useFoliate'

describe('useFoliate.open', () => {
  let container: HTMLDivElement
  let mockOpen: ReturnType<typeof vi.fn>
  let mockGoTo: ReturnType<typeof vi.fn>
  let mockGoToFraction: ReturnType<typeof vi.fn>
  let includeGoToFraction: boolean
  let viewEl: HTMLElement | null

  beforeEach(() => {
    inputMock.cleanup.mockReset()
    inputMock.attachIframeClicks.mockReset()
    inputMock.suppressNextTapNavigation.mockReset()

    container = document.createElement('div')
    document.body.appendChild(container)

    mockOpen = vi.fn<(book?: unknown) => Promise<void>>().mockResolvedValue(undefined)
    mockGoTo = vi.fn<(target?: unknown) => Promise<unknown>>().mockResolvedValue({ index: 0 })
    mockGoToFraction = vi.fn<(fraction?: unknown) => Promise<void>>().mockResolvedValue(undefined)
    includeGoToFraction = true
    viewEl = null

    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'foliate-view') {
        const el = originalCreateElement('div')
        viewEl = el
        const view = {
          open: mockOpen,
          goTo: mockGoTo,
          renderer: {
            setAttribute: vi.fn<(name: string, value: string) => void>(),
            removeAttribute: vi.fn<(name: string) => void>(),
          },
          destroy: vi.fn<() => void>(),
        } as Record<string, unknown>
        if (includeGoToFraction) view.goToFraction = mockGoToFraction
        Object.assign(el, view)
        return el
      }
      return originalCreateElement(tag)
    })

    vi.spyOn(customElements, 'get').mockReturnValue(class {} as CustomElementConstructor)

    vi.mocked(api).mockResolvedValue({
      ok: true,
      json: vi.fn<() => Promise<unknown>>().mockResolvedValue({}),
    } as unknown as Response)
    vi.mocked(getAccessToken).mockReturnValue('reader-token')
    ;(window as { makeStreamingBook?: unknown }).makeStreamingBook = vi
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({ type: 'book' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    container.remove()
    delete (window as { makeStreamingBook?: unknown }).makeStreamingBook
  })

  it('navigates to CFI when cfi is provided', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', 'epubcfi(/6/2!)', undefined)

    expect(mockGoTo).toHaveBeenCalledWith('epubcfi(/6/2!)')
    expect(mockGoToFraction).not.toHaveBeenCalled()
  })

  it('passes the authenticated api fetcher to the streaming book loader', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 2, 'epub', null, undefined)

    const makeStreamingBook = (window as unknown as { makeStreamingBook: ReturnType<typeof vi.fn> }).makeStreamingBook
    expect(makeStreamingBook).toHaveBeenCalledWith(1, '/api/v1/epub', {}, expect.any(Function), null, 2)
    const fetchFile = makeStreamingBook.mock.calls[0]![3] as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    await fetchFile('/api/v1/epub/1/file/chapter.xhtml')
    expect(api).toHaveBeenCalledWith('/api/v1/epub/1/file/chapter.xhtml', undefined)
  })

  it('passes a token-stringable fetcher for old cached Foliate assets', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 2, 'epub', null, undefined)

    const makeStreamingBook = (window as unknown as { makeStreamingBook: ReturnType<typeof vi.fn> }).makeStreamingBook
    const fetchFile = makeStreamingBook.mock.calls[0]![3] as { toString: () => string; [Symbol.toPrimitive]: () => string }
    expect(String(fetchFile)).toBe('reader-token')
    vi.mocked(getAccessToken).mockReturnValue('fresh-reader-token')
    expect(`${fetchFile}`).toBe('fresh-reader-token')
  })

  it('forces fixed-layout EPUB spreads off before opening when requested', async () => {
    const book = { type: 'book', rendition: { layout: 'pre-paginated', spread: 'both' } }
    ;(window as unknown as { makeStreamingBook: ReturnType<typeof vi.fn> }).makeStreamingBook.mockResolvedValueOnce(book)
    const foliate = useFoliate(() => container)

    await foliate.open(1, 2, 'epub', null, undefined, { fixedLayoutSpread: 'none' })

    expect(book.rendition).toMatchObject({ layout: 'pre-paginated', spread: 'none' })
    expect(mockOpen).toHaveBeenCalledWith(book)
  })

  it('leaves EPUB spread metadata unchanged when fixed-layout spread mode is auto', async () => {
    const book = { type: 'book', rendition: { layout: 'pre-paginated', spread: 'both' } }
    ;(window as unknown as { makeStreamingBook: ReturnType<typeof vi.fn> }).makeStreamingBook.mockResolvedValueOnce(book)
    const foliate = useFoliate(() => container)

    await foliate.open(1, 2, 'epub', null, undefined, { fixedLayoutSpread: 'auto' })

    expect(book.rendition).toMatchObject({ layout: 'pre-paginated', spread: 'both' })
    expect(mockOpen).toHaveBeenCalledWith(book)
  })

  it('does not apply fixed-layout spread options to reflowable EPUBs', async () => {
    const book = { type: 'book', rendition: { layout: 'reflowable', spread: 'auto' } }
    ;(window as unknown as { makeStreamingBook: ReturnType<typeof vi.fn> }).makeStreamingBook.mockResolvedValueOnce(book)
    const foliate = useFoliate(() => container)

    await foliate.open(1, 2, 'epub', null, undefined, { fixedLayoutSpread: 'none' })

    expect(book.rendition).toMatchObject({ layout: 'reflowable', spread: 'auto' })
    expect(foliate.isFixedLayout.value).toBe(false)
  })

  it('tracks whether the opened EPUB is fixed-layout', async () => {
    const book = { type: 'book', rendition: { layout: 'pre-paginated', spread: 'auto' } }
    ;(window as unknown as { makeStreamingBook: ReturnType<typeof vi.fn> }).makeStreamingBook.mockResolvedValueOnce(book)
    const foliate = useFoliate(() => container)

    await foliate.open(1, 2, 'epub', null, undefined)

    expect(foliate.isFixedLayout.value).toBe(true)
  })

  it('restores fixed-layout EPUBs by fraction instead of CFI', async () => {
    const book = { type: 'book', rendition: { layout: 'pre-paginated', spread: 'auto' } }
    ;(window as unknown as { makeStreamingBook: ReturnType<typeof vi.fn> }).makeStreamingBook.mockResolvedValueOnce(book)
    const foliate = useFoliate(() => container)

    await foliate.open(1, 2, 'epub', 'epubcfi(/6/14)', 0.69)

    expect(mockGoTo).not.toHaveBeenCalledWith('epubcfi(/6/14)')
    expect(mockGoToFraction).toHaveBeenCalledWith(0.69)
  })

  it('navigates to fallback fraction when cfi is null and fraction > 0', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', null, 0.42)

    expect(mockGoTo).not.toHaveBeenCalled()
    expect(mockGoToFraction).toHaveBeenCalledWith(0.42)
  })

  it('falls back to position 0 when fallback fraction navigation is unavailable', async () => {
    includeGoToFraction = false
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', null, 0.42)

    expect(mockGoToFraction).not.toHaveBeenCalled()
    expect(mockGoTo).toHaveBeenCalledWith(0)
  })

  it('navigates to position 0 when cfi is null and fraction is 0', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', null, 0)

    expect(mockGoTo).toHaveBeenCalledWith(0)
    expect(mockGoToFraction).not.toHaveBeenCalled()
  })

  it('navigates to position 0 when cfi is null and fraction is undefined', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', null, undefined)

    expect(mockGoTo).toHaveBeenCalledWith(0)
    expect(mockGoToFraction).not.toHaveBeenCalled()
  })

  it('gracefully handles goTo rejection without propagating', async () => {
    mockGoTo.mockRejectedValue(new Error('invalid CFI'))
    const foliate = useFoliate(() => container)

    await expect(foliate.open(1, 1, 'epub', 'epubcfi(/bad)', undefined)).resolves.toBeUndefined()
  })

  it('falls back to fraction when CFI navigation rejects', async () => {
    mockGoTo.mockRejectedValue(new Error('invalid CFI'))
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', 'epubcfi(/bad)', 0.42)

    expect(mockGoTo).toHaveBeenCalledWith('epubcfi(/bad)')
    expect(mockGoToFraction).toHaveBeenCalledWith(0.42)
  })

  it('falls back to fraction when CFI navigation resolves without opening a target', async () => {
    mockGoTo.mockResolvedValueOnce(undefined)
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', 'epubcfi(/bad)', 0.42)

    expect(mockGoTo).toHaveBeenCalledWith('epubcfi(/bad)')
    expect(mockGoToFraction).toHaveBeenCalledWith(0.42)
  })

  it('does not call goTo or goToFraction when container is null', async () => {
    const foliate = useFoliate(() => null)

    await foliate.open(1, 1, 'epub', 'epubcfi(/6/2!)', 0.5)

    expect(mockGoTo).not.toHaveBeenCalled()
    expect(mockGoToFraction).not.toHaveBeenCalled()
  })

  it('prefers cfi over fallback fraction when both are provided', async () => {
    const foliate = useFoliate(() => container)

    await foliate.open(1, 1, 'epub', 'epubcfi(/6/4!)', 0.75)

    expect(mockGoTo).toHaveBeenCalledWith('epubcfi(/6/4!)')
    expect(mockGoToFraction).not.toHaveBeenCalled()
  })

  it('suppresses tap navigation when an annotation is shown', async () => {
    const foliate = useFoliate(() => container)
    const onAnnotationClick = vi.fn<(cfi: string, popupPosition: { x: number; y: number; showBelow: boolean }) => void>()
    foliate.setAnnotationClickHandler(onAnnotationClick)

    await foliate.open(1, 1, 'epub', null, undefined)
    viewEl?.dispatchEvent(new CustomEvent('show-annotation', { detail: { value: 'epubcfi(/6/4)' } }))

    expect(inputMock.suppressNextTapNavigation).toHaveBeenCalledTimes(1)
    expect(onAnnotationClick).toHaveBeenCalledWith('epubcfi(/6/4)', expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }))
    expect(inputMock.suppressNextTapNavigation.mock.invocationCallOrder[0]!).toBeLessThan(onAnnotationClick.mock.invocationCallOrder[0]!)
  })
})
