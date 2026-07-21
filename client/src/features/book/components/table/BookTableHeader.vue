<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical, Loader2 } from '@lucide/vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ColumnDef } from '@/features/book/composables/tableColumnSchema'
import type { SortSpec } from '@bookorbit/types'

const props = defineProps<{
  displayColumns: ColumnDef[]
  sort: SortSpec[]
  isScrolled: boolean
  loading: boolean
  selectionMode: boolean
  allBooksSelected: boolean
  someBooksSelected: boolean
  isReadOnly: boolean
  pinnedLeftOffsets: Map<string, number>
  dragSourceColId: string | null
  dropTargetColId: string | null
  dropSide: 'before' | 'after' | null
  sortable: boolean
}>()

const emit = defineEmits<{
  selectAll: [event: Event]
  columnSort: [sortField: string | null, event: MouseEvent]
  headerContextMenu: [event: MouseEvent, col: ColumnDef]
  colDragStart: [event: DragEvent, colId: string]
  colDragOver: [event: DragEvent, col: ColumnDef]
  colDragLeave: [colId: string]
  colDrop: [event: DragEvent, colId: string]
  colDragEnd: []
  resizeStart: [event: MouseEvent, colId: string, currentWidth: number]
  autoFitColumn: [colId: string]
}>()

const { t } = useI18n()

function getSortDir(sortField: string): 'asc' | 'desc' | null {
  return props.sort.find((s) => s.field === sortField)?.dir ?? null
}

function getSortPriority(sortField: string | null): number {
  if (!sortField) return 0
  return props.sort.findIndex((s) => s.field === sortField) + 1
}

function isSortableColumn(col: ColumnDef): boolean {
  return !!col.sortField && props.sortable
}
</script>

<template>
  <thead class="sticky top-0 z-10 bg-muted transition-shadow" :class="{ 'shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12)]': isScrolled }" role="rowgroup">
    <tr role="row">
      <th
        v-if="selectionMode"
        role="columnheader"
        class="relative select-none border-b border-border px-2 py-2 text-center"
        :style="{ width: '36px', minWidth: '36px', position: 'sticky', left: '0px', zIndex: 20, background: 'var(--muted)' }"
      >
        <input
          type="checkbox"
          class="accent-primary h-3.5 w-3.5 cursor-pointer"
          :checked="allBooksSelected"
          :indeterminate="someBooksSelected"
          :aria-label="t('book.table.header.selectAllBooks')"
          @change="emit('selectAll', $event)"
        />
      </th>

      <th
        v-for="col in displayColumns"
        :key="col.id"
        :data-col-id="col.id"
        role="columnheader"
        class="group/th relative select-none border-b border-border px-2 py-2 text-left"
        :aria-sort="
          col.sortField && getSortDir(col.sortField) === 'asc'
            ? 'ascending'
            : col.sortField && getSortDir(col.sortField) === 'desc'
              ? 'descending'
              : 'none'
        "
        :class="[
          col.pinned === 'right' ? 'border-l border-border/60' : '',
          dropTargetColId === col.id && dropSide === 'before' ? 'border-l-2 border-primary' : '',
          dropTargetColId === col.id && dropSide === 'after' ? 'border-r-2 border-primary' : '',
          dragSourceColId === col.id ? 'opacity-40' : '',
          col.sortField && getSortDir(col.sortField) !== null && isSortableColumn(col) ? 'bg-primary/5' : '',
        ]"
        :style="{
          width: `${col.defaultWidth}px`,
          minWidth: `${col.minWidth}px`,
          ...(col.pinned === 'left' || col.id === 'lockRow'
            ? {
                position: 'sticky',
                left: `${(selectionMode ? 36 : 0) + (pinnedLeftOffsets.get(col.id) ?? 0)}px`,
                zIndex: 20,
                background: 'var(--muted)',
              }
            : {}),
          ...(col.pinned === 'right' ? { position: 'sticky', right: '0', zIndex: 20 } : {}),
        }"
        :draggable="!isReadOnly && col.pinned === null"
        @dragstart="emit('colDragStart', $event, col.id)"
        @dragover="emit('colDragOver', $event, col)"
        @dragleave="emit('colDragLeave', col.id)"
        @drop="emit('colDrop', $event, col.id)"
        @dragend="emit('colDragEnd')"
        @contextmenu="emit('headerContextMenu', $event, col)"
      >
        <Tooltip v-if="isSortableColumn(col)">
          <TooltipTrigger as-child>
            <div
              data-col-label
              class="flex min-w-0 items-center gap-1 overflow-hidden pr-2 hover:text-foreground"
              :class="isSortableColumn(col) ? 'cursor-pointer' : ''"
              @click="(event) => emit('columnSort', col.sortField, event)"
            >
              <GripVertical
                v-if="col.pinned === null && !isReadOnly"
                :size="11"
                class="shrink-0 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover/th:opacity-40 hover:!opacity-100"
              />
              <span class="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ col.header }}</span>
              <Loader2 v-if="loading && getSortDir(col.sortField!) !== null" :size="11" class="shrink-0 animate-spin text-primary" />
              <ArrowUp v-else-if="getSortDir(col.sortField!) === 'asc'" :size="11" class="shrink-0 text-primary" />
              <ArrowDown v-else-if="getSortDir(col.sortField!) === 'desc'" :size="11" class="shrink-0 text-primary" />
              <ArrowUpDown v-else :size="11" class="shrink-0 text-muted-foreground/60" />
              <span
                v-if="sort.length > 1 && getSortPriority(col.sortField!) > 0"
                class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold text-primary"
              >
                {{ getSortPriority(col.sortField!) }}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {{ getSortDir(col.sortField!) ? t('book.table.header.shiftClickSecondarySort') : t('book.table.header.clickToSort') }}
          </TooltipContent>
        </Tooltip>
        <div v-else data-col-label class="flex min-w-0 items-center gap-1 overflow-hidden pr-2">
          <GripVertical
            v-if="col.pinned === null && !isReadOnly"
            :size="11"
            class="shrink-0 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover/th:opacity-40 hover:!opacity-100"
          />
          <span class="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">{{ col.header }}</span>
        </div>
        <div
          v-if="!isReadOnly && col.id !== 'lockRow' && col.id !== 'actions' && col.id !== 'read' && col.id !== 'cover'"
          class="group/rz absolute right-0 top-0 flex h-full w-4 cursor-col-resize items-center justify-end pr-0.5"
          @mousedown="emit('resizeStart', $event, col.id, col.defaultWidth)"
          @dblclick.stop="emit('autoFitColumn', col.id)"
        >
          <div class="h-4 w-[2px] rounded-full bg-border/60 transition-colors group-hover/rz:bg-primary/70" />
        </div>
        <div
          v-else-if="col.id === 'cover' || col.id === 'read'"
          class="pointer-events-none absolute right-0 top-0 flex h-full w-3 items-center justify-end pr-0.5"
        >
          <div class="h-4 w-[2px] rounded-full bg-border/60 transition-colors group-hover/rz:bg-primary/70" />
        </div>
      </th>
    </tr>
  </thead>
</template>
