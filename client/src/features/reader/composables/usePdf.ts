import { onUnmounted, shallowRef, ref } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export type ZoomMode = 'fit-width' | 'fit-page' | 'custom'

export interface PageDim {
  width: number
  height: number
}

export function usePdf() {
  // shallowRef is critical — Vue's deep proxy breaks PDF.js internal state
  const pdfDoc = shallowRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const totalPages = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function load(fileId: number): Promise<void> {
    loading.value = true
    error.value = null
    try {
      // Pass URL directly so PDF.js can use HTTP range requests (206 Partial Content).
      // This avoids downloading the entire file upfront and allows rendering to start immediately.
      const doc = await pdfjsLib.getDocument({
        url: `/api/books/files/${fileId}/serve`,
        rangeChunkSize: 512 * 1024,
        disableAutoFetch: true,
      }).promise
      pdfDoc.value = doc
      totalPages.value = doc.numPages
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to load PDF'
    } finally {
      loading.value = false
    }
  }

  // Fetch ALL page natural dims in parallel (capped at 10 concurrent).
  async function getAllPageDims(): Promise<PageDim[]> {
    const doc = pdfDoc.value
    if (!doc) return []
    const total = doc.numPages
    const results: PageDim[] = new Array(total)
    const CONCURRENCY = 10

    async function fetchDim(i: number) {
      const page = await doc.getPage(i + 1)
      const vp = page.getViewport({ scale: 1 })
      page.cleanup()
      results[i] = { width: vp.width, height: vp.height }
    }

    for (let start = 0; start < total; start += CONCURRENCY) {
      const batch = Array.from({ length: Math.min(CONCURRENCY, total - start) }, (_, k) => fetchDim(start + k))
      await Promise.all(batch)
    }
    return results
  }

  async function renderPage(pageNum: number, canvas: HTMLCanvasElement, scale: number): Promise<void> {
    const doc = pdfDoc.value
    if (!doc) return
    const page = await doc.getPage(pageNum)
    const viewport = page.getViewport({ scale })
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvas, viewport }).promise
    page.cleanup()
  }

  async function getTextContent(pageNum: number) {
    const doc = pdfDoc.value
    if (!doc) return null
    const page = await doc.getPage(pageNum)
    const content = await page.getTextContent()
    const viewport = page.getViewport({ scale: 1 })
    page.cleanup()
    return { content, viewport }
  }

  onUnmounted(() => {
    pdfDoc.value?.destroy()
    pdfDoc.value = null
  })

  return { pdfDoc, totalPages, loading, error, load, getAllPageDims, renderPage, getTextContent }
}
