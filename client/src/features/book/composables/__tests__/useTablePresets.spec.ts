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
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
  },
})

import { useTablePresets } from '../useTablePresets'
import type { ColumnId } from '../useTableColumns'

const allColumnIds = ['cover', 'title', 'authors', 'language', 'actions'] as ColumnId[]

describe('useTablePresets', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the built-in presets', () => {
    const presets = useTablePresets('library', allColumnIds)

    expect(presets.builtInPresets.value.map((preset) => preset.id)).toEqual(['default', 'compact', 'metadata'])
  })

  it('saves trimmed custom presets and persists them', async () => {
    const presets = useTablePresets('library', allColumnIds)
    const layout = {
      columnOrder: [...allColumnIds],
      hiddenColumns: ['language'],
      columnWidths: { title: 480 },
      pinnedColumns: { title: 'left' as const },
    }

    presets.savePreset('  My preset  ', layout)
    layout.hiddenColumns.push('authors')
    await nextTick()
    vi.advanceTimersByTime(600)
    await nextTick()

    expect(presets.customPresets.value).toHaveLength(1)
    expect(presets.customPresets.value[0]?.name).toBe('My preset')
    expect(presets.customPresets.value[0]?.layout.hiddenColumns).toEqual(['language'])
    expect(presets.customPresets.value[0]?.layout.pinnedColumns).toEqual({ title: 'left' })
    expect(mockStorage['bookorbit:tablePresets:library']).toContain('My preset')
  })

  it('ignores blank preset names', () => {
    const presets = useTablePresets('library', allColumnIds)

    presets.savePreset('   ', {
      columnOrder: [...allColumnIds],
      hiddenColumns: [],
      columnWidths: {},
    })

    expect(presets.customPresets.value).toHaveLength(0)
  })

  it('renames and deletes custom presets', async () => {
    const presets = useTablePresets('library', allColumnIds)
    presets.savePreset('One', {
      columnOrder: [...allColumnIds],
      hiddenColumns: [],
      columnWidths: {},
    })
    const presetId = presets.customPresets.value[0]?.id
    expect(presetId).toBeTruthy()

    presets.renamePreset(presetId!, '  Renamed  ')
    await nextTick()
    expect(presets.customPresets.value[0]?.name).toBe('Renamed')

    presets.deletePreset(presetId!)
    await nextTick()
    expect(presets.customPresets.value).toHaveLength(0)
  })

  it('isolates presets by view type', async () => {
    const libraryPresets = useTablePresets('library', allColumnIds)
    const collectionPresets = useTablePresets('collection', allColumnIds)

    libraryPresets.savePreset('Library only', {
      columnOrder: [...allColumnIds],
      hiddenColumns: ['authors'],
      columnWidths: {},
    })
    await nextTick()

    expect(libraryPresets.customPresets.value).toHaveLength(1)
    expect(collectionPresets.customPresets.value).toHaveLength(0)
  })

  it('saves sort along with layout', async () => {
    const presets = useTablePresets('library', allColumnIds)
    const layout = { columnOrder: [...allColumnIds], hiddenColumns: [], columnWidths: {} }
    const sort = [{ field: 'title' as const, dir: 'desc' as const }]
    presets.savePreset('With sort', layout, sort)
    await nextTick()

    expect(presets.customPresets.value).toHaveLength(1)
    expect(presets.customPresets.value[0]?.sort).toEqual([{ field: 'title', dir: 'desc' }])
  })

  it('saves preset without sort when sort is empty', async () => {
    const presets = useTablePresets('library', allColumnIds)
    const layout = { columnOrder: [...allColumnIds], hiddenColumns: [], columnWidths: {} }
    presets.savePreset('No sort', layout, [])
    await nextTick()

    expect(presets.customPresets.value[0]?.sort).toBeUndefined()
  })

  it('renamePreset ignores blank names', async () => {
    const presets = useTablePresets('library', allColumnIds)
    presets.savePreset('Original', { columnOrder: [...allColumnIds], hiddenColumns: [], columnWidths: {} })
    const id = presets.customPresets.value[0]?.id
    presets.renamePreset(id!, '  ')
    await nextTick()
    expect(presets.customPresets.value[0]?.name).toBe('Original')
  })

  it('allPresets includes both built-in and custom', () => {
    const presets = useTablePresets('library', allColumnIds)
    presets.savePreset('Custom', { columnOrder: [...allColumnIds], hiddenColumns: [], columnWidths: {} })
    expect(presets.allPresets.value.length).toBe(4)
    expect(presets.allPresets.value[3]?.name).toBe('Custom')
  })

  it('duplicates and favorites custom presets', () => {
    const presets = useTablePresets('library', allColumnIds)
    presets.savePreset('Original', { columnOrder: [...allColumnIds], hiddenColumns: [], columnWidths: {} })
    const presetId = presets.customPresets.value[0]?.id

    presets.toggleFavorite(presetId!)
    presets.duplicatePreset(presetId!)

    expect(presets.customPresets.value).toHaveLength(2)
    expect(presets.customPresets.value[0]?.favorite).toBe(true)
    expect(presets.customPresets.value[1]?.name).toBe('Original Copy')
  })

  it('imports valid custom presets and ignores built-in entries', () => {
    const presets = useTablePresets('library', allColumnIds)
    const imported = presets.importPresets([
      {
        id: 'custom_old',
        name: 'Imported',
        layout: { columnOrder: [...allColumnIds], hiddenColumns: ['authors'], columnWidths: {} },
      },
      {
        id: 'default',
        name: 'Default',
        isBuiltIn: true,
        layout: { columnOrder: [...allColumnIds], hiddenColumns: [], columnWidths: {} },
      },
    ])

    expect(imported).toBe(1)
    expect(presets.customPresets.value).toHaveLength(1)
    expect(presets.customPresets.value[0]?.name).toBe('Imported')
  })

  it('loads custom presets from localStorage on init', () => {
    const stored = [{ id: 'custom_abc', name: 'Stored', layout: { columnOrder: [...allColumnIds], hiddenColumns: [], columnWidths: {} } }]
    mockStorage['bookorbit:tablePresets:library'] = JSON.stringify(stored)
    const presets = useTablePresets('library', allColumnIds)
    expect(presets.customPresets.value).toHaveLength(1)
    expect(presets.customPresets.value[0]?.name).toBe('Stored')
  })

  it('discards invalid presets from localStorage', () => {
    mockStorage['bookorbit:tablePresets:library'] = JSON.stringify([{ id: 'bad' }])
    const presets = useTablePresets('library', allColumnIds)
    expect(presets.customPresets.value).toHaveLength(0)
  })

  it('handles corrupted localStorage gracefully', () => {
    mockStorage['bookorbit:tablePresets:library'] = 'not json'
    const presets = useTablePresets('library', allColumnIds)
    expect(presets.customPresets.value).toHaveLength(0)
  })
})
