import { computed, ref, shallowRef, type Ref } from 'vue'
import type { AudiobookChapter } from '@bookorbit/types'
import { fromDraft, sameChapterList, sortByStart, toDraft, validateChapters, type ChapterIssue, type DraftChapter } from '../lib/chapter-edit'

const HISTORY_LIMIT = 200

/**
 * The editor's working copy. Every change goes through `apply`, which keeps an undo history; a run
 * of edits to the same field (typing a title, tapping a nudge button) collapses into one step.
 */
export function useChapterDraft(totalDurationMs: Ref<number | null>) {
  const rows = shallowRef<DraftChapter[]>([])
  const baseline = shallowRef<AudiobookChapter[]>([])
  const undoStack = shallowRef<DraftChapter[][]>([])
  const redoStack = shallowRef<DraftChapter[][]>([])
  const selected = ref<Set<string>>(new Set())
  const activeKey = ref<string | null>(null)
  /** Where each row started when the list was last loaded or saved; rows added since have none. */
  const savedStarts = shallowRef<Map<string, number>>(new Map())
  let selectionAnchor: string | null = null
  const generation = ref(0)
  let coalesceTarget: string | null = null

  const isDirty = computed(() => !sameChapterList(fromDraft(rows.value), baseline.value))
  const issues = computed<ChapterIssue[]>(() => validateChapters(rows.value, totalDurationMs.value))
  const errorCount = computed(() => issues.value.filter((issue) => issue.severity === 'error').length)
  const warningCount = computed(() => issues.value.length - errorCount.value)
  const issuesByKey = computed(() => {
    const map = new Map<string, ChapterIssue[]>()
    for (const issue of issues.value) map.set(issue.key, [...(map.get(issue.key) ?? []), issue])
    return map
  })
  const activeIndex = computed(() => rows.value.findIndex((row) => row.key === activeKey.value))
  const activeRow = computed(() => rows.value[activeIndex.value] ?? null)
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  function reset(chapters: readonly AudiobookChapter[]): void {
    generation.value += 1
    selectionAnchor = null
    const activeStart = activeRow.value?.startMs
    const activeAt = Math.max(activeIndex.value, 0)
    rows.value = toDraft(chapters)
    savedStarts.value = new Map(rows.value.map((row) => [row.key, row.startMs]))
    baseline.value = chapters.map((chapter) => ({ ...chapter }))
    undoStack.value = []
    redoStack.value = []
    selected.value = new Set()
    coalesceTarget = null
    // A discarded move leaves no row at the moved start; the chapter in the same place stays chosen.
    activeKey.value = rows.value.find((row) => row.startMs === activeStart)?.key ?? rows.value[Math.min(activeAt, rows.value.length - 1)]?.key ?? null
    selectionAnchor = activeKey.value
  }

  function apply(next: DraftChapter[], options: { coalesce?: string } = {}): void {
    if (!options.coalesce || options.coalesce !== coalesceTarget) {
      undoStack.value = [...undoStack.value.slice(-(HISTORY_LIMIT - 1)), rows.value]
      redoStack.value = []
    }
    coalesceTarget = options.coalesce ?? null
    replaceRows(next)
  }

  /** Ends a coalescing run, so the next edit to the same field becomes its own undo step. */
  function settle(): void {
    coalesceTarget = null
  }

  function undo(): void {
    const previous = undoStack.value.at(-1)
    if (!previous) return
    undoStack.value = undoStack.value.slice(0, -1)
    redoStack.value = [...redoStack.value, rows.value]
    coalesceTarget = null
    replaceRows(previous)
  }

  function redo(): void {
    const next = redoStack.value.at(-1)
    if (!next) return
    redoStack.value = redoStack.value.slice(0, -1)
    undoStack.value = [...undoStack.value, rows.value]
    coalesceTarget = null
    replaceRows(next)
  }

  function replaceRows(next: DraftChapter[]): void {
    const previousIndex = Math.max(activeIndex.value, 0)
    generation.value += 1
    rows.value = next
    const keys = new Set(next.map((row) => row.key))
    if ([...selected.value].some((key) => !keys.has(key))) selected.value = new Set([...selected.value].filter((key) => keys.has(key)))
    if (!activeKey.value || !keys.has(activeKey.value)) activeKey.value = next[Math.min(previousIndex, next.length - 1)]?.key ?? null
  }

  function updateTitle(key: string, title: string): void {
    apply(
      rows.value.map((row) => (row.key === key ? { ...row, title } : row)),
      { coalesce: `title:${key}` },
    )
  }

  /** Rows stay in time order, so a start that passes its neighbour moves the row rather than leaving it out of order. */
  function updateStart(key: string, startMs: number, options: { coalesce?: string } = {}): void {
    apply(sortByStart(rows.value.map((row) => (row.key === key ? { ...row, startMs: Math.max(0, Math.round(startMs)) } : row))), options)
  }

  function nudge(key: string, deltaMs: number): void {
    const row = rows.value.find((candidate) => candidate.key === key)
    if (!row) return
    updateStart(key, row.startMs + deltaMs, { coalesce: `nudge:${key}` })
  }

  function setActive(key: string): void {
    activeKey.value = key
    settle()
  }

  function toggleSelected(key: string, options: { range?: boolean } = {}): void {
    const next = new Set(selected.value)
    if (options.range && selectionAnchor && rows.value.some((row) => row.key === selectionAnchor)) {
      const from = rows.value.findIndex((row) => row.key === selectionAnchor)
      const to = rows.value.findIndex((row) => row.key === key)
      const [low, high] = from < to ? [from, to] : [to, from]
      for (const row of rows.value.slice(low, high + 1)) next.add(row.key)
    } else if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    if (!options.range) selectionAnchor = key
    selected.value = next
  }

  function selectAll(): void {
    selected.value = new Set(rows.value.map((row) => row.key))
  }

  function clearSelection(): void {
    selected.value = new Set()
  }

  /** What a bulk tool acts on: the selection, or every row when nothing is selected. */
  function targetKeys(): Set<string> {
    return selected.value.size > 0 ? new Set(selected.value) : new Set(rows.value.map((row) => row.key))
  }

  /** Rows from the active one to the end: the scope of "shift from here". */
  function keysFromActive(): Set<string> {
    const from = Math.max(activeIndex.value, 0)
    return new Set(rows.value.slice(from).map((row) => row.key))
  }

  function acknowledge(chapters: readonly AudiobookChapter[], savedGeneration: number): void {
    if (savedGeneration === generation.value) reset(chapters)
    else baseline.value = chapters.map((chapter) => ({ ...chapter }))
  }

  return {
    generation,
    acknowledge,
    rows,
    selected,
    activeKey,
    activeIndex,
    activeRow,
    isDirty,
    issues,
    issuesByKey,
    errorCount,
    warningCount,
    canUndo,
    canRedo,
    reset,
    apply,
    settle,
    undo,
    redo,
    updateTitle,
    updateStart,
    nudge,
    setActive,
    toggleSelected,
    selectAll,
    clearSelection,
    targetKeys,
    keysFromActive,
    savedStartOf: (key: string): number | null => savedStarts.value.get(key) ?? null,
    chapters: () => fromDraft(rows.value),
  }
}
