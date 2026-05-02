import { computed, ref } from 'vue'
import { watchDebounced } from '@vueuse/core'
import { storage } from '@/services/storage'
import type { TableLayoutState, TableViewType } from '@bookorbit/types'
import {
  type ColumnId,
  type CellType,
  type ColumnDef,
  LOCK_ROW_COLUMN_DEF,
  COLUMN_DEFS,
  COLUMN_DEF_MAP,
  DEFAULT_ORDER,
  DEFAULT_HIDDEN,
  DEFAULT_WIDTHS,
} from './tableColumnSchema'

export type { ColumnId, CellType, ColumnDef }
export { LOCK_ROW_COLUMN_DEF, COLUMN_DEFS, COLUMN_DEF_MAP, DEFAULT_ORDER, DEFAULT_HIDDEN, DEFAULT_WIDTHS }

function storageKey(viewType: TableViewType): string {
  return `bookorbit:tableLayout:${viewType}`
}

function loadPinnedColumns(raw: unknown, knownIds: Set<ColumnId>): Record<string, 'left' | 'right' | null> {
  if (!raw || typeof raw !== 'object') return {}
  const result: Record<string, 'left' | 'right' | null> = {}
  for (const [id, dir] of Object.entries(raw as Record<string, unknown>)) {
    if (knownIds.has(id as ColumnId) && (dir === 'left' || dir === 'right' || dir === null)) {
      result[id] = dir
    }
  }
  return result
}

function resolvePinnedColumn(
  userPins: Record<string, 'left' | 'right' | null>,
  id: string,
  fallback: 'left' | 'right' | null,
): 'left' | 'right' | null {
  if (Object.prototype.hasOwnProperty.call(userPins, id)) {
    return userPins[id] ?? null
  }
  return fallback
}

function loadLayout(viewType: TableViewType): TableLayoutState {
  try {
    const raw = storage.get<TableLayoutState | null>(storageKey(viewType), null)
    if (!raw || !Array.isArray(raw.columnOrder) || !Array.isArray(raw.hiddenColumns)) {
      return { columnOrder: [...DEFAULT_ORDER], hiddenColumns: [...DEFAULT_HIDDEN], columnWidths: { ...DEFAULT_WIDTHS } }
    }
    const knownIds = new Set(DEFAULT_ORDER)
    const order = raw.columnOrder.filter((id) => knownIds.has(id as ColumnId)) as ColumnId[]
    const missing = DEFAULT_ORDER.filter((id) => !order.includes(id))
    const finalOrder = [...order, ...missing]
    const hidden = raw.hiddenColumns.filter((id) => knownIds.has(id as ColumnId)) as ColumnId[]
    const widths: Record<string, number> = { ...DEFAULT_WIDTHS }
    for (const [id, w] of Object.entries(raw.columnWidths ?? {})) {
      if (knownIds.has(id as ColumnId) && typeof w === 'number' && w > 0) widths[id] = w
    }
    return { columnOrder: finalOrder, hiddenColumns: hidden, columnWidths: widths, pinnedColumns: loadPinnedColumns(raw.pinnedColumns, knownIds) }
  } catch {
    return { columnOrder: [...DEFAULT_ORDER], hiddenColumns: [...DEFAULT_HIDDEN], columnWidths: { ...DEFAULT_WIDTHS }, pinnedColumns: {} }
  }
}

