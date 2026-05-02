import { ref, type Ref } from 'vue'
import { useBookDataSource } from '@/features/book/composables/useBookDataSource'
import type { SortSpec } from '@bookorbit/types'

export function useSmartScope(smartScopeId: Ref<number>, q: Ref<string> = ref(''), sort: Ref<SortSpec[]> = ref([{ field: 'title', dir: 'asc' }])) {
  return useBookDataSource(smartScopeId, (id) => `/api/v1/smart-scopes/${id}/books/query`, { q, sort })
}
