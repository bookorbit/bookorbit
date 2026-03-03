import { ref, shallowRef } from 'vue'
import type * as pdfjsLib from 'pdfjs-dist'
import type { Ref, ShallowRef } from 'vue'

export function usePdfThumbnails(pdfDoc: ShallowRef<pdfjsLib.PDFDocumentProxy | null>, totalPages: Ref<number>) {
  const thumbnails = ref(new Map<number, string>())
  const pending = new Set<number>()

  async function loadThumbnail(pageNum: number): Promise<void> {
    const doc = pdfDoc.value
    if (!doc || thumbnails.value.has(pageNum) || pending.has(pageNum)) return
    if (pageNum < 1 || pageNum > totalPages.value) return

    pending.add(pageNum)
    try {
      const page = await doc.getPage(pageNum)
      const vp = page.getViewport({ scale: 0.25 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(vp.width)
      canvas.height = Math.round(vp.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      await page.render({ canvasContext: ctx, viewport: vp }).promise
      page.cleanup()
      thumbnails.value = new Map(thumbnails.value).set(pageNum, canvas.toDataURL('image/jpeg', 0.7))
    } catch {
      // silently skip failed thumbnails
    } finally {
      pending.delete(pageNum)
    }
  }

  function loadRange(start: number, end: number) {
    const cap = totalPages.value
    for (let i = start; i <= Math.min(end, cap); i++) {
      loadThumbnail(i)
    }
  }

  return { thumbnails, loadThumbnail, loadRange }
}

