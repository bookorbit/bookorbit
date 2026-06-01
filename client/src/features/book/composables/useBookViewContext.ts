import { onMounted, watch, type Ref } from 'vue'
import type { BookCard } from '@bookorbit/types'
import { useBookNavigation } from './useBookNavigation'

export function useBookViewContext(books: Ref<BookCard[]>, total: Ref<number>, loadMore: () => Promise<unknown> | unknown) {
  const { setBookContext, registerLoadMore } = useBookNavigation()
  const syncBookContext = () => {
    setBookContext(
      books.value.map((book) => book.id),
      total.value,
    )
  }

  watch([books, total], () => syncBookContext(), { immediate: true })

  onMounted(() => {
    registerLoadMore(async () => {
      await loadMore()
      syncBookContext()
    })
  })
}
