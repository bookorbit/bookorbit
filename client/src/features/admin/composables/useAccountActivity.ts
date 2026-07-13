import { computed, ref } from 'vue'
import type {
  AccountActivityListResponse,
  AccountActivitySortDirection,
  AccountActivitySortField,
  AccountActivityState,
  AccountActivitySummary,
} from '@bookorbit/types'

import { api } from '@/lib/api'

export function useAccountActivity() {
  const items = ref<AccountActivityListResponse['items']>([])
  const summary = ref<AccountActivitySummary>({ recent: 0, dormant: 0, never: 0, disabled: 0 })
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(50)
  const search = ref('')
  const state = ref<AccountActivityState | ''>('')
  const provisioningMethod = ref('')
  const sortBy = ref<AccountActivitySortField>('lastAuthenticatedAt')
  const sortDir = ref<AccountActivitySortDirection>('desc')
  const loading = ref(false)
  const error = ref<string | null>(null)
  let loadVersion = 0

  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

  function buildListUrl(): string {
    const params = new URLSearchParams({
      page: String(page.value),
      pageSize: String(pageSize.value),
      sortBy: sortBy.value,
      sortDir: sortDir.value,
    })
    if (search.value.trim()) params.set('search', search.value.trim())
    if (state.value) params.set('state', state.value)
    if (provisioningMethod.value) params.set('provisioningMethod', provisioningMethod.value)
    return `/api/v1/account-activity?${params.toString()}`
  }

  async function load() {
    const version = ++loadVersion
    loading.value = true
    error.value = null
    try {
      const [listResponse, summaryResponse] = await Promise.all([api(buildListUrl()), api('/api/v1/account-activity/summary')])
      if (version !== loadVersion) return
      if (!listResponse.ok || !summaryResponse.ok) throw new Error('load')
      const listData = (await listResponse.json()) as AccountActivityListResponse
      items.value = listData.items
      total.value = listData.total
      page.value = listData.page
      pageSize.value = listData.pageSize
      summary.value = (await summaryResponse.json()) as AccountActivitySummary
    } catch {
      if (version !== loadVersion) return
      error.value = 'load'
    } finally {
      if (version === loadVersion) loading.value = false
    }
  }

  return {
    items,
    summary,
    total,
    page,
    pageSize,
    totalPages,
    search,
    state,
    provisioningMethod,
    sortBy,
    sortDir,
    loading,
    error,
    load,
  }
}
