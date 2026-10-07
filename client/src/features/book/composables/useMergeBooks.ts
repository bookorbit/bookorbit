import { api } from '@/lib/api'

export function useMergeBooks() {
  async function mergeBooks(selectedBookIds: number[], targetBookId: number) {
    const result = await api('/api/v1/books/merge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceBookIds: selectedBookIds,
        targetBookId,
      }),
    })

    if (!result.ok) {
      const payload = await result.json().catch(() => null)
      throw new Error(payload?.message ?? 'book.merge.errors.failed')
    }

    return result.json()
  }

  return {
    mergeBooks,
  }
}
