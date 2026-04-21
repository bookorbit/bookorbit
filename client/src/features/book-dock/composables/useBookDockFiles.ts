import { computed, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import type { BookDockFile, BookDockFilesPage, BookDockFileStatus } from '@bookorbit/types'

export type SortField = 'createdAt' | 'fileName' | 'format' | 'status' | 'fileSize'
export type SortOrder = 'asc' | 'desc'

export function useBookDockFiles() {
  const items = ref<BookDockFile[]>([])
  const total = ref(0)
  const loading = ref(false)
  const initialized = ref(false)

  const filters = reactive({
    status: undefined as BookDockFileStatus | undefined,
    search: '',
    page: 1,
    limit: 20,
    sort: 'createdAt' as SortField,
    order: 'desc' as SortOrder,
  })

  const selectedIds = ref<Set<number>>(new Set())
  const selectAll = ref(false)
  const excludedIds = ref<Set<number>>(new Set())
  let fetchReqSeq = 0

  const pageCount = computed(() => Math.ceil(total.value / filters.limit) || 1)

  async function fetchFiles() {
    const reqId = ++fetchReqSeq
    loading.value = true
    try {
      const params = new URLSearchParams()
      if (filters.status) params.set('status', filters.status)
      if (filters.search) params.set('search', filters.search)
      params.set('page', String(filters.page))
      params.set('limit', String(filters.limit))
      params.set('sort', filters.sort)
      params.set('order', filters.order)

      const res = await api(`/api/v1/book-dock/files?${params}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data: BookDockFilesPage = await res.json()
      if (reqId !== fetchReqSeq) return
      items.value = data.items
      total.value = data.total
    } catch {
      // Keep the current list visible when a refresh fails.
    } finally {
      if (reqId === fetchReqSeq) {
        loading.value = false
        initialized.value = true
      }
    }
  }

  function setStatus(status: BookDockFileStatus | undefined) {
    clearSelection()
    filters.status = status
    filters.page = 1
    fetchFiles()
  }

  function setSearch(search: string) {
    clearSelection()
    filters.search = search
    filters.page = 1
    fetchFiles()
  }

  function setSort(sort: SortField) {
    if (filters.sort === sort) {
      filters.order = filters.order === 'asc' ? 'desc' : 'asc'
    } else {
      filters.sort = sort
      filters.order = 'desc'
    }
    fetchFiles()
  }

  function setPage(page: number) {
    filters.page = page
    fetchFiles()
  }

  function toggleSelect(id: number) {
    if (selectAll.value) {
      if (excludedIds.value.has(id)) excludedIds.value.delete(id)
      else excludedIds.value.add(id)
    } else {
      if (selectedIds.value.has(id)) selectedIds.value.delete(id)
      else selectedIds.value.add(id)
    }
  }

  function toggleSelectAll() {
    if (selectAll.value) {
      selectAll.value = false
      excludedIds.value.clear()
      selectedIds.value.clear()
    } else {
      selectAll.value = true
      excludedIds.value.clear()
      selectedIds.value.clear()
    }
  }

  function clearSelection() {
    selectAll.value = false
    selectedIds.value.clear()
    excludedIds.value.clear()
  }

  function isSelected(id: number): boolean {
    if (selectAll.value) return !excludedIds.value.has(id)
    return selectedIds.value.has(id)
  }

  const selectionCount = computed(() => {
    if (selectAll.value) return Math.max(0, total.value - excludedIds.value.size)
    return selectedIds.value.size
  })

  const hasSelection = computed(() => selectionCount.value > 0)

  function getSelectionPayload(): {
    fileIds?: number[]
    selectAll?: boolean
    excludedIds?: number[]
    status?: BookDockFileStatus
    search?: string
  } {
    if (selectAll.value) {
      return {
        selectAll: true,
        excludedIds: [...excludedIds.value],
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.search ? { search: filters.search } : {}),
      }
    }
    return { fileIds: [...selectedIds.value] }
  }

  return {
    items,
    total,
    loading,
    initialized,
    filters,
    pageCount,
    fetchFiles,
    setStatus,
    setSearch,
    setSort,
    setPage,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    isSelected,
    selectAll,
    selectionCount,
    hasSelection,
    getSelectionPayload,
  }
}
