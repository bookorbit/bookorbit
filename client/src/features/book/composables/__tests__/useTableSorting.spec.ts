import { describe, it, expect, beforeEach } from 'vitest'
import { useTableSorting } from '../useTableSorting'
import type { SortSpec } from '@bookorbit/types'
import type { ColumnDef } from '../tableColumnSchema'

function makeSortable(field: string): ColumnDef {
  return {
    id: field as never,
    header: field,
    cellType: 'text',
    isEditable: false,
    sortField: field as never,
    defaultWidth: 100,
    minWidth: 60,
    defaultVisible: true,
    pinned: null,
  }
}

function makeUnsortable(): ColumnDef {
  return {
    id: 'cover',
    header: '',
    cellType: 'cover',
    isEditable: false,
    sortField: null,
    defaultWidth: 48,
    minWidth: 48,
    defaultVisible: true,
    pinned: 'left',
  }
}

describe('useTableSorting', () => {
  let currentSort: SortSpec[]
  let emitted: SortSpec[][]
  let sortEnabled: boolean
  let sorting: ReturnType<typeof useTableSorting>

  beforeEach(() => {
    currentSort = [{ field: 'title', dir: 'asc' }]
    emitted = []
    sortEnabled = true
    sorting = useTableSorting(
      () => currentSort,
      () => sortEnabled,
      (sort) => {
        emitted.push(sort)
        currentSort = sort
      },
    )
  })

  describe('isSortableColumn', () => {
    it('returns false when sortField is null', () => {
      expect(sorting.isSortableColumn(makeUnsortable())).toBe(false)
    })

    it('returns false when sorting is disabled', () => {
      sortEnabled = false
      expect(sorting.isSortableColumn(makeSortable('title'))).toBe(false)
    })

    it('returns true when sortField is set and sorting enabled', () => {
      expect(sorting.isSortableColumn(makeSortable('title'))).toBe(true)
    })
  })

  describe('getSortDir', () => {
    it('returns null when field is not in sort', () => {
      currentSort = [{ field: 'title', dir: 'asc' }]
      expect(sorting.getSortDir('authors')).toBeNull()
    })

    it('returns asc for an asc sorted field', () => {
      currentSort = [{ field: 'title', dir: 'asc' }]
      expect(sorting.getSortDir('title')).toBe('asc')
    })

    it('returns desc for a desc sorted field', () => {
      currentSort = [{ field: 'title', dir: 'desc' }]
      expect(sorting.getSortDir('title')).toBe('desc')
    })
  })

  describe('getSortPriority', () => {
    it('returns 0 for null field', () => {
      expect(sorting.getSortPriority(null)).toBe(0)
    })

    it('returns 0 for field not in sort', () => {
      expect(sorting.getSortPriority('authors')).toBe(0)
    })

    it('returns 1-based index for active field', () => {
      currentSort = [
        { field: 'title', dir: 'asc' },
        { field: 'author', dir: 'asc' },
      ]
      expect(sorting.getSortPriority('title')).toBe(1)
      expect(sorting.getSortPriority('author')).toBe(2)
    })
  })

  describe('handleColumnSort', () => {
    it('does nothing when sortField is null', () => {
      sorting.handleColumnSort(null, new MouseEvent('click'))
      expect(emitted).toHaveLength(0)
    })

    it('does nothing when sorting is disabled', () => {
      sortEnabled = false
      sorting.handleColumnSort('title', new MouseEvent('click'))
      expect(emitted).toHaveLength(0)
    })

    it('sets asc sort when clicking unsorted field without shift', () => {
      currentSort = []
      sorting.handleColumnSort('author', new MouseEvent('click'))
      expect(emitted[0]).toEqual([{ field: 'author', dir: 'asc' }])
    })

    it('toggles asc to desc when clicking already-asc field', () => {
      currentSort = [{ field: 'title', dir: 'asc' }]
      sorting.handleColumnSort('title', new MouseEvent('click'))
      expect(emitted[0]).toEqual([{ field: 'title', dir: 'desc' }])
    })

    it('resets to title asc when clicking already-desc field', () => {
      currentSort = [{ field: 'title', dir: 'desc' }]
      sorting.handleColumnSort('title', new MouseEvent('click'))
      expect(emitted[0]).toEqual([{ field: 'title', dir: 'asc' }])
    })

    it('adds to multi-sort when shift is held', () => {
      currentSort = [{ field: 'title', dir: 'asc' }]
      sorting.handleColumnSort('author', new MouseEvent('click', { shiftKey: true }))
      expect(emitted[0]).toEqual([
        { field: 'title', dir: 'asc' },
        { field: 'author', dir: 'asc' },
      ])
    })

    it('cycles asc->desc when shift-clicking already-asc field in multi-sort', () => {
      currentSort = [
        { field: 'title', dir: 'asc' },
        { field: 'author', dir: 'asc' },
      ]
      sorting.handleColumnSort('title', new MouseEvent('click', { shiftKey: true }))
      expect(emitted[0]).toEqual([
        { field: 'title', dir: 'desc' },
        { field: 'author', dir: 'asc' },
      ])
    })

    it('removes field when shift-clicking already-desc field in multi-sort', () => {
      currentSort = [
        { field: 'title', dir: 'desc' },
        { field: 'author', dir: 'asc' },
      ]
      sorting.handleColumnSort('title', new MouseEvent('click', { shiftKey: true }))
      expect(emitted[0]).toEqual([{ field: 'author', dir: 'asc' }])
    })

    it('falls back to title asc when removing last sort via shift-click', () => {
      currentSort = [{ field: 'title', dir: 'desc' }]
      sorting.handleColumnSort('title', new MouseEvent('click', { shiftKey: true }))
      expect(emitted[0]).toEqual([{ field: 'title', dir: 'asc' }])
    })
  })

  describe('removeSortField', () => {
    it('removes a field from the sort array', () => {
      currentSort = [
        { field: 'title', dir: 'asc' },
        { field: 'author', dir: 'asc' },
      ]
      sorting.removeSortField('author')
      expect(emitted[0]).toEqual([{ field: 'title', dir: 'asc' }])
    })

    it('falls back to title asc when removing the last sort field', () => {
      currentSort = [{ field: 'author', dir: 'desc' }]
      sorting.removeSortField('author')
      expect(emitted[0]).toEqual([{ field: 'title', dir: 'asc' }])
    })
  })
})
