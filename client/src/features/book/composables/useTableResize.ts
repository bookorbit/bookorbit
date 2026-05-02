import { ref, onMounted, onUnmounted, type Ref } from 'vue'
import type { ColumnId } from './useTableColumns'
import type { ColumnDef } from './useTableColumns'

export function useTableResize(
  scrollContainerRef: Ref<HTMLDivElement | null>,
  displayColumns: Ref<ColumnDef[]>,
  setColumnWidth: (id: ColumnId, px: number) => void,
  isReadOnly: Ref<boolean>,
) {
  const resizingColumnId = ref<ColumnId | null>(null)
  const resizeStartX = ref(0)
  const resizeStartWidth = ref(0)

  function isResizableCol(col: ColumnDef): boolean {
    return !isReadOnly.value && col.id !== 'lockRow'
  }

  function startResize(e: MouseEvent, colId: ColumnId, currentWidth: number) {
    if (isReadOnly.value) return
    resizingColumnId.value = colId
    resizeStartX.value = e.clientX
    resizeStartWidth.value = currentWidth
    e.preventDefault()
  }

  function onResizeMove(e: MouseEvent) {
    if (!resizingColumnId.value) return
    const delta = e.clientX - resizeStartX.value
    setColumnWidth(resizingColumnId.value, resizeStartWidth.value + delta)
  }

  function stopResize() {
    resizingColumnId.value = null
  }

  function autoFitColumn(colId: ColumnId): void {
    if (!scrollContainerRef.value) return
    const table = scrollContainerRef.value.querySelector('table')
    if (!table) return

    const column = displayColumns.value.find((currentColumn) => currentColumn.id === colId)
    if (!column) return

    let maxWidth = column.minWidth
    const headerCell = table.querySelector(`thead [data-col-id="${colId}"] [data-col-label]`) as HTMLElement | null
    if (headerCell) {
      maxWidth = Math.max(maxWidth, headerCell.scrollWidth + 32)
    }

    const cells = table.querySelectorAll(`tbody tr td[data-col-id="${colId}"]`)
    cells.forEach((cell) => {
      const element = cell as HTMLElement
      maxWidth = Math.max(maxWidth, element.scrollWidth + 16)
    })

    setColumnWidth(colId, Math.min(400, maxWidth))
  }

  function autoFitAllColumns(): void {
    for (const col of displayColumns.value) {
      if (col.id !== 'lockRow') autoFitColumn(col.id)
    }
  }

  onMounted(() => {
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', stopResize)
  })

  onUnmounted(() => {
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', stopResize)
  })

  return {
    resizingColumnId,
    isResizableCol,
    startResize,
    autoFitColumn,
    autoFitAllColumns,
  }
}
