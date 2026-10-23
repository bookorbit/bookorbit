import { computed, ref } from 'vue'
import { api } from '@/lib/api'
import { jsonBody } from '@/lib/api-json'

export interface Bookmark {
  id: number
  bookId: number
  cfi: string | null
  title: string
  note?: string | null
  createdAt: string
}

export interface BookmarkPatch {
  title: string
  note: string | null
}

async function send(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await (init ? api(path, init) : api(path))
  } catch {
    return null
  }
}

export function useBookmarks() {
  const bookmarks = ref<Bookmark[]>([])
  const currentCfi = ref<string | null>(null)
  const loadError = ref<string | null>(null)

  const isCurrentCfiBookmarked = computed(() => {
    if (!currentCfi.value) return false
    return bookmarks.value.some((b) => b.cfi === currentCfi.value)
  })

  function setCfi(cfi: string | null) {
    currentCfi.value = cfi
  }

  async function load(bookId: number, readerFileId?: number) {
    loadError.value = null
    const res = await send(`/api/v1/books/${bookId}/bookmarks${readerFileId != null ? `?readerFileId=${readerFileId}` : ''}`)
    if (!res?.ok) {
      loadError.value = 'Failed to load'
      return
    }
    bookmarks.value = await res.json()
  }

  async function toggle(bookId: number, cfi: string, title: string, bookFileId?: number): Promise<boolean> {
    const existing = bookmarks.value.find((b) => b.cfi === cfi)
    if (existing) return remove(bookId, existing.id)

    const res = await send(`/api/v1/books/${bookId}/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cfi, title, ...(bookFileId != null ? { bookFileId } : {}) }),
    })
    if (!res?.ok) return false
    const created: Bookmark = await res.json()
    bookmarks.value = [...bookmarks.value, created]
    return true
  }

  // Both fields are always sent: an omitted note would leave the old one in place.
  async function update(bookId: number, bookmarkId: number, patch: BookmarkPatch): Promise<boolean> {
    const res = await send(`/api/v1/books/${bookId}/bookmarks/${bookmarkId}`, jsonBody('PATCH', patch))
    if (!res?.ok) return false
    const updated: Bookmark = await res.json()
    bookmarks.value = bookmarks.value.map((b) => (b.id === bookmarkId ? { ...b, title: updated.title, note: updated.note ?? null } : b))
    return true
  }

  async function remove(bookId: number, bookmarkId: number): Promise<boolean> {
    const res = await send(`/api/v1/books/${bookId}/bookmarks/${bookmarkId}`, {
      method: 'DELETE',
    })
    if (!res?.ok) return false
    bookmarks.value = bookmarks.value.filter((b) => b.id !== bookmarkId)
    return true
  }

  return {
    bookmarks,
    isCurrentCfiBookmarked,
    currentCfi,
    loadError,
    setCfi,
    load,
    toggle,
    update,
    remove,
  }
}
