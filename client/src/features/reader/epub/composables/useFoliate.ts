import { onUnmounted, ref } from 'vue'
import { api, getAccessToken } from '@/lib/api'
import { useFoliateAnnotations } from './useFoliateAnnotations'
import { useFoliateSelection } from './useFoliateSelection'
import { useFoliateInput } from './useFoliateInput'
import type { EpubBookInfo, EpubReaderSettings } from '@bookorbit/types'

export interface RelocateDetail {
  cfi?: string | null
  fraction?: number
  index?: number
  source?: string | null
  koboLocationType?: string | null
  koboLocationValue?: string | null
  contentSourceProgressPercent?: number | null
  koreaderProgress?: string | null
  total?: number
  tocItem?: { label?: string; href?: string }
  section?: { current: number; total: number }
  location?: { current: number; next: number; total: number }
  time?: { section: number; total: number }
}

export interface FoliateRenderer {
  heads?: HTMLElement[]
  feet?: HTMLElement[]
  setStyles?: (css: string) => void
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
  getContents?: () => { index: number }[]
}

export interface FoliateLocationContext {
  chapterTitle: string | null
  fraction: number | null
}

export interface EpubOpenOptions {
  fixedLayoutSpread?: EpubReaderSettings['fixedLayoutSpread']
}

type FoliateFetchFile = ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) & {
  toString: () => string
  [Symbol.toPrimitive]: () => string
}

function isResolvedNavigation(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && typeof (value as { index?: unknown }).index === 'number')
}

function isFixedLayoutBook(book: unknown): boolean {
  return Boolean(book && typeof book === 'object' && (book as { rendition?: { layout?: unknown } }).rendition?.layout === 'pre-paginated')
}

function applyEpubOpenOptions(book: unknown, options: EpubOpenOptions | undefined) {
  if (!book || typeof book !== 'object') return
  if (options?.fixedLayoutSpread !== 'none') return
  if (!isFixedLayoutBook(book)) return

  const epubBook = book as { rendition?: Record<string, unknown> }
  epubBook.rendition = {
    ...epubBook.rendition,
    spread: 'none',
  }
}

function makeFoliateFetchFile(): FoliateFetchFile {
  const fetchFile = ((input: RequestInfo | URL, init?: RequestInit) => api(input, init)) as FoliateFetchFile
  const currentToken = () => getAccessToken() ?? ''
  fetchFile.toString = currentToken
  fetchFile[Symbol.toPrimitive] = currentToken
  return fetchFile
}

