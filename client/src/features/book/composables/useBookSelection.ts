import { computed, ref } from 'vue'

export function useBookSelection() {
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

  function toggleBook(id: number) {
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
      toggleBook(targetId)
      return
    }
    const anchorIdx = allIds.indexOf(anchorId.value)
    const targetIdx = allIds.indexOf(targetId)
    if (anchorIdx === -1 || targetIdx === -1) {
      toggleBook(targetId)
      return
    }
    const start = Math.min(anchorIdx, targetIdx)
    const end = Math.max(anchorIdx, targetIdx)
    const next = new Set(selectedIds.value)
    for (let i = start; i <= end; i++) {
      if (anchorSelected.value) next.add(allIds[i]!)
      else next.delete(allIds[i]!)
    }
    selectedIds.value = next
  }

  function selectAll(ids: number[]) {
    selectedIds.value = new Set(ids)
  }

  function deselectAll(ids: number[]) {
    if (ids.length === 0) return
    const remove = new Set(ids)
    selectedIds.value = new Set([...selectedIds.value].filter((id) => !remove.has(id)))
    if (anchorId.value !== null && remove.has(anchorId.value)) {
      anchorId.value = null
      anchorSelected.value = false
    }
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
    toggleBook,
    rangeSelectTo,
    selectAll,
    deselectAll,
    isSelected,
  }
}
