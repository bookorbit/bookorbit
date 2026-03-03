import { onUnmounted, shallowRef, ref } from 'vue'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl


export interface PageDim {
  width: number
  height: number
}

export interface CancellableRender {
  promise: Promise<void>
  cancel: () => void
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
        rangeChunkSize: 524288,
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

  function startRenderPage(pageNum: number, canvas: HTMLCanvasElement, scale: number): CancellableRender {
    let renderTask: pdfjsLib.RenderTask | null = null
    let cancelled = false

    const promise = (async () => {
      const doc = pdfDoc.value
      if (!doc || cancelled) return
      const page = await doc.getPage(pageNum)
      if (cancelled) {
        page.cleanup()
        return
      }
      const viewport = page.getViewport({ scale })
      canvas.width = viewport.width
      canvas.height = viewport.height
      renderTask = page.render({ canvas, viewport })
      try {
        await renderTask.promise
      } catch {
        // cancelled or interrupted — not an error
      } finally {
        page.cleanup()
      }
    })()

    return {
      promise,
      cancel() {
        cancelled = true
        renderTask?.cancel()
      },
    }
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

  return { pdfDoc, totalPages, loading, error, load, getPageDim, startRenderPage, getTextContent }
}
