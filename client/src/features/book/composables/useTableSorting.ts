import type { SortSpec } from '@bookorbit/types'
import type { ColumnDef } from './tableColumnSchema'

export function useTableSorting(getSort: () => SortSpec[], isSortEnabled: () => boolean, emitSort: (sort: SortSpec[]) => void) {
  function isSortableColumn(col: ColumnDef): boolean {
    return !!col.sortField && isSortEnabled()
  }

  function getSortDir(sortField: string): 'asc' | 'desc' | null {
    return getSort().find((s) => s.field === sortField)?.dir ?? null
  }

  function getSortPriority(sortField: string | null): number {
    if (!sortField) return 0
    return getSort().findIndex((s) => s.field === sortField) + 1
  }

  function handleColumnSort(sortField: string | null, event: MouseEvent): void {
    if (!sortField || !isSortEnabled()) return

    if (event.shiftKey && getSort().length > 0) {
      const existing = getSort().find((s) => s.field === sortField)
      let next: SortSpec[]
      if (!existing) {
        next = [...getSort(), { field: sortField as SortSpec['field'], dir: 'asc' }]
      } else if (existing.dir === 'asc') {
        next = getSort().map((s) => (s.field === sortField ? { ...s, dir: 'desc' as const } : s))
      } else {
        next = getSort().filter((s) => s.field !== sortField)
        if (next.length === 0) next = [{ field: 'title' as SortSpec['field'], dir: 'asc' }]
      }
      emitSort(next)
      return
    }

    const current = getSort().find((s) => s.field === sortField)
    let next: SortSpec[]
    if (!current) {
      next = [{ field: sortField as SortSpec['field'], dir: 'asc' }]
    } else if (current.dir === 'asc') {
      next = [{ field: sortField as SortSpec['field'], dir: 'desc' }]
    } else {
      next = [{ field: 'title' as SortSpec['field'], dir: 'asc' }]
    }
    emitSort(next)
  }

  function removeSortField(field: string): void {
    const next = getSort().filter((s) => s.field !== field)
    emitSort(next.length > 0 ? next : [{ field: 'title' as SortSpec['field'], dir: 'asc' }])
  }

  return { isSortableColumn, getSortDir, getSortPriority, handleColumnSort, removeSortField }
}
