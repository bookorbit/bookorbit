import { ref, onUnmounted } from 'vue'
import { api } from '@/lib/api'

export function useBookCover(bookId: number, type: 'thumbnail' | 'cover' = 'thumbnail') {
  const src = ref<string | null>(null)
  const failed = ref(false)
  let objectUrl: string | null = null

  async function load() {
    try {
      const res = await api(`/api/books/${bookId}/${type}`)
      if (!res.ok) {
        failed.value = true
        return
      }
      const blob = await res.blob()
      objectUrl = URL.createObjectURL(blob)
      src.value = objectUrl
    } catch {
      failed.value = true
    }
  }

  onUnmounted(() => {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  })

  return { src, failed, load }
}
