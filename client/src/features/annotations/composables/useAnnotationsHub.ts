import { computed, ref, watch } from 'vue'
import type { AnnotationHubItem, AnnotationHubResponse } from '@bookorbit/types'
import { api } from '@/lib/api'

export type HubStatus = 'active' | 'trashed'

export function useAnnotationsHub() {
  const items = ref<AnnotationHubItem[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(25)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const status = ref<HubStatus>('active')
  const search = ref('')
  const colorFilter = ref('all')
  const styleFilter = ref('all')
  const originFilter = ref('all')
  const sortBy = ref<'createdAt' | 'book'>('createdAt')
  const sortDir = ref<'asc' | 'desc'>('desc')

  const selectedIds = ref<Set<number>>(new Set())

  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const hasSelection = computed(() => selectedIds.value.size > 0)

  function buildQuery(extra: Record<string, string> = {}): string {
    const params = new URLSearchParams()
    params.set('page', String(page.value))
    params.set('pageSize', String(pageSize.value))
    params.set('status', status.value)
    params.set('sortBy', sortBy.value)
    params.set('sortDir', sortDir.value)
    if (search.value.trim()) params.set('search', search.value.trim())
    if (colorFilter.value !== 'all') params.set('colors', colorFilter.value)
    if (styleFilter.value !== 'all') params.set('styles', styleFilter.value)
    if (originFilter.value !== 'all') params.set('origins', originFilter.value)
    for (const [key, value] of Object.entries(extra)) params.set(key, value)
    return params.toString()
  }

  async function load() {
    loading.value = true
    error.value = null
    try {
      const res = await api(`/api/v1/annotations?${buildQuery()}`)
      if (!res.ok) {
        error.value = 'Failed to load annotations'
        return
      }
      const body: AnnotationHubResponse = await res.json()
      items.value = body.items
      total.value = body.total
    } finally {
      loading.value = false
    }
  }

  function toggleSelected(id: number) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  function clearSelection() {
    selectedIds.value = new Set()
  }

  function selectAllOnPage() {
    selectedIds.value = new Set(items.value.map((item) => item.id))
  }

  async function bulk(action: 'trash' | 'restore' | 'restyle', patch?: { color?: string; style?: string }): Promise<number> {
    const ids = [...selectedIds.value]
    if (ids.length === 0) return 0
    const res = await api('/api/v1/annotations/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action, ...patch }),
    })
    if (!res.ok) return 0
    const body = (await res.json()) as { affected: number }
    clearSelection()
    await load()
    return body.affected
  }

  async function restore(id: number): Promise<boolean> {
    const res = await api(`/api/v1/annotations/${id}/restore`, { method: 'POST' })
    if (res.ok) await load()
    return res.ok
  }

  async function purge(id: number): Promise<{ ok: boolean; message?: string }> {
    const res = await api(`/api/v1/annotations/${id}`, { method: 'DELETE' })
    if (res.ok) {
      await load()
      return { ok: true }
    }
    if (res.status === 409) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      return { ok: false, message: body?.message ?? 'Still pending device sync' }
    }
    return { ok: false, message: 'Failed to delete' }
  }

  function exportUrl(format: 'md' | 'csv' | 'json'): string {
    return `/api/v1/annotations/export?${buildQuery({ format })}`
  }

  watch([status, search, colorFilter, styleFilter, originFilter, sortBy, sortDir], () => {
    page.value = 1
    clearSelection()
    void load()
  })
  watch(page, () => {
    clearSelection()
    void load()
  })

  return {
    items,
    total,
    page,
    pageSize,
    totalPages,
    loading,
    error,
    status,
    search,
    colorFilter,
    styleFilter,
    originFilter,
    sortBy,
    sortDir,
    selectedIds,
    hasSelection,
    load,
    toggleSelected,
    clearSelection,
    selectAllOnPage,
    bulk,
    restore,
    purge,
    exportUrl,
  }
}
