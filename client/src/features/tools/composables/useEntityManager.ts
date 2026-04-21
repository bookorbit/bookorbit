import { computed, onUnmounted, ref, watch } from 'vue'

import {
  ENTITY_CAPABILITIES,
  INLINE_ENTITY_TYPES,
  type BrowseEntityItem,
  type DuplicateCluster,
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

  // Operation state
  const operationLoading = ref(false)
  const operationError = ref<string | null>(null)

  // Dismissed state
  const showDismissed = ref(false)
  const dismissedPairs = ref<DismissedPairInfo[]>([])
  const dismissedLoading = ref(false)

  const hasScanned = ref(false)

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
    selectedIds.value = new Set()
  }

  watch(entityType, () => {
    clearScan()
    clearBrowse()
    showDismissed.value = false
    dismissedPairs.value = []
  })

  watch(mode, () => {
    selectedIds.value = new Set()
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

  function toggleSelection(id: number | string): void {
    const newSet = new Set(selectedIds.value)
    if (newSet.has(id)) {
      newSet.delete(id)
      selectedItemsMap.value.delete(id)
    } else {
      newSet.add(id)
      // Add to map if we have it in current page
      const item = browseItems.value.find((i) => i.id === id)
      if (item) {
        selectedItemsMap.value.set(id, item)
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
  }

  function clearSelection(): void {
    selectedIds.value = new Set()
    selectedItemsMap.value.clear()
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
