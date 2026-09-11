import { ref } from 'vue'
import type { AudiobookBookmark } from '@bookorbit/types'
import { api } from '@/lib/api'

export type AudioBookmark = AudiobookBookmark

export function useAudioBookmarks(bookId: number) {
  const bookmarks = ref<AudioBookmark[]>([])

  async function load() {
    const res = await api(`/api/v1/audiobooks/${bookId}/bookmarks`)
    if (!res.ok) return
    const data: AudioBookmark[] = await res.json()
    bookmarks.value = data.sort((a, b) => a.positionMs - b.positionMs)
  }

  async function add(positionSeconds: number, title: string, chapterId?: string): Promise<AudioBookmark | null> {
    const res = await api(`/api/v1/audiobooks/${bookId}/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: crypto.randomUUID(), positionMs: Math.round(positionSeconds * 1000), title, chapterId }),
    })
    if (!res.ok) return null
    const created: AudioBookmark = await res.json()
    bookmarks.value = [...bookmarks.value, created].sort((a, b) => a.positionMs - b.positionMs)
    return created
  }

  async function remove(bookmarkId: string) {
    const res = await api(`/api/v1/audiobooks/${bookId}/bookmarks/${bookmarkId}`, { method: 'DELETE' })
    if (res.ok) {
      bookmarks.value = bookmarks.value.filter((b) => b.id !== bookmarkId)
    }
  }

  return { bookmarks, load, add, remove }
}
