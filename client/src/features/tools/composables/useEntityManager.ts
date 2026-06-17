import { computed, onUnmounted, ref, watch } from 'vue'

import {
  ENTITY_CAPABILITIES,
  INLINE_ENTITY_TYPES,
  type BrowseEntityItem,
  type DuplicateCluster,
  type DuplicateScanStatus,
  type DismissedPairInfo,
  type EntityType,
  type EntityTypeCapabilities,
} from '@bookorbit/types'

import * as entityManagerApi from '../api/entity-manager'

export type EntityManagerMode = 'duplicates' | 'browse'

export function useEntityManager() {
  const entityType = ref<EntityType>('author')
  const mode = ref<EntityManagerMode>('browse')

  const isInline = computed(() => (INLINE_ENTITY_TYPES as readonly string[]).includes(entityType.value))
  const capabilities = computed<EntityTypeCapabilities>(() => ENTITY_CAPABILITIES[entityType.value])

  // Scan state
  const scanning = ref(false)
  const clusters = ref<DuplicateCluster[]>([])
  const scanError = ref<string | null>(null)
  const minSimilarity = ref(0.5)
  const scanLibraryId = ref<number | undefined>()
  const scanPage = ref(1)
  const scanPageSize = ref(20)
  const scanTotal = ref(0)
  const scanTotalPages = computed(() => Math.ceil(scanTotal.value / scanPageSize.value) || 1)

  let scanAbortController: AbortController | null = null

  onUnmounted(() => {
    if (scanAbortController) {
      scanAbortController.abort()
      scanAbortController = null
    }
    stopStatusPoll()
  })

  // Browse state
  const browseItems = ref<BrowseEntityItem[]>([])
  const browseTotal = ref(0)
  const browsePage = ref(1)
  const browsePageSize = ref(25)
  const browseSearch = ref('')
  const browseSortBy = ref<'name' | 'bookCount'>('name')
  const browseSortOrder = ref<'asc' | 'desc'>('asc')
  const browseLoading = ref(false)

  // Selection state
  const selectedIds = ref<Set<number | string>>(new Set())
  const selectedItemsMap = ref<Map<number | string, BrowseEntityItem>>(new Map())
  const selectionAnchorId = ref<number | string | null>(null)
  const selectionAnchorSelected = ref(false)

  // Operation state
  const operationLoading = ref(false)
  const operationError = ref<string | null>(null)

  // Dismissed state
  const showDismissed = ref(false)
  const dismissedPairs = ref<DismissedPairInfo[]>([])
  const dismissedLoading = ref(false)

  const hasScanned = ref(false)

  // Duplicate scan status (for non-inline entities)
  const duplicateScanStatus = ref<DuplicateScanStatus | null>(null)
  let statusPollTimer: ReturnType<typeof setTimeout> | null = null

  function stopStatusPoll(): void {
    if (statusPollTimer !== null) {
      clearTimeout(statusPollTimer)
      statusPollTimer = null
    }
  }

  async function fetchScanStatus(): Promise<void> {
    if (isInline.value) return
    const capturedType = entityType.value
    try {
      const previousState = duplicateScanStatus.value?.state
      const status = await entityManagerApi.getDuplicateScanStatus(capturedType)
      if (entityType.value !== capturedType) return
      duplicateScanStatus.value = status
      if (status.state === 'done' && previousState === 'computing') {
        void scan()
      } else if (status.state === 'computing') {
        stopStatusPoll()
        statusPollTimer = setTimeout(fetchScanStatus, 3000)
      }
    } catch {
      // silently ignore
    }
  }

  async function refreshDuplicates(): Promise<void> {
    try {
      duplicateScanStatus.value = await entityManagerApi.refreshDuplicates(entityType.value, { minSimilarity: minSimilarity.value })
    } catch {
      // silently ignore
    }
    if (duplicateScanStatus.value?.state === 'computing') {
      stopStatusPoll()
      statusPollTimer = setTimeout(fetchScanStatus, 3000)
    }
  }

  function removeClustersByIds(ids: (number | string)[]): void {
    const idSet = new Set(ids)
    const before = clusters.value.length
    clusters.value = clusters.value.filter((c) => !c.entities.some((e) => idSet.has(e.id)))
    scanTotal.value = Math.max(0, scanTotal.value - (before - clusters.value.length))
  }

  function removePairFromClusters(idA: number | string, idB: number | string): void {
    const before = clusters.value.length
    clusters.value = clusters.value
      .map((c) => {
        const remainingPairs = c.pairDetails.filter((p) => !(p.idA === idA && p.idB === idB) && !(p.idA === idB && p.idB === idA))
        if (remainingPairs.length === 0) return null
        const involvedIds = new Set(remainingPairs.flatMap((p) => [p.idA, p.idB]))
        return {
          ...c,
          pairDetails: remainingPairs,
          entities: c.entities.filter((e) => involvedIds.has(e.id)),
        }
      })
      .filter((c): c is DuplicateCluster => c !== null)
    scanTotal.value = Math.max(0, scanTotal.value - (before - clusters.value.length))
  }

  function clearScan(): void {
    clusters.value = []
    scanError.value = null
    hasScanned.value = false
    scanPage.value = 1
    scanTotal.value = 0
  }

  function clearBrowse(): void {
    browseItems.value = []
    browseTotal.value = 0
    browsePage.value = 1
    resetSelection()
  }

  watch(entityType, () => {
    clearScan()
    clearBrowse()
    showDismissed.value = false
    dismissedPairs.value = []
    stopStatusPoll()
    duplicateScanStatus.value = null
  })

  watch(mode, () => {
    resetSelection()
  })

  async function scan(): Promise<void> {
    if (scanAbortController) {
      scanAbortController.abort()
    }
    const controller = new AbortController()
    scanAbortController = controller

    scanning.value = true
    scanError.value = null
    try {
      const result = await entityManagerApi.scanDuplicates(
        entityType.value,
        {
          libraryId: scanLibraryId.value,
          minSimilarity: minSimilarity.value,
          page: scanPage.value,
          pageSize: scanPageSize.value,
        },
        controller.signal,
      )
      if (controller.signal.aborted) return
      clusters.value = result.clusters
      scanTotal.value = result.total
      scanPage.value = result.page
      hasScanned.value = true
    } catch (err) {
      if (controller.signal.aborted) return
      scanError.value = err instanceof Error ? err.message : 'Scan failed'
    } finally {
      if (!controller.signal.aborted) {
        scanning.value = false
      }
    }
  }

  async function fetchBrowse(): Promise<void> {
    browseLoading.value = true
    try {
      const result = await entityManagerApi.browseEntities(entityType.value, {
        search: browseSearch.value || undefined,
        page: browsePage.value,
        pageSize: browsePageSize.value,
        sortBy: browseSortBy.value,
        sortOrder: browseSortOrder.value,
      })
      browseItems.value = result.items
      browseTotal.value = result.total

      // Update selected items map with details from currently loaded items if they are selected
      result.items.forEach((item) => {
        if (selectedIds.value.has(item.id)) {
          selectedItemsMap.value.set(item.id, item)
        }
      })
    } catch {
      browseItems.value = []
      browseTotal.value = 0
    } finally {
      browseLoading.value = false
    }
  }

  async function mergeEntities(targetId: number | string, sourceIds: (number | string)[], writeFiles: boolean): Promise<void> {
    operationLoading.value = true
    operationError.value = null
    try {
      const payload = isInline.value
        ? { targetValue: targetId as string, sourceValues: sourceIds as string[], writeFiles }
        : { targetEntityId: targetId as number, sourceEntityIds: sourceIds as number[], writeFiles }
      await entityManagerApi.mergeEntities(entityType.value, payload)
    } catch (err) {
      operationError.value = err instanceof Error ? err.message : 'Merge failed'
      throw err
    } finally {
      operationLoading.value = false
    }
  }

  async function renameEntity(entityId: number | string, newName: string, writeFiles: boolean): Promise<void> {
    operationLoading.value = true
    operationError.value = null
    try {
      const payload = isInline.value
        ? { currentValue: entityId as string, newName, writeFiles }
        : { entityId: entityId as number, newName, writeFiles }
      await entityManagerApi.renameEntity(entityType.value, payload)
    } catch (err) {
      operationError.value = err instanceof Error ? err.message : 'Rename failed'
      throw err
    } finally {
      operationLoading.value = false
    }
  }

  async function deleteEntity(entityId: number | string, deleteMode: 'soft' | 'hard' | 'inline', writeFiles: boolean): Promise<void> {
    operationLoading.value = true
    operationError.value = null
    try {
      const payload = isInline.value
        ? { value: entityId as string, mode: 'inline' as const, writeFiles }
        : { entityId: entityId as number, mode: deleteMode, writeFiles }
      await entityManagerApi.deleteEntity(entityType.value, payload)
    } catch (err) {
      operationError.value = err instanceof Error ? err.message : 'Delete failed'
      throw err
    } finally {
      operationLoading.value = false
    }
  }

  async function bulkDeleteEntities(entityIds: (number | string)[], deleteMode: 'soft' | 'hard' | 'inline', writeFiles: boolean): Promise<void> {
    operationLoading.value = true
    operationError.value = null
    try {
      const payload = isInline.value
        ? { values: entityIds as string[], mode: 'inline' as const, writeFiles }
        : { entityIds: entityIds as number[], mode: deleteMode, writeFiles }
      await entityManagerApi.bulkDeleteEntities(entityType.value, payload)
    } catch (err) {
      operationError.value = err instanceof Error ? err.message : 'Bulk delete failed'
      throw err
    } finally {
      operationLoading.value = false
    }
  }

  async function splitEntity(entityId: number, newNames: string[], writeFiles: boolean): Promise<void> {
    operationLoading.value = true
    operationError.value = null
    try {
      await entityManagerApi.splitEntity(entityType.value, { entityId, newNames, writeFiles })
    } catch (err) {
      operationError.value = err instanceof Error ? err.message : 'Split failed'
      throw err
    } finally {
      operationLoading.value = false
    }
  }

  watch(
    [mode, entityType],
    ([newMode]) => {
      if (newMode === 'duplicates') {
        fetchDismissedPairs()
      }
    },
    { immediate: true },
  )

  async function dismissPair(idA: number | string, idB: number | string, reason?: string): Promise<void> {
    const payload = isInline.value
      ? { valueA: idA as string, valueB: idB as string, reason }
      : { entityIdA: idA as number, entityIdB: idB as number, reason }
    await entityManagerApi.dismissPair(entityType.value, payload)
    await fetchDismissedPairs()
  }

  async function undismissPair(idA: number | string, idB: number | string): Promise<void> {
    const payload = isInline.value ? { valueA: idA as string, valueB: idB as string } : { entityIdA: idA as number, entityIdB: idB as number }
    await entityManagerApi.undismissPair(entityType.value, payload)
    await fetchDismissedPairs()
  }

  async function fetchDismissedPairs(): Promise<void> {
    dismissedLoading.value = true
    try {
      dismissedPairs.value = await entityManagerApi.getDismissedPairs(entityType.value)
    } catch {
      dismissedPairs.value = []
    } finally {
      dismissedLoading.value = false
    }
  }

  function syncSelectedItem(id: number | string, selected: boolean): void {
    if (!selected) {
      selectedItemsMap.value.delete(id)
      return
    }

    const item = browseItems.value.find((i) => i.id === id)
    if (item) {
      selectedItemsMap.value.set(id, item)
    }
  }

  function setItemSelected(next: Set<number | string>, id: number | string, selected: boolean): void {
    if (selected) {
      next.add(id)
    } else {
      next.delete(id)
    }
    syncSelectedItem(id, selected)
  }

  function toggleSelection(id: number | string): void {
    const newSet = new Set(selectedIds.value)
    const shouldSelect = !newSet.has(id)
    setItemSelected(newSet, id, shouldSelect)
    selectedIds.value = newSet
    selectionAnchorId.value = id
    selectionAnchorSelected.value = shouldSelect
  }

  function rangeSelectTo(targetId: number | string): void {
    if (selectionAnchorId.value === null) {
      toggleSelection(targetId)
      return
    }

    const anchorIdx = browseItems.value.findIndex((item) => item.id === selectionAnchorId.value)
    const targetIdx = browseItems.value.findIndex((item) => item.id === targetId)
    if (anchorIdx === -1 || targetIdx === -1) {
      toggleSelection(targetId)
      return
    }

    const start = Math.min(anchorIdx, targetIdx)
    const end = Math.max(anchorIdx, targetIdx)
    const newSet = new Set(selectedIds.value)

    for (let i = start; i <= end; i += 1) {
      const item = browseItems.value[i]
      if (item) {
        setItemSelected(newSet, item.id, selectionAnchorSelected.value)
      }
    }

    selectedIds.value = newSet
  }

  function removeFromSelection(id: number | string): void {
    if (!selectedIds.value.has(id)) return
    const newSet = new Set(selectedIds.value)
    newSet.delete(id)
    selectedItemsMap.value.delete(id)
    selectedIds.value = newSet
    if (selectionAnchorId.value === id) {
      selectionAnchorId.value = null
      selectionAnchorSelected.value = false
    }
  }

  function resetSelection(): void {
    selectedIds.value = new Set()
    selectedItemsMap.value.clear()
    selectionAnchorId.value = null
    selectionAnchorSelected.value = false
  }

  function clearSelection(): void {
    resetSelection()
  }

  const browseTotalPages = computed(() => Math.ceil(browseTotal.value / browsePageSize.value))

  return {
    entityType,
    mode,
    isInline,
    capabilities,

    scanning,
    clusters,
    scanError,
    hasScanned,
    minSimilarity,
    scanLibraryId,
    scanPage,
    scanPageSize,
    scanTotal,
    scanTotalPages,
    scan,
    clearScan,
    duplicateScanStatus,
    fetchScanStatus,
    refreshDuplicates,
    removeClustersByIds,
    removePairFromClusters,

    browseItems,
    browseTotal,
    browsePage,
    browsePageSize,
    browseSearch,
    browseSortBy,
    browseSortOrder,
    browseLoading,
    browseTotalPages,
    fetchBrowse,
    clearBrowse,

    selectedIds,
    selectedItemsMap,
    toggleSelection,
    rangeSelectTo,
    removeFromSelection,
    clearSelection,

    operationLoading,
    operationError,
    mergeEntities,
    renameEntity,
    deleteEntity,
    bulkDeleteEntities,
    splitEntity,

    showDismissed,
    dismissedPairs,
    dismissedLoading,
    dismissPair,
    undismissPair,
    fetchDismissedPairs,
  }
}
