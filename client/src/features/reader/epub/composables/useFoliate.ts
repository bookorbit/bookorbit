import { onUnmounted, ref } from 'vue'
import { api, getAccessToken } from '@/lib/api'
import { useFoliateAnnotations } from './useFoliateAnnotations'
import { useFoliateSelection } from './useFoliateSelection'
import { useFoliateInput } from './useFoliateInput'

export interface RelocateDetail {
  cfi?: string | null
  fraction?: number
  index?: number
  total?: number
  tocItem?: { label?: string; href?: string }
}

export interface FoliateRenderer {
  heads?: HTMLElement[]
  feet?: HTMLElement[]
  setStyles?: (css: string) => void
  setAttribute: (name: string, value: string) => void
  removeAttribute: (name: string) => void
  getContents?: () => { index: number }[]
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

  async function open(bookId: number, fileId: number, format: string, cfi?: string | null) {
    const el = container()
    if (!el) return

    loading.value = true
    error.value = null

    try {
      await loadScript()

      const view = document.createElement('foliate-view') as HTMLElement & {
        renderer: FoliateRenderer
        open: (file: File) => Promise<void>
        goTo: (target: string | number) => Promise<void>
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

      view.addEventListener('load', (e: Event) => {
        const detail = (e as CustomEvent).detail
        loading.value = false
        if (onApplyStyles) onApplyStyles(view.renderer)
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
        error.value = detail?.message ?? 'Reader error'
        loading.value = false
      })

      if (format === 'epub') {
        const infoRes = await api(`/api/v1/epub/${bookId}/info`)
        if (!infoRes.ok) throw new Error(`Failed to fetch EPUB info: ${infoRes.status}`)
        const bookInfo = await infoRes.json()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const makeStreamingBook = (window as any).makeStreamingBook as
          | ((id: number, base: string, info: unknown, token: string | null) => Promise<unknown>)
          | undefined
        if (!makeStreamingBook) throw new Error('makeStreamingBook not available')
        const book = await makeStreamingBook(bookId, '/api/v1/epub', bookInfo, getAccessToken())
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
      await view.goTo(cfi ?? 0).catch(() => {})
    } catch (e) {
      console.error('[useFoliate]', e)
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
          book?: { toc?: unknown[] }
          renderer?: FoliateRenderer
          destroy?: () => void
        })
      | null
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
    view: viewRef,
    open: (bookId: number, fileId: number, format: string, cfi?: string | null) => open(bookId, fileId, format, cfi),
    prev: () => getViewEl()?.prev?.(),
    next: () => getViewEl()?.next?.(),
    goTo: (t: string | number) => getViewEl()?.goTo?.(t),
    goToFraction: (f: number) => getViewEl()?.goToFraction?.(f),
    goToSection: (i: number) => getViewEl()?.goTo?.(i),
    getSectionFractions: (): number[] => getViewEl()?.getSectionFractions?.() ?? [],
    getChapters: (): unknown[] => getViewEl()?.book?.toc ?? [],
    getRenderer: (): FoliateRenderer | null => getViewEl()?.renderer ?? null,
    addAnnotation: (cfi: string, color = '#FACC15', style = 'highlight') => annotations.addAnnotation(viewRef.value, cfi, color, style),
    addAnnotations: (anns: { cfi: string; color: string; style: string }[]) => annotations.addAnnotations(viewRef.value, anns),
    deleteAnnotation: (cfi: string) => annotations.deleteAnnotation(viewRef.value, cfi),
    setTextSelectedHandler: selection.setHandler,
  }
}