export function useTableColumns(viewType: TableViewType) {
  const layout = ref<TableLayoutState>(loadLayout(viewType))

  watchDebounced(layout, (v) => storage.set(storageKey(viewType), v), { deep: true, debounce: 500 })

  const visibleColumns = computed<ColumnDef[]>(() => {
    const hiddenSet = new Set(layout.value.hiddenColumns)
    const userPins = layout.value.pinnedColumns ?? {}
    return layout.value.columnOrder
      .filter((id) => !hiddenSet.has(id))
      .map((id) => {
        const def = COLUMN_DEF_MAP.get(id as ColumnId)!
        return {
          ...def,
          defaultWidth: layout.value.columnWidths[id] ?? def.defaultWidth,
          pinned: resolvePinnedColumn(userPins, id, def.pinned),
        }
      })
  })

  const allColumns = computed<(ColumnDef & { visible: boolean })[]>(() => {
    const hiddenSet = new Set(layout.value.hiddenColumns)
    const userPins = layout.value.pinnedColumns ?? {}
    return layout.value.columnOrder.map((id) => {
      const def = COLUMN_DEF_MAP.get(id as ColumnId)!
      return { ...def, visible: !hiddenSet.has(id), pinned: resolvePinnedColumn(userPins, id, def.pinned) }
    })
  })

  function toggleColumn(id: ColumnId): void {
    const hidden = new Set(layout.value.hiddenColumns)
    if (hidden.has(id)) {
      hidden.delete(id)
    } else {
      hidden.add(id)
    }
    layout.value = { ...layout.value, hiddenColumns: [...hidden] }
  }

  function setColumnOrder(order: ColumnId[]): void {
    const seen = new Set<ColumnId>()
    const deduped = order.filter((id) => COLUMN_DEF_MAP.has(id) && !seen.has(id) && seen.add(id) !== undefined)
    const missing = DEFAULT_ORDER.filter((id) => !seen.has(id))
    layout.value = { ...layout.value, columnOrder: [...deduped, ...missing] }
  }

  function setColumnWidth(id: ColumnId, px: number): void {
    const def = COLUMN_DEF_MAP.get(id)
    const min = def?.minWidth ?? 40
    const max = 800
    const clamped = Math.min(Math.max(px, min), max)
    layout.value = {
      ...layout.value,
      columnWidths: { ...layout.value.columnWidths, [id]: clamped },
    }
  }

  function setLayout(nextLayout: TableLayoutState): void {
    const knownIds = new Set(DEFAULT_ORDER)
    const order = nextLayout.columnOrder.filter((id) => knownIds.has(id as ColumnId)) as ColumnId[]
    const missing = DEFAULT_ORDER.filter((id) => !order.includes(id))
    const hidden = nextLayout.hiddenColumns.filter((id) => knownIds.has(id as ColumnId)) as ColumnId[]
    const widths: Record<string, number> = { ...DEFAULT_WIDTHS }
    for (const [id, width] of Object.entries(nextLayout.columnWidths ?? {})) {
      if (knownIds.has(id as ColumnId) && typeof width === 'number' && width > 0) {
        widths[id] = width
      }
    }
    const pins: Record<string, 'left' | 'right' | null> = {}
    if (nextLayout.pinnedColumns) {
      for (const [id, dir] of Object.entries(nextLayout.pinnedColumns)) {
        if (knownIds.has(id as ColumnId) && (dir === 'left' || dir === 'right' || dir === null)) {
          pins[id] = dir
        }
      }
    }
    layout.value = {
      columnOrder: [...order, ...missing],
      hiddenColumns: hidden,
      columnWidths: widths,
      pinnedColumns: pins,
    }
  }

  function pinColumn(id: ColumnId, side: 'left' | 'right'): void {
    const currentPins = { ...(layout.value.pinnedColumns ?? {}) }
    if (currentPins[id] === side) return
    const MAX_PINNED = 3
    const pinnedOnSide = Object.values(currentPins).filter((s) => s === side).length
    if (pinnedOnSide >= MAX_PINNED) return
    currentPins[id] = side
    layout.value = { ...layout.value, pinnedColumns: currentPins }
  }

  function unpinColumn(id: ColumnId): void {
    const currentPins = { ...(layout.value.pinnedColumns ?? {}) }
    currentPins[id] = null
    layout.value = { ...layout.value, pinnedColumns: currentPins }
  }

  function resetLayout(): void {
    storage.remove(storageKey(viewType))
    layout.value = { columnOrder: [...DEFAULT_ORDER], hiddenColumns: [...DEFAULT_HIDDEN], columnWidths: { ...DEFAULT_WIDTHS }, pinnedColumns: {} }
  }

  return { layout, visibleColumns, allColumns, toggleColumn, setColumnOrder, setColumnWidth, setLayout, pinColumn, unpinColumn, resetLayout }
}
