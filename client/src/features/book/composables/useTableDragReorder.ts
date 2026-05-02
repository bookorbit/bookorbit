import { ref, type Ref } from 'vue'
import type { ColumnId, ColumnDef } from './useTableColumns'

export function useTableDragReorder(allColumns: Ref<ColumnDef[]>, setColumnOrder: (order: ColumnId[]) => void) {
  const dragSourceColId = ref<ColumnId | null>(null)
  const dropTargetColId = ref<ColumnId | null>(null)
  const dropSide = ref<'before' | 'after' | null>(null)

  function isDraggableCol(col: ColumnDef): boolean {
    return col.pinned === null
  }

  function handleColDragStart(e: DragEvent, colId: ColumnId) {
    dragSourceColId.value = colId
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', colId)
    }
  }

  function handleColDragOver(e: DragEvent, col: ColumnDef) {
    if (!dragSourceColId.value || !isDraggableCol(col) || col.id === dragSourceColId.value) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    const target = e.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    dropTargetColId.value = col.id
    dropSide.value = e.clientX < midX ? 'before' : 'after'
  }

  function handleColDragLeave(colId: ColumnId) {
    if (dropTargetColId.value === colId) {
      dropTargetColId.value = null
      dropSide.value = null
    }
  }

  function handleColDrop(e: DragEvent, targetColId: ColumnId) {
    e.preventDefault()
    const sourceId = dragSourceColId.value
    if (!sourceId || sourceId === targetColId) {
      resetDragState()
      return
    }
    const unpinnedIds = allColumns.value.filter((c) => c.pinned === null).map((c) => c.id)
    const pinnedLeft = allColumns.value.filter((c) => c.pinned === 'left').map((c) => c.id)
    const pinnedRight = allColumns.value.filter((c) => c.pinned === 'right').map((c) => c.id)

    const withoutSource = unpinnedIds.filter((id) => id !== sourceId)
    const targetIdx = withoutSource.indexOf(targetColId)
    if (targetIdx === -1) {
      resetDragState()
      return
    }
    const insertIdx = dropSide.value === 'after' ? targetIdx + 1 : targetIdx
    const newUnpinned = [...withoutSource.slice(0, insertIdx), sourceId, ...withoutSource.slice(insertIdx)]
    setColumnOrder([...pinnedLeft, ...newUnpinned, ...pinnedRight])
    resetDragState()
  }

  function handleColDragEnd() {
    resetDragState()
  }

  function resetDragState() {
    dragSourceColId.value = null
    dropTargetColId.value = null
    dropSide.value = null
  }

  return {
    dragSourceColId,
    dropTargetColId,
    dropSide,
    isDraggableCol,
    handleColDragStart,
    handleColDragOver,
    handleColDragLeave,
    handleColDrop,
    handleColDragEnd,
  }
}
