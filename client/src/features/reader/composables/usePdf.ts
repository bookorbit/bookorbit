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
      const doc = await pdfjsLib.getDocument({
        url: `/api/v1/books/files/${fileId}/serve`,
        rangeChunkSize: 65536,
        disableStream: true,
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

  async function getPageDim(pageNum: number): Promise<PageDim> {
    const doc = pdfDoc.value
    if (!doc) return { width: 595, height: 842 }
    const page = await doc.getPage(pageNum)
    const vp = page.getViewport({ scale: 1 })
    page.cleanup()
    return { width: vp.width, height: vp.height }
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

  return { pdfDoc, totalPages, loading, error, load, getPageDim, renderPage, getTextContent }
}
