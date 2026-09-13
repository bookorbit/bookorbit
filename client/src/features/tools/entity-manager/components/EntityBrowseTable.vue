<script setup lang="ts">
import type { BrowseEntityItem, BrowseEntitySortBy, BrowseEntitySortOrder, EntityTypeCapabilities } from '@bookorbit/types'

import EntityBrowsePager from './EntityBrowsePager.vue'
import EntityDataGrid from './EntityDataGrid.vue'
import type { EntityRowDensity } from '../types'

defineProps<{
  items: BrowseEntityItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  sortBy: BrowseEntitySortBy
  sortOrder: BrowseEntitySortOrder
  density: EntityRowDensity
  loading: boolean
  hasActiveFilters: boolean
  selectedIds: Set<number | string>
  capabilities: EntityTypeCapabilities
  isInline: boolean
}>()

const emit = defineEmits<{
  'update:page': [value: number]
  'update:pageSize': [value: number]
  sortChange: [sortBy: BrowseEntitySortBy, sortOrder: BrowseEntitySortOrder]
  select: [id: number | string, event: MouseEvent]
  toggleAll: [selected: boolean]
  rename: [item: BrowseEntityItem]
  delete: [item: BrowseEntityItem]
  split: [item: BrowseEntityItem]
  clearFilters: []
}>()

function handleUpdatePage(value: number): void {
  emit('update:page', value)
}

function handleUpdatePageSize(value: number): void {
  emit('update:pageSize', value)
}

function handleSortChange(sortBy: BrowseEntitySortBy, sortOrder: BrowseEntitySortOrder): void {
  emit('sortChange', sortBy, sortOrder)
}

function handleSelect(id: number | string, event: MouseEvent): void {
  emit('select', id, event)
}

function handleToggleAll(selected: boolean): void {
  emit('toggleAll', selected)
}

function handleRename(item: BrowseEntityItem): void {
  emit('rename', item)
}

function handleDelete(item: BrowseEntityItem): void {
  emit('delete', item)
}

function handleSplit(item: BrowseEntityItem): void {
  emit('split', item)
}

function handleClearFilters(): void {
  emit('clearFilters')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <EntityDataGrid
      :items="items"
      :selected-ids="selectedIds"
      :capabilities="capabilities"
      :is-inline="isInline"
      :loading="loading"
      :density="density"
      :sort-by="sortBy"
      :sort-order="sortOrder"
      :has-active-filters="hasActiveFilters"
      @select="handleSelect"
      @toggle-all="handleToggleAll"
      @sort-change="handleSortChange"
      @rename="handleRename"
      @delete="handleDelete"
      @split="handleSplit"
      @clear-filters="handleClearFilters"
    />

    <EntityBrowsePager
      :page="page"
      :page-size="pageSize"
      :total="total"
      :total-pages="totalPages"
      @update:page="handleUpdatePage"
      @update:page-size="handleUpdatePageSize"
    />
  </div>
</template>
