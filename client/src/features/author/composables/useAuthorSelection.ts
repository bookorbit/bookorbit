import { computed, ref } from 'vue'

export function useAuthorSelection() {
  const selectionMode = ref(false)
  const selectedIds = ref<Set<number>>(new Set())
  const selectedCount = computed(() => selectedIds.value.size)
  const anchorId = ref<number | null>(null)
  const anchorSelected = ref(false)

  function enterSelectionMode() {
    selectionMode.value = true
  }

  function exitSelectionMode() {
    selectionMode.value = false
    selectedIds.value = new Set()
    anchorId.value = null
  }

  function toggleAuthor(id: number) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) {
      next.delete(id)
      anchorSelected.value = false
    } else {
      next.add(id)
      anchorSelected.value = true
    }
    selectedIds.value = next
    anchorId.value = id
  }

  function rangeSelectTo(targetId: number, allIds: number[]) {
    if (anchorId.value === null) {
      toggleAuthor(targetId)
      return
    }

    const anchorIdx = allIds.indexOf(anchorId.value)
    const targetIdx = allIds.indexOf(targetId)
    if (anchorIdx === -1 || targetIdx === -1) {
      toggleAuthor(targetId)
      return
    }

    const start = Math.min(anchorIdx, targetIdx)
    const end = Math.max(anchorIdx, targetIdx)
    const next = new Set(selectedIds.value)

    for (let i = start; i <= end; i += 1) {
      if (anchorSelected.value) {
        next.add(allIds[i]!)
      } else {
        next.delete(allIds[i]!)
      }
    }

    selectedIds.value = next
  }

  function selectAll(ids: number[]) {
    selectedIds.value = new Set(ids)
  }

  function isSelected(id: number) {
    return selectedIds.value.has(id)
  }

  return {
    selectionMode,
    selectedIds,
    selectedCount,
    enterSelectionMode,
    exitSelectionMode,
    toggleAuthor,
    rangeSelectTo,
    selectAll,
    isSelected,
  }
}
