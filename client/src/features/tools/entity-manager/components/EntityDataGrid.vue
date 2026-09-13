<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleSlash, MoreHorizontal, Pencil, Scissors, Search, Trash2 } from '@lucide/vue'
import type { BrowseEntityItem, BrowseEntitySortBy, BrowseEntitySortOrder, EntityTypeCapabilities } from '@bookorbit/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatNumber } from '@/i18n/formatters'

import EntitySortableHeader from './EntitySortableHeader.vue'
import type { EntityRowDensity } from '../types'

const props = defineProps<{
  items: BrowseEntityItem[]
  selectedIds: Set<number | string>
  capabilities: EntityTypeCapabilities
  isInline: boolean
  loading: boolean
  density: EntityRowDensity
  sortBy: BrowseEntitySortBy
  sortOrder: BrowseEntitySortOrder
  hasActiveFilters: boolean
}>()

const emit = defineEmits<{
  select: [id: number | string, event: MouseEvent]
  toggleAll: [selected: boolean]
  sortChange: [sortBy: BrowseEntitySortBy, sortOrder: BrowseEntitySortOrder]
  rename: [item: BrowseEntityItem]
  delete: [item: BrowseEntityItem]
  split: [item: BrowseEntityItem]
  clearFilters: []
}>()

const { t } = useI18n()

const showSortName = computed(() => props.capabilities.hasSortName)
const showStatus = computed(() => !props.isInline)
const canSplit = computed(() => props.capabilities.canSplit && !props.isInline)
const columnCount = computed(() => 4 + (showSortName.value ? 1 : 0) + (showStatus.value ? 1 : 0))

const allSelected = computed(() => props.items.length > 0 && props.items.every((item) => props.selectedIds.has(item.id)))
const someSelected = computed(() => !allSelected.value && props.items.some((item) => props.selectedIds.has(item.id)))

const cellPadding = computed(() => (props.density === 'compact' ? 'py-1' : 'py-2'))
const rowHeight = computed(() => (props.density === 'compact' ? 'h-8' : 'h-[46px]'))

function handleSort(field: BrowseEntitySortBy): void {
  if (props.sortBy === field) {
    emit('sortChange', field, props.sortOrder === 'asc' ? 'desc' : 'asc')
    return
  }
  emit('sortChange', field, field === 'bookCount' ? 'desc' : 'asc')
}

function handleToggleAll(event: Event): void {
  emit('toggleAll', (event.target as HTMLInputElement).checked)
}

