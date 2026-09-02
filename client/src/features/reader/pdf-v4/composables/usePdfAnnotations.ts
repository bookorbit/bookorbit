import { computed, ref } from 'vue'
import type { AnnotationItem, AnnotationListResponse, AnnotationPdfPosition } from '@bookorbit/types'
import { api, getValidToken } from '@/lib/api'

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
const PAGE_SIZE = 100

export function usePdfAnnotations(bookId: number, bookFileId: number) {
  const annotations = ref<AnnotationItem[]>([])
  const total = ref(0)
  const loadError = ref(false)
  const loading = ref(false)
  const loadingMore = ref(false)
  const nextPage = ref(1)
  const hasMore = computed(() => annotations.value.length < total.value)
  let mutationRevision = 0

  async function fetchAnnotationPage(page: number): Promise<Response> {
    const token = await getValidToken()
    const headers = new Headers()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(annotationPageUrl(page), { headers, credentials: 'include' })
  }

  async function fetchStableAnnotationPage(pageNumber: number): Promise<AnnotationListResponse | null> {
    while (true) {
      const requestRevision = mutationRevision
      const res = await fetchAnnotationPage(pageNumber)
      if (!res.ok) return null
      const page: AnnotationListResponse = await res.json()
      if (requestRevision === mutationRevision) return page
    }
  }

  async function load() {
    if (loading.value) return false
    loading.value = true
    loadError.value = false
    annotations.value = []
    total.value = 0
    nextPage.value = 1
    try {
      const page = await fetchStableAnnotationPage(1)
      if (!page) {
        loadError.value = true
        return false
      }
      annotations.value = page.items
      total.value = page.total
      nextPage.value = 2
      return true
    } catch {
      loadError.value = true
      return false
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || loadingMore.value || !hasMore.value) return false
    loadingMore.value = true
    loadError.value = false
    try {
      const page = await fetchStableAnnotationPage(nextPage.value)
      if (!page) {
        loadError.value = true
        return false
      }
      const knownIds = new Set(annotations.value.map((annotation) => annotation.id))
      annotations.value = [...annotations.value, ...page.items.filter((annotation) => !knownIds.has(annotation.id))]
      total.value = page.total
      nextPage.value += 1
      return true
    } catch {
      loadError.value = true
      return false
    } finally {
      loadingMore.value = false
    }
  }

  function annotationPageUrl(page: number) {
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortBy: 'position',
      sortDir: 'asc',
      bookFileId: String(bookFileId),
    })
    return `/api/v1/books/${bookId}/annotations?${query.toString()}`
  }

  async function create(input: CreatePdfAnnotationInput): Promise<AnnotationItem | null> {
    try {
      const res = await api(`/api/v1/books/${bookId}/annotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!res.ok) return null
      const created: AnnotationItem = await res.json()
      annotations.value = [...annotations.value, created]
      total.value += 1
      mutationRevision += 1
      return created
    } catch {
      return null
    }
  }

  async function update(id: number, patch: PdfAnnotationPatch): Promise<AnnotationItem | null> {
    try {
      const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) return null
      const updated: AnnotationItem = await res.json()
      annotations.value = annotations.value.map((a) => (a.id === id ? updated : a))
      mutationRevision += 1
      return updated
    } catch {
      return null
    }
  }

  async function remove(id: number): Promise<boolean> {
    try {
      const res = await api(`/api/v1/books/${bookId}/annotations/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) return false
      annotations.value = annotations.value.filter((a) => a.id !== id)
      total.value = Math.max(0, total.value - 1)
      mutationRevision += 1
      return true
    } catch {
      return false
    }
  }

  return {
    annotations,
    total,
    loadError,
    loading,
    loadingMore,
    hasMore,
    load,
    loadMore,
    create,
    update,
    remove,
  }
}
