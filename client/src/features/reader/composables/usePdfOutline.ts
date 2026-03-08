import { ref } from 'vue'
import type * as pdfjsLib from 'pdfjs-dist'
import type { ShallowRef } from 'vue'

export interface OutlineItem {
  title: string
  dest: string | unknown[] | null
  items: OutlineItem[]
  pageNum: number | null
  expanded: boolean
}

type PdfPageRef = Parameters<pdfjsLib.PDFDocumentProxy['getPageIndex']>[0]
type PdfOutline = NonNullable<Awaited<ReturnType<pdfjsLib.PDFDocumentProxy['getOutline']>>>

export function usePdfOutline(pdfDoc: ShallowRef<pdfjsLib.PDFDocumentProxy | null>) {
  const outline = ref<OutlineItem[]>([])
  const loading = ref(false)

  async function resolvePageNum(doc: pdfjsLib.PDFDocumentProxy, dest: string | unknown[] | null): Promise<number | null> {
    if (!dest) return null
    try {
      const resolved = typeof dest === 'string' ? await doc.getDestination(dest) : (dest as unknown[])
      if (!resolved || !resolved[0]) return null
      const pageIndex = await doc.getPageIndex(resolved[0] as PdfPageRef)
      return pageIndex + 1
    } catch {
      return null
    }
  }

  async function buildTree(doc: pdfjsLib.PDFDocumentProxy, raw: PdfOutline): Promise<OutlineItem[]> {
    const items: OutlineItem[] = []
    for (const node of raw) {
      const pageNum = await resolvePageNum(doc, node.dest)
      items.push({
        title: node.title ?? '(untitled)',
        dest: node.dest,
        pageNum,
        expanded: false,
        items: node.items?.length ? await buildTree(doc, node.items) : [],
      })
    }
    return items
  }

  async function load(): Promise<void> {
    const doc = pdfDoc.value
    if (!doc) return
    loading.value = true
    try {
      const raw = await doc.getOutline()
      outline.value = raw ? await buildTree(doc, raw) : []
    } finally {
      loading.value = false
    }
  }

  function toggleExpand(item: OutlineItem) {
    item.expanded = !item.expanded
  }

  return { outline, loading, load, toggleExpand }
}
