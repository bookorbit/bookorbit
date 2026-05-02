import { computed, ref } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { storage } from '@/services/storage'
import { cloneTableLayout, validateTableLayout, type SortSpec, type TableLayoutState, type TableViewType } from '@bookorbit/types'
import type { ColumnId } from './useTableColumns'

/**
 * Column presets: reusable column layouts only.
 *
 * A preset captures column visibility, order, and widths — nothing more.
 * It may optionally include a default sort that is applied when the preset
 * is activated, but it deliberately excludes filter state. Filters belong
 * in SavedViews (see useSavedViews) or SmartScopes (server-side rule sets).
 *
 * Concept boundaries:
 *   - Column preset  → column layout (visibility / order / widths) + optional default sort
 *   - Saved view     → full presentation snapshot (layout + sort + filter), local-first
 *   - SmartScope     → server-backed, rule-based dynamic data set (data filtering only)
 */
export type TablePreset = {
  id: string
  name: string
  layout: TableLayoutState
  /** Optional default sort applied when activating the preset. Presets must NOT store filter state. */
  sort?: SortSpec[]
  isBuiltIn?: boolean
  favorite?: boolean
}

function presetsStorageKey(viewType: TableViewType): string {
  return `bookorbit:tablePresets:${viewType}`
}

function getBuiltInPresets(allColumnIds: ColumnId[]): TablePreset[] {
  const defaultVisible = ['cover', 'title', 'authors', 'seriesName', 'seriesIndex', 'publishedYear', 'rating', 'readStatus', 'format', 'actions']
  const compactVisible = ['cover', 'title', 'authors', 'rating', 'readStatus', 'actions']
  const metadataVisible = ['cover', 'title', 'authors', 'subtitle', 'publisher', 'language', 'publishedYear', 'pageCount', 'format', 'actions']

  const buildLayout = (visibleIds: string[]): TableLayoutState => ({
    columnOrder: allColumnIds,
    hiddenColumns: allColumnIds.filter((id) => !visibleIds.includes(id)),
    columnWidths: {},
  })

  return [
    {
      id: 'default',
      name: 'Default',
      isBuiltIn: true,
      layout: buildLayout(defaultVisible),
    },
    {
      id: 'compact',
      name: 'Compact',
      isBuiltIn: true,
      layout: buildLayout(compactVisible),
    },
    {
      id: 'metadata',
      name: 'Metadata',
      isBuiltIn: true,
      layout: buildLayout(metadataVisible),
    },
  ]
}

function isValidPreset(p: unknown, knownIds: ColumnId[]): p is TablePreset {
  if (typeof p !== 'object' || p === null) return false
  const obj = p as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string' || validateTableLayout(obj.layout, knownIds) === null) return false
  if (obj.sort !== undefined && !isValidSort(obj.sort)) return false
  if (obj.favorite !== undefined && typeof obj.favorite !== 'boolean') return false
  return true
}

function isValidSort(value: unknown): value is SortSpec[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'object' && entry !== null && typeof entry.field === 'string' && typeof entry.dir === 'string')
  )
}

function loadCustomPresets(viewType: TableViewType, knownIds: ColumnId[]): TablePreset[] {
  const raw = storage.get<unknown[]>(presetsStorageKey(viewType), [])
  if (!Array.isArray(raw)) return []
  return raw.filter((preset): preset is TablePreset => isValidPreset(preset, knownIds))
}

export function useTablePresets(viewType: TableViewType, allColumnIds: ColumnId[]) {
  const customPresets = ref<TablePreset[]>(loadCustomPresets(viewType, allColumnIds))

  watchDebounced(customPresets, (value) => storage.set(presetsStorageKey(viewType), value), { deep: true, debounce: 500 })

  const builtInPresets = computed(() => getBuiltInPresets(allColumnIds))

  function savePreset(name: string, layout: TableLayoutState, sort?: SortSpec[]): void {
    const trimmedName = name.trim()
    if (!trimmedName) return
    const id = `custom_${crypto.randomUUID()}`
    const preset: TablePreset = { id, name: trimmedName, layout: cloneTableLayout(layout) }
    if (sort && sort.length > 0) preset.sort = [...sort]
    customPresets.value = [...customPresets.value, preset]
  }

  function deletePreset(id: string): void {
    customPresets.value = customPresets.value.filter((preset) => preset.id !== id)
  }

  function renamePreset(id: string, name: string): void {
    const trimmedName = name.trim()
    if (!trimmedName) return
    customPresets.value = customPresets.value.map((preset) => (preset.id === id ? { ...preset, name: trimmedName } : preset))
  }

  function duplicatePreset(id: string): void {
    const existing = customPresets.value.find((preset) => preset.id === id) ?? builtInPresets.value.find((preset) => preset.id === id)
    if (!existing) return
    const duplicate: TablePreset = {
      ...existing,
      id: `custom_${crypto.randomUUID()}`,
      name: `${existing.name} Copy`,
      isBuiltIn: false,
      layout: cloneTableLayout(existing.layout),
      sort: existing.sort ? [...existing.sort] : undefined,
    }
    customPresets.value = [...customPresets.value, duplicate]
  }

  function toggleFavorite(id: string): void {
    customPresets.value = customPresets.value.map((preset) =>
      preset.id === id
        ? {
            ...preset,
            favorite: !preset.favorite,
          }
        : preset,
    )
  }

  function importPresets(presets: TablePreset[]): number {
    const valid = presets
      .filter((preset) => isValidPreset(preset, allColumnIds) && !preset.isBuiltIn)
      .map((preset) => ({
        ...preset,
        id: `custom_${crypto.randomUUID()}`,
        layout: cloneTableLayout(preset.layout),
        sort: preset.sort ? [...preset.sort] : undefined,
      }))
    if (valid.length === 0) return 0
    customPresets.value = [...customPresets.value, ...valid]
    return valid.length
  }

  const allPresets = computed(() => [
    ...builtInPresets.value,
    ...[...customPresets.value].sort((a, b) => {
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }),
  ])

  return {
    customPresets,
    builtInPresets,
    allPresets,
    savePreset,
    deletePreset,
    renamePreset,
    duplicatePreset,
    toggleFavorite,
    importPresets,
  }
}
