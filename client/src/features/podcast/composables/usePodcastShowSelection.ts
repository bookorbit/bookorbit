import { computed, ref } from 'vue'

/**
 * Which shows a bulk action will act on.
 *
 * Selection is kept out of the list lane on purpose. The lane repages, refetches and reorders as the
 * user scrolls and filters, and a selection has to survive all of that. Ids are held rather than
 * rows for the same reason: a row object from a page that has since been replaced is not the row the
 * next fetch returns, but its id still is.
 */
export function usePodcastShowSelection() {
  const active = ref(false)
  const selectedIds = ref<ReadonlySet<number>>(new Set())

  const count = computed(() => selectedIds.value.size)
  const hasSelection = computed(() => count.value > 0)
  const ids = computed(() => [...selectedIds.value])

  function isSelected(id: number): boolean {
    return selectedIds.value.has(id)
  }

  function toggle(id: number): void {
    const next = new Set(selectedIds.value)
    if (!next.delete(id)) next.add(id)
    selectedIds.value = next
  }

  function selectAll(showIds: number[]): void {
    selectedIds.value = new Set([...selectedIds.value, ...showIds])
  }

  function clear(): void {
    if (count.value > 0) selectedIds.value = new Set()
  }

  /** Leaving select mode drops the selection: a selection nobody can see is one a later action acts on by surprise. */
  function setActive(value: boolean): void {
    active.value = value
    if (!value) clear()
  }

  function toggleActive(): void {
    setActive(!active.value)
  }

  return { active, selectedIds, count, hasSelection, ids, isSelected, toggle, selectAll, clear, setActive, toggleActive }
}

export type PodcastShowSelection = ReturnType<typeof usePodcastShowSelection>
