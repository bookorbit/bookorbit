import { computed, ref } from 'vue'

export function useBookSelection() {
  const selectionMode = ref(false)
  const selectedIds = ref<Set<number>>(new Set())
  const selectedCount = computed(() => selectedIds.value.size)

  function enterSelectionMode() {
    selectionMode.value = true
  }

  function exitSelectionMode() {
    selectionMode.value = false
    selectedIds.value = new Set()
  }

  function toggleBook(id: number) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
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
    toggleBook,
    selectAll,
    isSelected,
  }
}
