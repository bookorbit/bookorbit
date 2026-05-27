import { onUnmounted, ref } from 'vue'
import { api, getAccessToken } from '@/lib/api'
import { useFoliateAnnotations } from './useFoliateAnnotations'
import { useFoliateSelection } from './useFoliateSelection'
import { useFoliateInput } from './useFoliateInput'
import type { EpubBookInfo } from '@bookorbit/types'

export interface RelocateDetail {
  cfi?: string | null
  fraction?: number
  index?: number
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

  async function open(bookId: number, fileId: number, format: string, cfi?: string | null, fallbackFraction?: number) {
    const el = container()
    if (!el) return

    loading.value = true
    error.value = null

    let loadTimeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      await loadScript()

      const view = document.createElement('foliate-view') as HTMLElement & {
        renderer: FoliateRenderer
        open: (file: File) => Promise<void>
        goTo: (target: string | number) => Promise<void>
        goToFraction?: (f: number) => void
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
      el.innerHTML = ''
      el.appendChild(view)
      viewRef.value = view

      // Safety timeout: if the 'load' event never fires (e.g. service worker or
      // iframe restrictions on iOS), clear the loading state with a helpful message
      // so the UI doesn't get stuck forever.

      view.addEventListener('load', (e: Event) => {
        const detail = (e as CustomEvent).detail
        clearTimeout(loadTimeoutId)
        loading.value = false
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

      view.addEventListener('relocate', (e: Event) => {
        const detail = (e as CustomEvent).detail
        fraction.value = detail?.fraction ?? 0
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

      if (format === 'epub') {
        const infoRes = await api(`/api/v1/epub/${bookId}/info?fileId=${fileId}`)
        if (!infoRes.ok) throw new Error(`Failed to fetch EPUB info: ${infoRes.status}`)
        const bookInfo = await infoRes.json()
        const rawLang = (bookInfo as EpubBookInfo)?.metadata?.language
        bookLanguage.value = typeof rawLang === 'string' && rawLang ? (rawLang.split('-')[0] ?? 'en').toLowerCase() : 'en'
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const makeStreamingBook = (window as any).makeStreamingBook as
          | ((id: number, base: string, info: unknown, token: string | null, bookType: null, fileId: number) => Promise<unknown>)
          | undefined
        if (!makeStreamingBook) throw new Error('makeStreamingBook not available')
        const book = await makeStreamingBook(bookId, '/api/v1/epub', bookInfo, getAccessToken(), null, fileId)
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
      if (cfi) {
        await view.goTo(cfi).catch(() => {})
      } else if (fallbackFraction !== undefined && fallbackFraction > 0) {
        view.goToFraction?.(fallbackFraction)
      } else {
        await view.goTo(0).catch(() => {})
      }
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
          goTo?: (t: string | number) => Promise<void>
          goToFraction?: (f: number) => void
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
    view: viewRef,
    open: (bookId: number, fileId: number, format: string, cfi?: string | null, fallbackFraction?: number) =>
      open(bookId, fileId, format, cfi, fallbackFraction),
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
    setTextSelectedHandler: selection.setHandler,
  }
}
