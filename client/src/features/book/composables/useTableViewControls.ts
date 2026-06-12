import { ref } from 'vue'
import type { SortSpec, TableLayoutState } from '@bookorbit/types'
import type { ColumnDef, ColumnId } from './useTableColumns'
import type { TablePreset } from './useTablePresets'

export type TableViewHandle = {
  allColumns: (ColumnDef & { visible: boolean })[]
  currentLayout: TableLayoutState
  allPresets: TablePreset[]
  resetLayout: () => void
  toggleColumn: (id: ColumnId) => void
  setColumnOrder: (ids: ColumnId[]) => void
  applyPreset: (layout: TableLayoutState, sort?: SortSpec[]) => void
  saveCurrentPreset: (name: string) => void
  deletePreset: (id: string) => void
  renamePreset: (id: string, name: string) => void
  duplicatePreset: (id: string) => void
  togglePresetFavorite: (id: string) => void
  importPresetBackup: (presets: TablePreset[]) => number
  scrollToIndex: (index: number) => void
}

export function useTableViewControls() {
  const tableRef = ref<TableViewHandle | null>(null)

  function handleResetColumns() {
    tableRef.value?.resetLayout()
  }

  function handleToggleColumn(id: ColumnId) {
    tableRef.value?.toggleColumn(id)
  }

  function handleSetColumnOrder(ids: ColumnId[]) {
    tableRef.value?.setColumnOrder(ids)
  }

  function handleColumnPanelReorder(newUnpinnedCols: (ColumnDef & { visible: boolean })[]) {
    if (!tableRef.value) return
    const pinnedLeft = tableRef.value.allColumns.filter((column) => column.pinned === 'left').map((column) => column.id)
    const pinnedRight = tableRef.value.allColumns.filter((column) => column.pinned === 'right').map((column) => column.id)
    handleSetColumnOrder([...pinnedLeft, ...newUnpinnedCols.map((column) => column.id), ...pinnedRight])
  }

  function handleApplyTablePreset(preset: { layout: TableLayoutState; sort?: SortSpec[] }) {
    tableRef.value?.applyPreset(preset.layout, preset.sort)
  }

  function handleSaveTablePreset(name: string) {
    tableRef.value?.saveCurrentPreset(name)
  }

  function handleDeleteTablePreset(id: string) {
    tableRef.value?.deletePreset(id)
  }

  function handleRenameTablePreset(id: string, name: string) {
    tableRef.value?.renamePreset(id, name)
  }

  function handleDuplicateTablePreset(id: string) {
    tableRef.value?.duplicatePreset(id)
  }

  function handleTogglePresetFavorite(id: string) {
    tableRef.value?.togglePresetFavorite(id)
  }

  function handleImportPresetBackup(presets: TablePreset[]) {
    return tableRef.value?.importPresetBackup(presets) ?? 0
  }

  return {
    tableRef,
    handleResetColumns,
    handleToggleColumn,
    handleSetColumnOrder,
    handleColumnPanelReorder,
    handleApplyTablePreset,
    handleSaveTablePreset,
    handleDeleteTablePreset,
    handleRenameTablePreset,
    handleDuplicateTablePreset,
    handleTogglePresetFavorite,
    handleImportPresetBackup,
  }
}