function handleSelect(id: number | string, event: MouseEvent): void {
  emit('select', id, event)
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
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
    <div class="min-h-0 flex-1 overflow-auto">
      <!-- Desktop data grid -->
      <table class="hidden w-full border-collapse text-sm md:table">
        <thead>
          <tr>
            <th scope="col" class="sticky top-0 z-10 w-10 border-b border-border bg-secondary px-3 py-2.5">
              <input
                type="checkbox"
                class="size-4 rounded accent-primary align-middle"
                :checked="allSelected"
                :indeterminate="someSelected"
                :aria-label="t('tools.entityManager.browse.selectAllOnPage')"
                @change="handleToggleAll"
              />
            </th>
            <EntitySortableHeader
              field="name"
              :sort-by="sortBy"
              :sort-order="sortOrder"
              class="sticky top-0 z-10 border-b border-border bg-secondary"
              @sort="handleSort"
            >
              {{ t('tools.entityManager.browse.columns.name') }}
            </EntitySortableHeader>
            <th
              v-if="showSortName"
              scope="col"
              class="sticky top-0 z-10 border-b border-border bg-secondary px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {{ t('tools.entityManager.browse.columns.sortName') }}
            </th>
            <EntitySortableHeader
              field="bookCount"
              align="end"
              :sort-by="sortBy"
              :sort-order="sortOrder"
              class="sticky top-0 z-10 w-24 border-b border-border bg-secondary"
              @sort="handleSort"
            >
              {{ t('tools.entityManager.browse.columns.books') }}
            </EntitySortableHeader>
            <th
              v-if="showStatus"
              scope="col"
              class="sticky top-0 z-10 w-32 border-b border-border bg-secondary px-3 py-2.5 text-start text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              {{ t('tools.entityManager.browse.columns.status') }}
            </th>
            <th scope="col" class="sticky top-0 z-10 w-32 border-b border-border bg-secondary px-3 py-2.5">
              <span class="sr-only">{{ t('tools.entityManager.browse.columns.actions') }}</span>
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-if="loading">
            <td :colspan="columnCount" class="px-3 py-10 text-center text-muted-foreground">{{ t('common.loading') }}</td>
          </tr>
          <tr v-else-if="items.length === 0">
            <td :colspan="columnCount" class="px-3 py-14">
              <div class="flex flex-col items-center gap-3 text-center">
                <div class="rounded-full bg-muted p-3">
                  <Search :size="20" class="text-muted-foreground" aria-hidden="true" />
                </div>
                <div class="space-y-1">
                  <p class="text-sm font-medium text-foreground">
                    {{ hasActiveFilters ? t('tools.entityManager.browse.noMatchesTitle') : t('tools.entityManager.browse.noEntities') }}
                  </p>
                  <p class="max-w-xs text-xs text-muted-foreground">
                    {{
                      hasActiveFilters ? t('tools.entityManager.browse.noMatchesDescription') : t('tools.entityManager.browse.noEntitiesDescription')
                    }}
                  </p>
                </div>
                <button
                  v-if="hasActiveFilters"
                  type="button"
                  class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  @click="handleClearFilters"
                >
                  {{ t('tools.entityManager.browse.clearFilters') }}
                </button>
              </div>
            </td>
          </tr>
          <tr
            v-for="item in items"
            v-else
            :key="String(item.id)"
            class="group transition-colors hover:bg-accent focus-within:bg-accent"
            :class="[rowHeight, selectedIds.has(item.id) ? 'bg-primary/8' : '']"
          >
            <td class="px-3" :class="cellPadding">
              <input
                type="checkbox"
                class="size-4 rounded accent-primary align-middle"
                :checked="selectedIds.has(item.id)"
                :aria-label="t('tools.entityManager.browse.selectEntity', { name: item.name })"
                @click="handleSelect(item.id, $event)"
              />
            </td>
            <td class="max-w-0 px-3 font-medium text-foreground" :class="cellPadding">
              <span class="block truncate">{{ item.name }}</span>
            </td>
            <td v-if="showSortName" class="max-w-0 px-3 text-muted-foreground" :class="cellPadding">
              <span v-if="item.sortName" class="block truncate">{{ item.sortName }}</span>
              <span v-else aria-hidden="true">-</span>
            </td>
            <td class="px-3 text-end tabular-nums" :class="[cellPadding, item.bookCount === 0 ? 'text-muted-foreground' : 'text-foreground']">
              {{ formatNumber(item.bookCount) }}
            </td>
            <td v-if="showStatus" class="px-3" :class="cellPadding">
              <span
                v-if="item.bookCount === 0"
                class="inline-flex items-center gap-1.5 rounded-full bg-[var(--pill-warning)]/12 px-2 py-0.5 text-xs font-semibold text-[var(--pill-warning)]"
              >
                <CircleSlash :size="11" aria-hidden="true" />
                {{ t('tools.entityManager.browse.status.noBooks') }}
              </span>
            </td>
            <td class="px-3" :class="cellPadding">
              <div class="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <button
                  type="button"
                  class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-4 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :aria-label="t('tools.entityManager.actions.rename')"
                  :title="t('tools.entityManager.actions.rename')"
                  @click.stop="handleRename(item)"
                >
                  <Pencil :size="14" aria-hidden="true" />
                </button>
                <button
                  v-if="canSplit"
                  type="button"
                  class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-4 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :aria-label="t('tools.entityManager.actions.split')"
                  :title="t('tools.entityManager.actions.split')"
                  @click.stop="handleSplit(item)"
                >
                  <Scissors :size="14" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :aria-label="t('common.delete')"
                  :title="t('common.delete')"
                  @click.stop="handleDelete(item)"
                >
                  <Trash2 :size="14" aria-hidden="true" />
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Mobile card list -->
      <div class="divide-y divide-border md:hidden">
        <p v-if="loading" class="px-4 py-10 text-center text-sm text-muted-foreground">{{ t('common.loading') }}</p>
        <div v-else-if="items.length === 0" class="flex flex-col items-center gap-3 px-4 py-12 text-center">
          <div class="rounded-full bg-muted p-3">
            <Search :size="20" class="text-muted-foreground" aria-hidden="true" />
          </div>
          <p class="text-sm font-medium text-foreground">
            {{ hasActiveFilters ? t('tools.entityManager.browse.noMatchesTitle') : t('tools.entityManager.browse.noEntities') }}
          </p>
          <button
            v-if="hasActiveFilters"
            type="button"
            class="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            @click="handleClearFilters"
          >
            {{ t('tools.entityManager.browse.clearFilters') }}
          </button>
        </div>
        <div
          v-for="item in items"
          v-else
          :key="String(item.id)"
          class="flex items-center gap-3 px-4 py-3"
          :class="selectedIds.has(item.id) ? 'bg-primary/8' : ''"
        >
          <input
            type="checkbox"
            class="size-4 shrink-0 rounded accent-primary"
            :checked="selectedIds.has(item.id)"
            :aria-label="t('tools.entityManager.browse.selectEntity', { name: item.name })"
            @click="handleSelect(item.id, $event)"
          />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-foreground">{{ item.name }}</p>
            <p class="truncate text-xs text-muted-foreground">
              <span v-if="item.sortName">{{ t('tools.entityManager.browse.sortLabel', { sortName: item.sortName }) }} &middot; </span>
              <span :class="item.bookCount === 0 ? 'text-[var(--pill-warning)]' : ''">
                {{ t('tools.entityManager.bookCount', { count: item.bookCount }) }}
              </span>
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button
                type="button"
                class="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="t('tools.entityManager.browse.actionsFor', { name: item.name })"
              >
                <MoreHorizontal :size="16" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="handleRename(item)">
                <Pencil class="mr-2 size-4" aria-hidden="true" />
                {{ t('tools.entityManager.actions.rename') }}
              </DropdownMenuItem>
              <DropdownMenuItem v-if="canSplit" @click="handleSplit(item)">
                <Scissors class="mr-2 size-4" aria-hidden="true" />
                {{ t('tools.entityManager.actions.split') }}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-destructive focus:text-destructive" @click="handleDelete(item)">
                <Trash2 class="mr-2 size-4" aria-hidden="true" />
                {{ t('common.delete') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  </div>
</template>
