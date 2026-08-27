import { ref } from 'vue'
import type { AnnotationItem, AnnotationPdfPosition } from '@bookorbit/types'
import { api } from '@/lib/api'

export interface PdfAnnotationPatch {
  note?: string | null
  color?: string
  style?: string
}

export interface CreatePdfAnnotationInput {
  pdf: AnnotationPdfPosition
  bookFileId: number
  text: string
  color: string
  style: string
  note?: string | null
}

/**
 * REST client and reactive store for a book's annotations, scoped to the PDF
 * reader. Talks to the same `/books/:bookId/annotations` endpoints as the EPUB
 * reader; only the create payload carries a PDF position instead of a CFI.
 */
export function usePdfAnnotations(bookId: number) {
  const annotations = ref<AnnotationItem[]>([])
  const loadError = ref<string | null>(null)

  async function load() {
    loadError.value = null
    const res = await api(`/api/v1/books/${bookId}/annotations`)
    if (!res.ok) {
      loadError.value = 'Failed to load'
      return
    }
    annotations.value = await res.json()
  }

  async function create(input: CreatePdfAnnotationInput): Promise<AnnotationItem | null> {
    const res = await api(`/api/v1/books/${bookId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) return null
    const created: AnnotationItem = await res.json()
    annotations.value = [...annotations.value, created]
    return created
  }

  async function update(id: number, patch: PdfAnnotationPatch): Promise<AnnotationItem | null> {
    const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return null
    const updated: AnnotationItem = await res.json()
    annotations.value = annotations.value.map((a) => (a.id === id ? updated : a))
    return updated
  }

  async function remove(id: number): Promise<boolean> {
    const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, { method: 'DELETE' })
    if (!res.ok) return false
    annotations.value = annotations.value.filter((a) => a.id !== id)
    return true
  }

  return { annotations, loadError, load, create, update, remove }
}
