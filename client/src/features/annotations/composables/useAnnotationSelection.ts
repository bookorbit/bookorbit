import { computed, ref, watch, type Ref } from 'vue'

/** Shared bulk-selection state for an annotation list. Prunes ids that leave the list. */
export function useAnnotationSelection<T extends { id: number }>(items: Ref<T[]>) {
  const selectedIds = ref<Set<number>>(new Set())

  const visibleIds = computed(() => items.value.map((item) => item.id))
  const hasSelection = computed(() => selectedIds.value.size > 0)
  const allVisibleSelected = computed(() => visibleIds.value.length > 0 && visibleIds.value.every((id) => selectedIds.value.has(id)))
  const selectedItems = computed(() => items.value.filter((item) => selectedIds.value.has(item.id)))

  function toggleSelected(id: number) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  function selectAllOnPage() {
    const next = new Set(selectedIds.value)
    for (const id of visibleIds.value) next.add(id)
    selectedIds.value = next
  }

  function clearSelection() {
    if (selectedIds.value.size > 0) selectedIds.value = new Set()
  }

  watch(items, (nextItems) => {
    const currentIds = new Set(nextItems.map((item) => item.id))
    const pruned = new Set([...selectedIds.value].filter((id) => currentIds.has(id)))
    if (pruned.size !== selectedIds.value.size) selectedIds.value = pruned
  })

  return { selectedIds, hasSelection, allVisibleSelected, selectedItems, toggleSelected, selectAllOnPage, clearSelection }
}
