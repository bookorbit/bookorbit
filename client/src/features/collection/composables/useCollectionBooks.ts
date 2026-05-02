import { ref, type Ref } from 'vue'
import { useBookDataSource } from '@/features/book/composables/useBookDataSource'
import type { SortSpec } from '@bookorbit/types'

export function useCollectionBooks(
  collectionId: Ref<number>,
  collapseEnabled: Ref<boolean> = ref(false),
  q: Ref<string> = ref(''),
  sort: Ref<SortSpec[]> = ref([{ field: 'title', dir: 'asc' }]),
) {
  return useBookDataSource(collectionId, (id) => `/api/v1/collections/${id}/books/query`, {
    collapseEnabled,
    q,
    sort,
  })
}
