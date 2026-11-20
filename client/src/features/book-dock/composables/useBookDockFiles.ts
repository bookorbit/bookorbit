import { computed, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import type { BookDockFile, BookDockFilesPage, BookDockHoldFilter, BookDockHoldReason } from '@bookorbit/types'

export type SortField = 'createdAt' | 'fileName' | 'format' | 'status' | 'fileSize' | 'attention'
export type SortOrder = 'asc' | 'desc'

/** The chip set above the list. A held file is ready but waits, so On hold and Ready never overlap. */
export type BookDockView = 'all' | 'onHold' | 'working' | 'ready' | 'error'

/** The dock switcher: every dock, Unsorted, or one library dock by id. */
export type BookDockKey = 'all' | 'unsorted' | number

/** What a bulk action or finalize applies to: picked ids, or everything the page's filters match. */
export interface BookDockSelectionPayload {
  fileIds?: number[]
  selectAll?: boolean
  excludedIds?: number[]
  status?: string
  search?: string
  dock?: string
  hold?: BookDockHoldFilter
}

/** The request's status and hold filters for a view; Working covers every unsettled status. */
function viewFilters(view: BookDockView, reason: BookDockHoldReason | null): Pick<BookDockSelectionPayload, 'status' | 'hold'> {
  switch (view) {
    case 'onHold':
      return { hold: reason ?? 'held' }
    case 'working':
      return { status: 'pending' }
    case 'ready':
      return { hold: 'clear' }
    case 'error':
      return { status: 'error' }
    default:
      return {}
  }
}

export function useBookDockFiles() {
  const items = ref<BookDockFile[]>([])
  const total = ref(0)
  const loading = ref(false)
  const initialized = ref(false)

  const filters = reactive({
    dock: 'all' as BookDockKey,
    view: 'all' as BookDockView,
    reason: null as BookDockHoldReason | null,
    search: '',
    page: 1,
    limit: 20,
    sort: 'attention' as SortField,
    order: 'desc' as SortOrder,
  })

  const selectedIds = ref<Set<number>>(new Set())
  const selectAll = ref(false)
  const excludedIds = ref<Set<number>>(new Set())
  const lastToggledId = ref<number | null>(null)
  let fetchReqSeq = 0

  const pageCount = computed(() => Math.ceil(total.value / filters.limit) || 1)

  async function fetchFiles() {
    const reqId = ++fetchReqSeq
    loading.value = true
    try {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(scopeFilters())) if (value) params.set(key, value)
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

  /** The dock and view filters as the server reads them, shared by the list and select-all. */
  function scopeFilters(): Pick<BookDockSelectionPayload, 'dock' | 'status' | 'hold'> {
    return {
      ...(filters.dock === 'all' ? {} : { dock: String(filters.dock) }),
      ...viewFilters(filters.view, filters.reason),
    }
  }

  const activeView = computed<BookDockView>(() => filters.view)

  function setView(view: BookDockView) {
    clearSelection()
    filters.view = view
    filters.reason = null
    filters.page = 1
    fetchFiles()
  }

  /** Narrows On hold to one reason; null shows every reason. */
  function setHoldReason(reason: BookDockHoldReason | null) {
    clearSelection()
    filters.view = 'onHold'
    filters.reason = reason
    filters.page = 1
    fetchFiles()
  }

  /** Switches dock; `view` keeps the chip when the new dock still has files under it. */
  function setDock(dock: BookDockKey, view: BookDockView = 'all') {
    clearSelection()
    filters.dock = dock
    filters.view = view
    filters.reason = null
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

  function setSelected(id: number, selected: boolean) {
    if (selectAll.value) {
      if (selected) excludedIds.value.delete(id)
      else excludedIds.value.add(id)
    } else {
      if (selected) selectedIds.value.add(id)
      else selectedIds.value.delete(id)
    }
  }

  function toggleSelect(id: number, options: { range?: boolean } = {}) {
    const willBeSelected = !isSelected(id)

    if (options.range && lastToggledId.value !== null && lastToggledId.value !== id) {
      const anchorIdx = items.value.findIndex((f) => f.id === lastToggledId.value)
      const targetIdx = items.value.findIndex((f) => f.id === id)
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
        for (let i = start; i <= end; i++) {
          const item = items.value[i]
          if (item) setSelected(item.id, willBeSelected)
        }
        lastToggledId.value = id
        return
      }
    }

    setSelected(id, willBeSelected)
    lastToggledId.value = id
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
    lastToggledId.value = null
  }

  function removeDeletedSelection(id: number) {
    selectedIds.value.delete(id)
    excludedIds.value.delete(id)
    if (lastToggledId.value === id) lastToggledId.value = null
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

  function getSelectionPayload(): BookDockSelectionPayload {
    if (selectAll.value) {
      return {
        selectAll: true,
        excludedIds: [...excludedIds.value],
        ...scopeFilters(),
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
    activeView,
    setView,
    setHoldReason,
    setDock,
    setSearch,
    setSort,
    setPage,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
    removeDeletedSelection,
    isSelected,
    selectAll,
    selectionCount,
    hasSelection,
    getSelectionPayload,
  }
}
