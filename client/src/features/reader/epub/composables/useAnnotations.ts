import { ref } from 'vue'
import type { AnnotationItem } from '@bookorbit/types'
import { api } from '@/lib/api'

export type Annotation = AnnotationItem

export function useAnnotations() {
  const annotations = ref<Annotation[]>([])
  const loadError = ref<string | null>(null)

  async function load(bookId: number) {
    loadError.value = null
    const res = await api(`/api/v1/books/${bookId}/annotations`)
    if (!res.ok) {
      loadError.value = 'Failed to load'
      return
    }
    annotations.value = await res.json()
  }

  async function create(
    bookId: number,
    data: { cfi: string; bookFileId?: number; text: string; color: string; style: string; note?: string | null; chapterTitle?: string | null },
  ): Promise<Annotation | null> {
    const res = await api(`/api/v1/books/${bookId}/annotations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) return null
    const created: Annotation = await res.json()
    annotations.value = [...annotations.value, created]
    return created
  }

  async function updateNote(bookId: number, id: number, note: string | null) {
    const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    })
    if (res.ok) {
      const updated: Annotation = await res.json()
      annotations.value = annotations.value.map((a) => (a.id === id ? updated : a))
    }
  }

  async function remove(bookId: number, id: number) {
    const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      annotations.value = annotations.value.filter((a) => a.id !== id)
    }
  }

  return { annotations, loadError, load, create, updateNote, remove }
}
