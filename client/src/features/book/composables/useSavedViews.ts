import { computed, ref, watch, type Ref } from 'vue'
import { storage } from '@/services/storage'
import type { GroupRule, SortSpec, TableLayoutState, TableViewType } from '@bookorbit/types'

/**
 * Saved views: full presentation state snapshots, persisted locally.
 *
 * A saved view captures the complete visual state of the table at a point
 * in time: column layout, sort order, AND active filter. It is local-first
 * (stored in localStorage per view type + scope) and is distinct from:
 *
 *   - Column presets (useTablePresets): layout + optional default sort ONLY
 *   - SmartScopes: server-backed, rule-based data sets that control which
 *     books appear; saving filter state is their job, not presets'
 *
 * Concept boundaries:
 *   - Saved view   → full snapshot (layout + sort + filter), local-first
 *   - Column preset → layout + optional sort, no filter, reusable template
 *   - SmartScope   → server-side rule engine that produces filtered datasets
 */
export type SavedView = {
  id: string
  name: string
  layout: TableLayoutState
  sort: SortSpec[]
  filter?: GroupRule
  favorite?: boolean
}

type SaveSavedViewInput = {
  name: string
  layout: TableLayoutState
  sort?: SortSpec[]
  filter?: GroupRule
}

function savedViewsStorageKey(viewType: TableViewType, scopeId: number | null | undefined): string {
  return `bookorbit:savedViews:${viewType}:${scopeId ?? 'shared'}`
}

function cloneLayout(layout: TableLayoutState): TableLayoutState {
  return {
    columnOrder: [...layout.columnOrder],
    hiddenColumns: [...layout.hiddenColumns],
    columnWidths: { ...layout.columnWidths },
    ...(layout.pinnedColumns ? { pinnedColumns: { ...layout.pinnedColumns } } : {}),
  }
}

function cloneFilter(filter: GroupRule | undefined): GroupRule | undefined {
  if (!filter) return undefined
  return JSON.parse(JSON.stringify(filter)) as GroupRule
}

function isValidLayout(value: unknown): value is TableLayoutState {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return Array.isArray(obj.columnOrder) && Array.isArray(obj.hiddenColumns) && typeof obj.columnWidths === 'object' && obj.columnWidths !== null
}

function isValidSort(value: unknown): value is SortSpec[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === 'object' && entry !== null && typeof entry.field === 'string' && typeof entry.dir === 'string')
  )
}

function isValidFilter(value: unknown): value is GroupRule {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return obj.type === 'group' && (obj.join === 'AND' || obj.join === 'OR') && Array.isArray(obj.rules)
}

function isValidSavedView(value: unknown): value is SavedView {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  if (typeof obj.id !== 'string' || typeof obj.name !== 'string' || !isValidLayout(obj.layout)) return false
  if (obj.sort !== undefined && !isValidSort(obj.sort)) return false
  if (obj.filter !== undefined && !isValidFilter(obj.filter)) return false
  if (obj.favorite !== undefined && typeof obj.favorite !== 'boolean') return false
  return true
}

function createSnapshot(input: SaveSavedViewInput): SavedView | null {
  const trimmedName = input.name.trim()
  if (!trimmedName) return null
  return {
    id: `saved_view_${crypto.randomUUID()}`,
    name: trimmedName,
    layout: cloneLayout(input.layout),
    sort: input.sort ? [...input.sort] : [],
    filter: cloneFilter(input.filter),
  }
}

export function useSavedViews(viewType: TableViewType, scopeId: Readonly<Ref<number | null>>) {
  const savedViews = ref<SavedView[]>([])

  function loadSavedViews() {
    savedViews.value = storage.get<unknown[]>(savedViewsStorageKey(viewType, scopeId.value), []).filter(isValidSavedView)
  }

  watch(scopeId, loadSavedViews, { immediate: true })
  watch(
    savedViews,
    (value) => {
      storage.set(savedViewsStorageKey(viewType, scopeId.value), value)
    },
    { deep: true },
  )

  function saveView(input: SaveSavedViewInput): boolean {
    const snapshot = createSnapshot(input)
    if (!snapshot) return false
    savedViews.value = [...savedViews.value, snapshot]
    return true
  }

  function renameView(id: string, name: string): void {
    const trimmedName = name.trim()
    if (!trimmedName) return
    savedViews.value = savedViews.value.map((view) => (view.id === id ? { ...view, name: trimmedName } : view))
  }

  function deleteView(id: string): void {
    savedViews.value = savedViews.value.filter((view) => view.id !== id)
  }

  function duplicateView(id: string): void {
    const existing = savedViews.value.find((view) => view.id === id)
    if (!existing) return
    savedViews.value = [
      ...savedViews.value,
      {
        ...existing,
        id: `saved_view_${crypto.randomUUID()}`,
        name: `${existing.name} Copy`,
        layout: cloneLayout(existing.layout),
        sort: [...existing.sort],
        filter: cloneFilter(existing.filter),
      },
    ]
  }

  function toggleFavorite(id: string): void {
    savedViews.value = savedViews.value.map((view) => (view.id === id ? { ...view, favorite: !view.favorite } : view))
  }

  function importViews(views: SavedView[]): number {
    const valid = views.filter(isValidSavedView).map((view) => ({
      ...view,
      id: `saved_view_${crypto.randomUUID()}`,
      layout: cloneLayout(view.layout),
      sort: [...view.sort],
      filter: cloneFilter(view.filter),
    }))
    if (valid.length === 0) return 0
    savedViews.value = [...savedViews.value, ...valid]
    return valid.length
  }

  const allSavedViews = computed(() =>
    [...savedViews.value].sort((a, b) => {
      if (!!a.favorite !== !!b.favorite) return a.favorite ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }),
  )

  return {
    savedViews,
    allSavedViews,
    saveView,
    renameView,
    deleteView,
    duplicateView,
    toggleFavorite,
    importViews,
    reload: loadSavedViews,
  }
}
