import { computed, onActivated, onDeactivated, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { BookDuplicateGroup, BookDuplicateMatchReason, BookDuplicateScan } from '@bookorbit/types'

import {
  createBookDuplicateScan,
  deleteDuplicateBooks,
  getActiveBookDuplicateScan,
  getBookDuplicateGroups,
  getBookDuplicateScan,
} from '../api/book-duplicates'

const POLL_INTERVAL_MS = 1000

export function useBookDuplicates() {
  const { t } = useI18n()
  const scan = ref<BookDuplicateScan | null>(null)
  const groups = ref<BookDuplicateGroup[]>([])
  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(20)
  const reason = ref<BookDuplicateMatchReason | undefined>()
  const loading = ref(false)
  const deleting = ref(false)
  const error = ref<string | null>(null)
  const hiddenGroupIds = ref(new Set<number>())
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let active = true
  let disposed = false
  let groupsRequestId = 0

  const visibleGroups = computed(() => groups.value.filter((group) => !hiddenGroupIds.value.has(group.id)))
  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const scanning = computed(() => scan.value?.status === 'queued' || scan.value?.status === 'running')

  onActivated(() => {
    active = true
    if (scanning.value) schedulePoll()
  })
  onDeactivated(() => {
    active = false
    stopPolling()
  })
  onUnmounted(() => {
    disposed = true
    stopPolling()
  })

  function stopPolling(): void {
    if (pollTimer !== null) {
      clearTimeout(pollTimer)
      pollTimer = null
    }
  }

  async function startScan(libraryId: number | undefined, similarityPercent: number): Promise<void> {
    stopPolling()
    groupsRequestId += 1
    loading.value = true
    error.value = null
    groups.value = []
    total.value = 0
    page.value = 1
    reason.value = undefined
    hiddenGroupIds.value = new Set()
    try {
      scan.value = await createBookDuplicateScan({ libraryId, similarityPercent })
      schedulePoll()
    } catch {
      error.value = t('tools.bookDuplicates.errors.start')
    } finally {
      loading.value = false
    }
  }

  function schedulePoll(): void {
    stopPolling()
    if (!active || disposed) return
    pollTimer = setTimeout(pollScan, POLL_INTERVAL_MS)
  }

  async function pollScan(): Promise<void> {
    if (!scan.value) return
    const scanId = scan.value.id
    try {
      const nextScan = await getBookDuplicateScan(scanId)
      if (!scan.value || scan.value.id !== scanId || disposed) return
      scan.value = nextScan
      error.value = null
      if (scan.value.status === 'completed') {
        await fetchGroups()
        return
      }
      if (scan.value.status === 'failed') {
        error.value = t('tools.bookDuplicates.errors.scan')
        return
      }
      schedulePoll()
    } catch {
      error.value = t('tools.bookDuplicates.errors.status')
      schedulePoll()
    }
  }

  async function resumeActiveScan(): Promise<void> {
    loading.value = true
    try {
      const activeScan = await getActiveBookDuplicateScan()
      if (!activeScan || disposed) return
      scan.value = activeScan
      error.value = null
      schedulePoll()
    } catch {
      error.value = t('tools.bookDuplicates.errors.status')
    } finally {
      loading.value = false
    }
  }

  async function fetchGroups(): Promise<void> {
    if (!scan.value || scan.value.status !== 'completed') return
    const requestId = ++groupsRequestId
    loading.value = true
    error.value = null
    try {
      let response = await getBookDuplicateGroups(scan.value.id, {
        page: page.value,
        pageSize: pageSize.value,
        reason: reason.value,
      })
      if (requestId !== groupsRequestId || disposed) return
      const lastPage = Math.max(1, Math.ceil(response.total / pageSize.value))
      if (response.page > lastPage) {
        page.value = lastPage
        response = await getBookDuplicateGroups(scan.value.id, {
          page: lastPage,
          pageSize: pageSize.value,
          reason: reason.value,
        })
        if (requestId !== groupsRequestId || disposed) return
      }
      groups.value = response.groups
      total.value = response.total
      page.value = response.page
    } catch {
      error.value = t('tools.bookDuplicates.errors.results')
    } finally {
      if (requestId === groupsRequestId) loading.value = false
    }
  }

  async function setReason(value: BookDuplicateMatchReason | undefined): Promise<void> {
    reason.value = value
    page.value = 1
    await fetchGroups()
  }

  async function setPage(value: number): Promise<void> {
    page.value = Math.max(1, Math.min(value, totalPages.value))
    await fetchGroups()
  }

  function hideGroup(groupId: number): void {
    hiddenGroupIds.value = new Set(hiddenGroupIds.value).add(groupId)
  }

  async function discardBooks(bookIds: number[]): Promise<boolean> {
    deleting.value = true
    try {
      await deleteDuplicateBooks(bookIds)
      await fetchGroups()
      toast.success(t('tools.bookDuplicates.deleteDialog.success', { count: bookIds.length }, bookIds.length))
      return true
    } catch {
      toast.error(t('tools.bookDuplicates.errors.delete'))
      return false
    } finally {
      deleting.value = false
    }
  }

  return {
    scan,
    visibleGroups,
    total,
    page,
    pageSize,
    reason,
    totalPages,
    scanning,
    loading,
    deleting,
    error,
    startScan,
    resumeActiveScan,
    fetchGroups,
    setReason,
    setPage,
    hideGroup,
    discardBooks,
  }
}
