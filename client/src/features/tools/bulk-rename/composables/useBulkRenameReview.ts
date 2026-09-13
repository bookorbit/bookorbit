import { computed, ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BulkRenameExecuteRequest, BulkRenamePreviewItem, BulkRenameStatus } from '@bookorbit/types'

import { classifyChange, type ChangeKind } from '../utils/changeKind'

export interface ReviewGroup {
  key: string
  label: string
  items: BulkRenamePreviewItem[]
}

/** Whether the marked set names the books to leave out or the only books to rename. */
export type SelectionMode = 'all-except' | 'only'

export type TriState = 'all' | 'none' | 'some'

const STATUS_GROUP_LABEL: Partial<Record<BulkRenameStatus, string>> = {
  collision: 'tools.bulkRename.group.collision',
  unchanged: 'tools.bulkRename.group.unchanged',
  no_pattern: 'tools.bulkRename.group.noPattern',
  error: 'tools.bulkRename.group.error',
}

/**
 * Review state for the rename queue: which book is open, which books will be renamed, and which
 * change kinds are collapsed.
 *
 * Selection is stored as a mode plus one small set rather than a list of chosen books. The
 * candidate list is paged and can run to tens of thousands, so the client can never state the
 * full selection; it states whichever side is short. Skipping a handful keeps `all-except`, and
 * clearing the selection flips to `only`, where the marked set is what gets renamed.
 *
 * @param items Loaded preview rows, which may be a fraction of the candidate list.
 * @param totalRenameable Server-side count of `will_rename` candidates across every page.
 */
