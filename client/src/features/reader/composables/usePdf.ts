import { onUnmounted, ref } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type ZoomMode = 'fit-width' | 'fit-page' | 'custom'

// Renders one page onto the given canvas at the given scale (pdfjs-dist v5 API).
async function renderPageToCanvas(doc: pdfjsLib.PDFDocumentProxy, pageNum: number, canvas: HTMLCanvasElement, scale: number) {
  const page = await doc.getPage(pageNum)
  const viewport = page.getViewport({ scale })
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvas, viewport }).promise
  page.cleanup()
}

export function usePdf() {
  const pdfDoc = ref<pdfjsLib.PDFDocumentProxy | null>(null)
  const totalPages = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(fileId: number) {
    loading.value = true
    error.value = null
    try {
      const res = await fetch(`/api/books/files/${fileId}/serve`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.arrayBuffer()
      const doc = await pdfjsLib.getDocument({ data }).promise
      pdfDoc.value = doc
      totalPages.value = doc.numPages
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load PDF'
    } finally {
      loading.value = false
    }
  }

  // Returns the natural width/height of a page at scale=1 (used to size placeholder divs).
  async function getPageViewport(pageNum: number, scale: number) {
    if (!pdfDoc.value) return null
    const page = await pdfDoc.value.getPage(pageNum)
    const vp = page.getViewport({ scale })
    page.cleanup()
    return vp
  }

  onUnmounted(() => {
    pdfDoc.value?.destroy()
    pdfDoc.value = null
  })

  return { pdfDoc, totalPages, loading, error, load, renderPageToCanvas, getPageViewport }
}
