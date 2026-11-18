import { computed, type Ref } from 'vue'
import type { BookDetail } from '@bookorbit/types'
import { useI18n } from 'vue-i18n'
import { usePageTitle } from '@/composables/usePageTitle'
import { useBookDetail } from '@/features/book/composables/useBookDetail'

/** Sets the tab title from the book, and hands the reader the record it fetched for that. */
export function useReaderPageTitle(bookId: number): Readonly<Ref<BookDetail | null>> {
  const { t } = useI18n()
  const { detail, fetch } = useBookDetail()
  const pageTitle = computed(() => {
    const title = detail.value?.title?.trim()
    const fallback = Number.isFinite(bookId) ? t('views.bookDetail.titleWithId', { id: bookId }) : t('views.bookDetail.title')
    return title || fallback
  })

  usePageTitle(pageTitle)
  if (Number.isFinite(bookId)) void fetch(bookId)
  return detail
}