export function useFoliate(
  container: () => HTMLElement | null,
  onRelocate?: (detail: RelocateDetail) => void,
  onApplyStyles?: (renderer: FoliateRenderer) => void,
  onMiddleTap?: () => void,
) {
  const loading = ref(false)
  const error = ref<string | null>(null)
  const fraction = ref(0)
  const viewRef = ref<unknown>(null)
  const bookLanguage = ref<string>('en')
  const isFixedLayout = ref(false)

  let onAnnotationClick: ((cfi: string, popupPosition: { x: number; y: number; showBelow: boolean }) => void) | null = null

  function setAnnotationClickHandler(fn: (cfi: string, popupPosition: { x: number; y: number; showBelow: boolean }) => void) {
    onAnnotationClick = fn
  }

  const annotations = useFoliateAnnotations()
  const selection = useFoliateSelection(() => viewRef.value)
  const input = useFoliateInput(() => viewRef.value, onMiddleTap, selection.handleSelectionEnd, selection.handleSelectionChange)

  async function loadScript() {
    if (customElements.get('foliate-view')) return
    const src = import.meta.env.DEV ? `/assets/foliate/view.js?v=${Date.now()}` : '/assets/foliate/view.js'
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.type = 'module'
      script.src = src
      script.onload = () => setTimeout(resolve, 100)
      script.onerror = () => reject(new Error('Failed to load foliate/view.js'))
      document.head.appendChild(script)
    })
    await customElements.whenDefined('foliate-view')
  }

  async function open(bookId: number, fileId: number, format: string, cfi?: string | null, fallbackFraction?: number, options?: EpubOpenOptions) {
    const el = container()
    if (!el) return

    loading.value = true
    error.value = null
    isFixedLayout.value = false

    let loadTimeoutId: ReturnType<typeof setTimeout> | undefined
    let initialNavigationPending = true

    try {
      await loadScript()

      const view = document.createElement('foliate-view') as HTMLElement & {
        renderer: FoliateRenderer
        open: (file: File) => Promise<void>
        goTo: (target: string | number) => Promise<unknown>
        goToFraction?: (f: number) => void | Promise<void>
        book?: { toc?: unknown[] }
        getSectionFractions?: () => number[]
        prev?: () => void
        next?: () => void
        destroy?: () => void
        getCFI?: (index: number, range: Range) => string | null
        addAnnotation?: (ann: { value: string }) => void
        deleteAnnotation?: (ann: { value: string }) => void
        search?: (opts: { query: string }) => AsyncIterable<unknown>
        clearSearch?: () => void
      }
      view.style.cssText = 'width:100%;height:100%;display:block;'
      getViewEl()?.destroy?.()
      el.innerHTML = ''
      el.appendChild(view)
      viewRef.value = view

      // Safety timeout: if the 'load' event never fires (e.g. service worker or
      // iframe restrictions on iOS), clear the loading state with a helpful message
      // so the UI doesn't get stuck forever.

      view.addEventListener('load', (e: Event) => {
        const detail = (e as CustomEvent).detail
        clearTimeout(loadTimeoutId)
        if (!initialNavigationPending) {
          loading.value = false
        }
        // The paginator's internal #view reference is updated in a microtask after the
        // 'load' event fires. Deferring to a macrotask ensures setStyles targets the
        // new chapter document, not the previous one.
        setTimeout(() => {
          if (onApplyStyles) onApplyStyles(view.renderer)
        }, 0)
        annotations.reAddAll(view)
        if (detail?.doc) input.attachIframeClicks(detail.doc)
      })

      view.addEventListener('draw-annotation', (e: Event) => {
        annotations.handleDrawAnnotationEvent(e as CustomEvent)
      })

      view.addEventListener('show-annotation', (e: Event) => {
        const detail = (e as CustomEvent).detail
        if (!detail?.value || !onAnnotationClick) return

        input.suppressNextTapNavigation()

        const range = detail.range as Range | undefined
        let x = window.innerWidth / 2
        let selectionTop = 0
        let selectionBottom = 100

        if (range) {
          const rangeRect = range.getBoundingClientRect()
          const doc = range.startContainer.ownerDocument
          const iframe = doc?.defaultView?.frameElement as HTMLIFrameElement | null
          if (iframe) {
            const iframeRect = iframe.getBoundingClientRect()
            x = iframeRect.left + rangeRect.left + rangeRect.width / 2
            selectionTop = iframeRect.top + rangeRect.top
            selectionBottom = iframeRect.top + rangeRect.bottom
          } else {
            x = rangeRect.left + rangeRect.width / 2
            selectionTop = rangeRect.top
            selectionBottom = rangeRect.bottom
          }
        }

        const minSpaceAbove = 120
        const showBelow = selectionTop < minSpaceAbove
        const y = showBelow ? selectionBottom + 10 : selectionTop - 50
        const clampedX = Math.max(100, Math.min(x, window.innerWidth - 150))

        onAnnotationClick(detail.value as string, { x: clampedX, y, showBelow })
      })

      view.addEventListener('relocate', (e: Event) => {
        const detail = (e as CustomEvent).detail
        fraction.value = detail?.fraction ?? 0
        if (import.meta.env.DEV) {
          console.info('[foliate.relocate]', {
            source: detail?.source ?? null,
            koboLocationType: detail?.koboLocationType ?? null,
            koboLocationValue: detail?.koboLocationValue ?? null,
            contentSourceProgressPercent: detail?.contentSourceProgressPercent ?? null,
            koreaderProgress: detail?.koreaderProgress ?? null,
            fraction: detail?.fraction ?? null,
            cfi: detail?.cfi ?? null,
          })
        }
        onRelocate?.(detail)
      })

      view.addEventListener('error', (e: Event) => {
        const detail = (e as CustomEvent).detail
        console.error('[foliate] error event', detail)
        clearTimeout(loadTimeoutId)
        error.value = detail?.message ?? 'Reader error'
        loading.value = false
      })

      loadTimeoutId = setTimeout(() => {
        if (loading.value) {
          error.value = 'Could not open the book. Your browser may not fully support the reader. Try refreshing or using a different browser.'
          loading.value = false
        }
      }, 30_000)

      let shouldRestoreByFraction = false

      if (format === 'epub') {
        const infoRes = await api(`/api/v1/epub/${bookId}/info?fileId=${fileId}`)
        if (!infoRes.ok) throw new Error(`Failed to fetch EPUB info: ${infoRes.status}`)
        const bookInfo = await infoRes.json()
        const rawLang = (bookInfo as EpubBookInfo)?.metadata?.language
        bookLanguage.value = typeof rawLang === 'string' && rawLang ? (rawLang.split('-')[0] ?? 'en').toLowerCase() : 'en'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const makeStreamingBook = (window as any).makeStreamingBook as
          | ((
              id: number,
              base: string,
              info: unknown,
              fetchFile: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
              bookType: null,
              fileId: number,
            ) => Promise<unknown>)
          | undefined
        if (!makeStreamingBook) throw new Error('makeStreamingBook not available')
        const book = await makeStreamingBook(bookId, '/api/v1/epub', bookInfo, makeFoliateFetchFile(), null, fileId)
        applyEpubOpenOptions(book, options)
        shouldRestoreByFraction = isFixedLayoutBook(book)
        isFixedLayout.value = shouldRestoreByFraction
        await view.open(book as never)
      } else {
        const mimeType = format === 'pdf' ? 'application/pdf' : 'application/zip'
        const ext = format === 'pdf' ? 'pdf' : format === 'cbz' ? 'cbz' : format
        const res = await api(`/api/v1/books/files/${fileId}/serve`)
        if (!res.ok) throw new Error(`Failed to fetch book file: ${res.status}`)
        const blob = await res.blob()
        const file = new File([blob], `book-file-${fileId}.${ext}`, { type: mimeType })
        await view.open(file)
      }
      if (onApplyStyles) onApplyStyles(view.renderer)
      let didNavigate = false
      if (cfi && !shouldRestoreByFraction) {
        await view
          .goTo(cfi)
          .then((result) => {
            didNavigate = isResolvedNavigation(result)
          })
          .catch(() => {})
      }
      if (!didNavigate && fallbackFraction !== undefined && fallbackFraction > 0) {
        if (typeof view.goToFraction === 'function') {
          try {
            await view.goToFraction(fallbackFraction)
            didNavigate = true
          } catch {
            didNavigate = false
          }
        }
      }
      if (!didNavigate) {
        await view.goTo(0).catch(() => {})
      }
      initialNavigationPending = false
      loading.value = false
    } catch (e) {
      console.error('[useFoliate]', e)
      clearTimeout(loadTimeoutId)
      error.value = e instanceof Error ? e.message : 'Failed to open book'
      loading.value = false
    }
  }

  function getViewEl() {
    return viewRef.value as
      | (ReturnType<typeof document.createElement> & {
          prev?: () => void
          next?: () => void
          goTo?: (t: string | number) => Promise<unknown>
          goToFraction?: (f: number) => void | Promise<void>
          getSectionFractions?: () => number[]
          resolveNavigation?: (target: string | number) => { index?: number } | Promise<{ index?: number }>
          getTOCItemOf?: (target: string | number) => Promise<{ label?: string } | null>
          book?: { toc?: unknown[] }
          renderer?: FoliateRenderer
          destroy?: () => void
        })
      | null
  }

  async function getLocationContext(target: string): Promise<FoliateLocationContext> {
    const view = getViewEl()
    if (!view) return { chapterTitle: null, fraction: null }

    let chapterTitle: string | null = null
    let fraction: number | null = null

    try {
      const tocItem = await view.getTOCItemOf?.(target)
      const label = tocItem?.label
      chapterTitle = typeof label === 'string' && label.trim() ? label.trim() : null
    } catch {
      chapterTitle = null
    }

    try {
      const resolved = await Promise.resolve(view.resolveNavigation?.(target))
      const index = resolved?.index
      if (typeof index === 'number') {
        const fractions = view.getSectionFractions?.() ?? []
        const sectionFraction = fractions[index]
        if (typeof sectionFraction === 'number' && Number.isFinite(sectionFraction)) {
          fraction = Math.max(0, Math.min(1, sectionFraction))
        }
      }
    } catch {
      fraction = null
    }

    return { chapterTitle, fraction }
  }

  onUnmounted(() => {
    input.cleanup()
    getViewEl()?.destroy?.()
    viewRef.value = null
  })

  return {
    loading,
    error,
    fraction,
    bookLanguage,
    isFixedLayout,
    view: viewRef,
    open: (bookId: number, fileId: number, format: string, cfi?: string | null, fallbackFraction?: number, options?: EpubOpenOptions) =>
      open(bookId, fileId, format, cfi, fallbackFraction, options),
    prev: () => getViewEl()?.prev?.(),
    next: () => getViewEl()?.next?.(),
    goTo: (t: string | number) => getViewEl()?.goTo?.(t),
    goToFraction: (f: number) => getViewEl()?.goToFraction?.(f),
    goToSection: (i: number) => getViewEl()?.goTo?.(i),
    getSectionFractions: (): number[] => getViewEl()?.getSectionFractions?.() ?? [],
    getChapters: (): unknown[] => getViewEl()?.book?.toc ?? [],
    getRenderer: (): FoliateRenderer | null => getViewEl()?.renderer ?? null,
    getLocationContext: (target: string): Promise<FoliateLocationContext> => getLocationContext(target),
    addAnnotation: (cfi: string, color = '#FACC15', style = 'highlight') => annotations.addAnnotation(viewRef.value, cfi, color, style),
    addAnnotations: (anns: { cfi: string; color: string; style: string }[]) => annotations.addAnnotations(viewRef.value, anns),
    deleteAnnotation: (cfi: string) => annotations.deleteAnnotation(viewRef.value, cfi),
    redrawAnnotation: (cfi: string, color: string, style: string) => annotations.redrawAnnotation(viewRef.value, cfi, color, style),
    setTextSelectedHandler: selection.setHandler,
    setAnnotationClickHandler,
  }
}
