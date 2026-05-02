import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'

const mockStorage: Record<string, string> = {}

vi.stubGlobal('localStorage', {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value
  },
  removeItem: (key: string) => {
    delete mockStorage[key]
  },
  clear: () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  },
})

import { useTableColumns, COLUMN_DEFS, LOCK_ROW_COLUMN_DEF, type ColumnId } from '../useTableColumns'

const ALL_IDS = COLUMN_DEFS.map((c) => c.id) as ColumnId[]

describe('useTableColumns', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns default visible columns', () => {
    const { visibleColumns } = useTableColumns('library')
    const ids = visibleColumns.value.map((c) => c.id)
    const defaultVisible = COLUMN_DEFS.filter((c) => c.defaultVisible).map((c) => c.id)
    expect(ids).toEqual(defaultVisible)
  })

  it('returns all columns with visible flag in allColumns', () => {
    const { allColumns } = useTableColumns('library')
    expect(allColumns.value).toHaveLength(COLUMN_DEFS.length)
    const hiddenIds = COLUMN_DEFS.filter((c) => !c.defaultVisible).map((c) => c.id)
    for (const col of allColumns.value) {
      expect(col.visible).toBe(!hiddenIds.includes(col.id))
    }
  })

  it('toggleColumn hides a visible column', () => {
    const { visibleColumns, toggleColumn } = useTableColumns('library')
    const titleVisible = visibleColumns.value.some((c) => c.id === 'title')
    expect(titleVisible).toBe(true)

    toggleColumn('title')

    const titleVisibleAfter = visibleColumns.value.some((c) => c.id === 'title')
    expect(titleVisibleAfter).toBe(false)
  })

  it('toggleColumn shows a hidden column', () => {
    const { visibleColumns, allColumns, toggleColumn } = useTableColumns('library')
    const hiddenCol = allColumns.value.find((c) => !c.visible)!
    expect(hiddenCol).toBeDefined()

    toggleColumn(hiddenCol.id)

    const nowVisible = visibleColumns.value.some((c) => c.id === hiddenCol.id)
    expect(nowVisible).toBe(true)
  })

  it('setColumnOrder reorders columns', () => {
    const { allColumns, setColumnOrder } = useTableColumns('library')
    const ids = allColumns.value.map((c) => c.id)
    const reversed = [...ids].reverse() as ColumnId[]

    setColumnOrder(reversed)

    expect(allColumns.value.map((c) => c.id)).toEqual(reversed)
  })

  it('setColumnOrder updates visibleColumns order', () => {
    const { visibleColumns, allColumns, setColumnOrder } = useTableColumns('library')
    const unpinnedVisible = allColumns.value.filter((c) => c.pinned === null && c.visible)
    const reversedAll = allColumns.value.map((c) => c.id).reverse() as ColumnId[]

    setColumnOrder(reversedAll)

    const newVisible = visibleColumns.value.filter((c) => c.pinned === null).map((c) => c.id)
    const reversedUnpinnedVisible = unpinnedVisible.map((c) => c.id).reverse()
    expect(newVisible).toEqual(reversedUnpinnedVisible)
  })

  it('setColumnOrder persists the new order to localStorage', async () => {
    const { allColumns, setColumnOrder } = useTableColumns('library')
    const ids = allColumns.value.map((c) => c.id) as ColumnId[]
    const swapped = [...ids]
    const unpinnedIdxs = swapped.reduce<number[]>((acc, id, i) => {
      const col = allColumns.value.find((c) => c.id === id)
      if (col?.pinned === null) acc.push(i)
      return acc
    }, [])
    if (unpinnedIdxs.length >= 2) {
      const tmp = swapped[unpinnedIdxs[0]!]!
      swapped[unpinnedIdxs[0]!] = swapped[unpinnedIdxs[1]!]!
      swapped[unpinnedIdxs[1]!] = tmp
    }

    setColumnOrder(swapped)
    await nextTick()
    vi.advanceTimersByTime(600)
    await nextTick()

    const raw = mockStorage['bookorbit:tableLayout:library']
    expect(raw).toBeDefined()
    const parsed = JSON.parse(raw!)
    expect(parsed.columnOrder).toEqual(swapped)
  })

  it('setColumnOrder with unknown IDs: loadLayout filters them out and appends missing', () => {
    const knownIds = COLUMN_DEFS.map((c) => c.id) as ColumnId[]
    mockStorage['bookorbit:tableLayout:library'] = JSON.stringify({
      columnOrder: ['unknown_col', ...knownIds],
      hiddenColumns: [],
      columnWidths: {},
    })
    const { allColumns } = useTableColumns('library')
    expect(allColumns.value).toHaveLength(COLUMN_DEFS.length)
    const ids = allColumns.value.map((c) => c.id)
    expect(ids).not.toContain('unknown_col')
  })

  it('loadLayout initializes pinnedColumns as empty object when missing from storage', () => {
    const knownIds = COLUMN_DEFS.map((c) => c.id) as ColumnId[]
    mockStorage['bookorbit:tableLayout:library'] = JSON.stringify({
      columnOrder: knownIds,
      hiddenColumns: [],
      columnWidths: {},
    })
    const { pinColumn, visibleColumns } = useTableColumns('library')
    pinColumn('title', 'left')
    const titleCol = visibleColumns.value.find((c) => c.id === 'title')
    expect(titleCol?.pinned).toBe('left')
  })

  it('loadLayout filters invalid pinnedColumns entries and keeps explicit null overrides', () => {
    const knownIds = COLUMN_DEFS.map((c) => c.id) as ColumnId[]
    mockStorage['bookorbit:tableLayout:library'] = JSON.stringify({
      columnOrder: knownIds,
      hiddenColumns: [],
      columnWidths: {},
      pinnedColumns: { unknown_col: 'left', title: null, rating: 'right', authors: 'center' },
    })
    const { visibleColumns } = useTableColumns('library')
    const titleCol = visibleColumns.value.find((c) => c.id === 'title')
    const ratingCol = visibleColumns.value.find((c) => c.id === 'rating')
    expect(titleCol?.pinned).toBeNull()
    expect(ratingCol?.pinned).toBe('right')
  })

  it('setColumnWidth updates the width for a column', () => {
    const { visibleColumns, setColumnWidth } = useTableColumns('library')
    const before = visibleColumns.value.find((c) => c.id === 'title')!.defaultWidth
    setColumnWidth('title', before + 100)
    const after = visibleColumns.value.find((c) => c.id === 'title')!.defaultWidth
    expect(after).toBe(before + 100)
  })

  it('setColumnWidth does not go below minWidth', () => {
    const { visibleColumns, setColumnWidth } = useTableColumns('library')
    const def = COLUMN_DEFS.find((c) => c.id === 'title')!
    setColumnWidth('title', 1)
    const after = visibleColumns.value.find((c) => c.id === 'title')!.defaultWidth
    expect(after).toBeGreaterThanOrEqual(def.minWidth)
  })

  it('persists layout to localStorage', async () => {
    const { toggleColumn } = useTableColumns('library')
    toggleColumn('title')
    await nextTick()
    vi.advanceTimersByTime(600)
    await nextTick()
    const raw = mockStorage['bookorbit:tableLayout:library']
    expect(raw).toBeDefined()
    const parsed = JSON.parse(raw!)
    expect(parsed.hiddenColumns).toContain('title')
  })

  it('restores layout from localStorage on init', () => {
    mockStorage['bookorbit:tableLayout:library'] = JSON.stringify({
      columnOrder: ALL_IDS,
      hiddenColumns: ['language', 'addedAt'],
      columnWidths: { title: 999 },
    })
    const { visibleColumns } = useTableColumns('library')
    expect(visibleColumns.value.some((c) => c.id === 'language')).toBe(false)
    expect(visibleColumns.value.some((c) => c.id === 'addedAt')).toBe(false)
    expect(visibleColumns.value.find((c) => c.id === 'title')?.defaultWidth).toBe(999)
  })

  it('per-view-type isolation: library and collection layouts do not share state', () => {
    const lib = useTableColumns('library')
    const col = useTableColumns('collection')

    lib.toggleColumn('language')

    expect(lib.allColumns.value.find((c) => c.id === 'language')?.visible).toBe(true)
    expect(col.allColumns.value.find((c) => c.id === 'language')?.visible).toBe(COLUMN_DEFS.find((c) => c.id === 'language')!.defaultVisible)
  })

  it('resetLayout restores all defaults and removes custom overrides', async () => {
    const { toggleColumn, resetLayout, allColumns } = useTableColumns('library')
    // Hide a default-visible column to create a custom state
    toggleColumn('title')
    await nextTick()
    expect(allColumns.value.find((c) => c.id === 'title')?.visible).toBe(false)

    resetLayout()
    await nextTick()

    // After reset, title should be visible again (back to default)
    const titleVisible = allColumns.value.find((c) => c.id === 'title')?.visible
    expect(titleVisible).toBe(COLUMN_DEFS.find((c) => c.id === 'title')!.defaultVisible)
    // Hidden columns should match default set only
    const hiddenIds = allColumns.value.filter((c) => !c.visible).map((c) => c.id)
    const expectedHidden = COLUMN_DEFS.filter((c) => !c.defaultVisible).map((c) => c.id)
    expect(hiddenIds.sort()).toEqual(expectedHidden.sort())
  })

  it('falls back to defaults when persisted JSON is invalid', () => {
    mockStorage['bookorbit:tableLayout:library'] = '{ invalid json }'
    const { allColumns } = useTableColumns('library')
    expect(allColumns.value).toHaveLength(COLUMN_DEFS.length)
  })

  it('falls back gracefully when persisted columnOrder has unknown IDs', () => {
    mockStorage['bookorbit:tableLayout:library'] = JSON.stringify({
      columnOrder: ['nonexistent_col', 'title'],
      hiddenColumns: [],
      columnWidths: {},
    })
    const { allColumns } = useTableColumns('library')
    expect(allColumns.value).toHaveLength(COLUMN_DEFS.length)
  })

  it('keeps the title column unpinned by default', () => {
    const title = COLUMN_DEFS.find((column) => column.id === 'title')
    expect(title?.pinned).toBeNull()
  })

  it('maps language and reading progress columns to explicit sort fields', () => {
    const language = COLUMN_DEFS.find((column) => column.id === 'language')
    const readingProgress = COLUMN_DEFS.find((column) => column.id === 'readingProgress')

    expect(language?.sortField).toBe('language')
    expect(readingProgress?.sortField).toBe('readProgress')
  })

  it('setLayout replaces the full layout state', async () => {
    const { allColumns, visibleColumns, setLayout } = useTableColumns('library')

    setLayout({
      columnOrder: ['title', ...ALL_IDS.filter((id) => id !== 'title')],
      hiddenColumns: ['authors', 'language'],
      columnWidths: { title: 720 },
    })
    await nextTick()

    expect(allColumns.value[0]?.id).toBe('title')
    expect(allColumns.value.find((column) => column.id === 'authors')?.visible).toBe(false)
    expect(allColumns.value.find((column) => column.id === 'language')?.visible).toBe(false)
    expect(visibleColumns.value.find((column) => column.id === 'title')?.defaultWidth).toBe(720)
  })

  it('pinColumn pins unpinned column to specified side', () => {
    const { pinColumn, allColumns } = useTableColumns('library')
    pinColumn('rating', 'left')
    const col = allColumns.value.find((c) => c.id === 'rating')
    expect(col?.pinned).toBe('left')
  })

  it('unpinColumn restores column to def default pinned state', () => {
    const { pinColumn, unpinColumn, allColumns } = useTableColumns('library')
    pinColumn('rating', 'left')
    expect(allColumns.value.find((c) => c.id === 'rating')?.pinned).toBe('left')
    unpinColumn('rating')
    const def = COLUMN_DEFS.find((c) => c.id === 'rating')
    expect(allColumns.value.find((c) => c.id === 'rating')?.pinned).toBe(def?.pinned ?? null)
  })

  it('unpinColumn keeps title unpinned', () => {
    const { unpinColumn, allColumns } = useTableColumns('library')
    const before = allColumns.value.find((c) => c.id === 'title')
    expect(before?.pinned).toBeNull()

    unpinColumn('title')

    const after = allColumns.value.find((c) => c.id === 'title')
    expect(after?.pinned).toBeNull()
  })

  it('pinColumn enforces max 3 per side', () => {
    const { pinColumn, allColumns } = useTableColumns('library')
    pinColumn('rating', 'right')
    pinColumn('authors', 'right')
    pinColumn('seriesName', 'right')
    pinColumn('genres', 'right')
    const pinnedRight = allColumns.value.filter((c) => c.pinned === 'right')
    expect(pinnedRight.some((c) => c.id === 'genres')).toBe(false)
  })

  it('setLayout with pinnedColumns restores pin state', async () => {
    const { setLayout, allColumns } = useTableColumns('library')
    setLayout({
      columnOrder: ALL_IDS,
      hiddenColumns: [],
      columnWidths: {},
      pinnedColumns: { rating: 'left' },
    })
    await nextTick()
    expect(allColumns.value.find((c) => c.id === 'rating')?.pinned).toBe('left')
  })

  it('resetLayout clears pinnedColumns', async () => {
    const { pinColumn, resetLayout, allColumns } = useTableColumns('library')
    pinColumn('rating', 'left')
    resetLayout()
    await nextTick()
    const col = allColumns.value.find((c) => c.id === 'rating')
    const def = COLUMN_DEFS.find((c) => c.id === 'rating')
    expect(col?.pinned).toBe(def?.pinned ?? null)
  })

  it('setColumnWidth clamps to upper bound of 800', () => {
    const { setColumnWidth, visibleColumns } = useTableColumns('library')
    setColumnWidth('title', 1500)
    const title = visibleColumns.value.find((c) => c.id === 'title')
    expect(title?.defaultWidth).toBeLessThanOrEqual(800)
  })
})

describe('LOCK_ROW_COLUMN_DEF', () => {
  it('has id lockRow', () => {
    expect(LOCK_ROW_COLUMN_DEF.id).toBe('lockRow')
  })

  it('has cellType lockRow', () => {
    expect(LOCK_ROW_COLUMN_DEF.cellType).toBe('lockRow')
  })

  it('is pinned left', () => {
    expect(LOCK_ROW_COLUMN_DEF.pinned).toBe('left')
  })

  it('is not in the default visible column set', () => {
    expect(LOCK_ROW_COLUMN_DEF.defaultVisible).toBe(false)
  })

  it('is not included in COLUMN_DEFS', () => {
    expect(COLUMN_DEFS.find((c) => c.id === 'lockRow')).toBeUndefined()
  })

  it('has a compact width suitable for icon button', () => {
    expect(LOCK_ROW_COLUMN_DEF.defaultWidth).toBeLessThanOrEqual(48)
  })
})
