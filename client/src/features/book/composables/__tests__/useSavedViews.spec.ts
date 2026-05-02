import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useSavedViews } from '../useSavedViews'

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
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
  },
})

describe('useSavedViews', () => {
  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
  })

  it('saves views with cloned layout, sort, and filter', async () => {
    const scopeId = ref<number | null>(12)
    const savedViews = useSavedViews('library', scopeId)
    const layout = {
      columnOrder: ['title', 'authors'],
      hiddenColumns: ['authors'],
      columnWidths: { title: 240 },
      pinnedColumns: { title: 'left' as const },
    }
    const filter = {
      type: 'group' as const,
      join: 'AND' as const,
      rules: [{ type: 'rule' as const, field: 'title' as const, operator: 'contains' as const, value: 'Dune' }],
    }

    savedViews.saveView({ name: '  Review Queue  ', layout, sort: [{ field: 'title', dir: 'desc' }], filter })
    layout.hiddenColumns.push('title')
    await nextTick()

    expect(savedViews.savedViews.value).toHaveLength(1)
    expect(savedViews.savedViews.value[0]?.name).toBe('Review Queue')
    expect(savedViews.savedViews.value[0]?.layout.hiddenColumns).toEqual(['authors'])
    expect(savedViews.savedViews.value[0]?.filter).toEqual(filter)
  })

  it('duplicates, favorites, renames, and deletes saved views', async () => {
    const scopeId = ref<number | null>(7)
    const savedViews = useSavedViews('collection', scopeId)
    savedViews.saveView({ name: 'Original', layout: { columnOrder: ['title'], hiddenColumns: [], columnWidths: {} }, sort: [] })
    const id = savedViews.savedViews.value[0]?.id

    savedViews.toggleFavorite(id!)
    savedViews.renameView(id!, 'Renamed')
    savedViews.duplicateView(id!)
    await nextTick()

    expect(savedViews.allSavedViews.value[0]?.name).toBe('Renamed')
    expect(savedViews.allSavedViews.value[0]?.favorite).toBe(true)
    expect(savedViews.savedViews.value).toHaveLength(2)

    savedViews.deleteView(id!)
    await nextTick()
    expect(savedViews.savedViews.value).toHaveLength(1)
  })

  it('reloads saved views when the scope changes', async () => {
    mockStorage['bookorbit:savedViews:smartScope:1'] = JSON.stringify([
      { id: 'saved_view_one', name: 'One', layout: { columnOrder: ['title'], hiddenColumns: [], columnWidths: {} }, sort: [] },
    ])
    mockStorage['bookorbit:savedViews:smartScope:2'] = JSON.stringify([
      { id: 'saved_view_two', name: 'Two', layout: { columnOrder: ['authors'], hiddenColumns: [], columnWidths: {} }, sort: [] },
    ])

    const scopeId = ref<number | null>(1)
    const savedViews = useSavedViews('smartScope', scopeId)
    expect(savedViews.allSavedViews.value[0]?.name).toBe('One')

    scopeId.value = 2
    await nextTick()
    expect(savedViews.allSavedViews.value[0]?.name).toBe('Two')
  })

  it('imports valid views and ignores invalid ones', () => {
    const scopeId = ref<number | null>(3)
    const savedViews = useSavedViews('library', scopeId)
    const imported = savedViews.importViews([
      { id: 'saved_view_import', name: 'Imported', layout: { columnOrder: ['title'], hiddenColumns: [], columnWidths: {} }, sort: [] },
      { id: 'bad', name: 42, layout: null, sort: [] } as never,
    ])

    expect(imported).toBe(1)
    expect(savedViews.savedViews.value).toHaveLength(1)
    expect(savedViews.savedViews.value[0]?.name).toBe('Imported')
  })
})
