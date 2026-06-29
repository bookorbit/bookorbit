import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(),
}))

vi.mock('../useFoliateAnnotations', () => ({
  useFoliateAnnotations: () => ({
    annotationStyleMap: new Map(),
    addAnnotation: vi.fn<() => void>(),
    addAnnotations: vi.fn<() => void>(),
    deleteAnnotation: vi.fn<() => void>(),
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

vi.mock('../useFoliateInput', () => ({
  useFoliateInput: () => ({
    cleanup: vi.fn<() => void>(),
    attachIframeClicks: vi.fn<() => void>(),
  }),
}))

import { api } from '@/lib/api'
import { useFoliate } from '../useFoliate'

describe('useFoliate.open', () => {
  let container: HTMLDivElement
  let mockGoTo: ReturnType<typeof vi.fn>
  let mockGoToFraction: ReturnType<typeof vi.fn>
  let includeGoToFraction: boolean

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)

    mockGoTo = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    mockGoToFraction = vi.fn<() => void>()
    includeGoToFraction = true

    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'foliate-view') {
        const el = originalCreateElement('div')
        const view = {
          open: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
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
    expect(makeStreamingBook).toHaveBeenCalledWith(1, '/api/v1/epub', {}, api, null, 2)
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
})
