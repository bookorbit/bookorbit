import { onMounted, onUnmounted, watch, type Ref } from 'vue'
import type { BookCard } from '@bookorbit/types'
import { useBookNavigation } from './useBookNavigation'

export function useBookViewContext(books: Ref<BookCard[]>, total: Ref<number>, loadMore: () => Promise<unknown> | unknown) {
  const { setBookContext, registerLoadMore } = useBookNavigation()

  watch(
    [books, total],
    ([items, count]) => {
      setBookContext(
        items.map((book) => book.id),
        count,
      )
    },
    { immediate: true },
  )

  onMounted(() => {
    registerLoadMore(async () => {
      await loadMore()
    })
  })

  onUnmounted(() => {
    registerLoadMore(null)
  })
}