export function useBulkRenameReview(items: Ref<BulkRenamePreviewItem[]>, totalRenameable: Ref<number>) {
  const { t } = useI18n()

  const selectedId = ref<number | null>(null)
  const mode = ref<SelectionMode>('all-except')
  const marked = ref<Set<number>>(new Set())
  const collapsed = ref<Set<string>>(new Set())

  /** Classification is pure but not free, so it is computed once per loaded page. */
  const kinds = computed(() => {
    const map = new Map<number, ChangeKind | null>()
    for (const item of items.value) {
      map.set(item.bookId, item.status === 'will_rename' && item.newPath ? classifyChange(item.currentPath, item.newPath) : null)
    }
    return map
  })

  function groupKeyOf(item: BulkRenamePreviewItem): string {
    return kinds.value.get(item.bookId)?.key ?? item.status
  }

  function groupLabelOf(item: BulkRenamePreviewItem): string {
    const kind = kinds.value.get(item.bookId)
    if (kind) return t(`tools.bulkRename.changeKind.${kind.key}`)
    const key = STATUS_GROUP_LABEL[item.status]
    return key ? t(key) : item.status
  }

  /** Ordered so every change kind stays contiguous under its header, largest kind first. */
  const ordered = computed<BulkRenamePreviewItem[]>(() => {
    const size = new Map<string, number>()
    for (const item of items.value) {
      const key = groupKeyOf(item)
      size.set(key, (size.get(key) ?? 0) + 1)
    }
    const rank = [...size.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key)

    return items.value
      .map((item, index) => ({ item, index }))
      .sort((a, b) => rank.indexOf(groupKeyOf(a.item)) - rank.indexOf(groupKeyOf(b.item)) || a.index - b.index)
      .map((entry) => entry.item)
  })

  const groups = computed<ReviewGroup[]>(() => {
    const out: ReviewGroup[] = []
    for (const item of ordered.value) {
      const key = groupKeyOf(item)
      if (out[out.length - 1]?.key !== key) out.push({ key, label: groupLabelOf(item), items: [] })
      out[out.length - 1]!.items.push(item)
    }
    return out
  })

  /** Rows the rail actually renders, honouring collapsed groups. Keyboard travel follows this. */
  const visible = computed<BulkRenamePreviewItem[]>(() => groups.value.flatMap((group) => (collapsed.value.has(group.key) ? [] : group.items)))

  const current = computed<BulkRenamePreviewItem | null>(
    () => ordered.value.find((item) => item.bookId === selectedId.value) ?? ordered.value[0] ?? null,
  )

  const currentKind = computed(() => (current.value ? (kinds.value.get(current.value.bookId) ?? null) : null))

  const currentIndex = computed(() => visible.value.findIndex((item) => item.bookId === current.value?.bookId))

  /** Other loaded books whose rename is the same kind of change, for quick context. */
  const siblings = computed<BulkRenamePreviewItem[]>(() => {
    const item = current.value
    if (!item) return []
    const key = groupKeyOf(item)
    return ordered.value.filter((other) => other.bookId !== item.bookId && groupKeyOf(other) === key)
  })

  /** Books a run would rename. Only `all-except` needs the server total; `only` is self-describing. */
  const selectedCount = computed(() => (mode.value === 'all-except' ? Math.max(0, totalRenameable.value - marked.value.size) : marked.value.size))

  const selectionState = computed<TriState>(() => {
    if (selectedCount.value === 0) return 'none'
    if (selectedCount.value >= totalRenameable.value) return 'all'
    return 'some'
  })

  /** The narrower of the two lists, which is what the run request carries. */
  const runSelection = computed<BulkRenameExecuteRequest>(() =>
    mode.value === 'all-except' ? { excludeBookIds: [...marked.value] } : { includeBookIds: [...marked.value] },
  )

  function isSelected(item: BulkRenamePreviewItem): boolean {
    if (item.status !== 'will_rename') return false
    return mode.value === 'all-except' ? !marked.value.has(item.bookId) : marked.value.has(item.bookId)
  }

  function kindOf(item: BulkRenamePreviewItem): ChangeKind | null {
    return kinds.value.get(item.bookId) ?? null
  }

  function select(bookId: number): void {
    selectedId.value = bookId
  }

  function step(delta: number): void {
    const next = visible.value[currentIndex.value + delta]
    if (next) select(next.bookId)
  }

  /** Marking means "leave out" under `all-except` and "include" under `only`, so one set serves both. */
  function setSelected(item: BulkRenamePreviewItem, selected: boolean): void {
    if (item.status !== 'will_rename') return
    const next = new Set(marked.value)
    const shouldMark = mode.value === 'all-except' ? !selected : selected
    if (shouldMark) next.add(item.bookId)
    else next.delete(item.bookId)
    marked.value = next
  }

  function toggleSelected(item: BulkRenamePreviewItem): void {
    setSelected(item, !isSelected(item))
  }

  function selectAll(): void {
    mode.value = 'all-except'
    marked.value = new Set()
  }

  function selectNone(): void {
    mode.value = 'only'
    marked.value = new Set()
  }

  function toggleAll(): void {
    if (selectionState.value === 'all') selectNone()
    else selectAll()
  }

  function renameableIn(key: string): BulkRenamePreviewItem[] {
    return (groups.value.find((group) => group.key === key)?.items ?? []).filter((item) => item.status === 'will_rename')
  }

  /**
   * Group state covers the rows actually loaded, which is also what the group's count shows, so
   * the checkbox never claims authority over books that are not on screen.
   */
  function groupState(key: string): TriState {
    const renameable = renameableIn(key)
    if (renameable.length === 0) return 'none'
    const chosen = renameable.filter(isSelected).length
    if (chosen === 0) return 'none'
    return chosen === renameable.length ? 'all' : 'some'
  }

  function setGroupSelected(key: string, selected: boolean): void {
    const renameable = renameableIn(key)
    if (renameable.length === 0) return
    const next = new Set(marked.value)
    const shouldMark = mode.value === 'all-except' ? !selected : selected
    for (const item of renameable) {
      if (shouldMark) next.add(item.bookId)
      else next.delete(item.bookId)
    }
    marked.value = next
  }

  function toggleGroupSelected(key: string): void {
    setGroupSelected(key, groupState(key) !== 'all')
  }

  function toggleGroup(key: string): void {
    const next = new Set(collapsed.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    collapsed.value = next
  }

  function reset(): void {
    selectedId.value = null
    mode.value = 'all-except'
    marked.value = new Set()
    collapsed.value = new Set()
  }

  /**
   * The books still listed after a run are the ones the reviewer deliberately left out, so the
   * selection must not spring back to "everything": that would re-arm Apply with exactly the
   * renames that were just declined. Ending on an empty selection is also the only state that
   * cannot be stale, since ids from the finished run are dropped rather than carried over.
   */
  function resetAfterRun(): void {
    selectedId.value = null
    selectNone()
  }

  return {
    selectedId,
    mode,
    marked,
    collapsed,

    groups,
    visible,
    current,
    currentKind,
    currentIndex,
    siblings,
    selectedCount,
    selectionState,
    runSelection,

    kindOf,
    isSelected,
    groupState,
    select,
    step,
    setSelected,
    toggleSelected,
    selectAll,
    selectNone,
    toggleAll,
    setGroupSelected,
    toggleGroupSelected,
    toggleGroup,
    reset,
    resetAfterRun,
  }
}
