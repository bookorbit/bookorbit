<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/vue-virtual'
import { ChevronDown, Library as LibraryIcon, Minus, Search, ShieldAlert, X } from '@lucide/vue'
import type { BulkRenamePreviewItem, BulkRenameStatus, Library } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { BulkRenameScope } from '../../composables/useBulkRename'
import type { ReviewGroup, TriState } from '../composables/useBulkRenameReview'
import type { ChangeKind } from '../utils/changeKind'
import SelectionCheckbox from './SelectionCheckbox.vue'

const props = defineProps<{
  libraries: Library[]
  library: Library | null
  scope: BulkRenameScope
  counts: Record<BulkRenameStatus, number>
  search: string
  groups: ReviewGroup[]
  collapsed: Set<string>
  currentId: number | null
  selectedCount: number
  selectionState: TriState
  hasMore: boolean
  loadingMore: boolean
  kindOf: (item: BulkRenamePreviewItem) => ChangeKind | null
  isSelected: (item: BulkRenamePreviewItem) => boolean
  groupState: (key: string) => TriState
}>()

const emit = defineEmits<{
  'select-library': [libraryId: number]
  'update:scope': [scope: BulkRenameScope]
  'update:search': [value: string]
  select: [bookId: number]
  'toggle-selected': [item: BulkRenamePreviewItem]
  'toggle-group-selected': [key: string]
  'toggle-group': [key: string]
  'toggle-all': []
  'load-more': []
}>()

const { t } = useI18n()

const listRef = ref<HTMLElement | null>(null)

type Row = { kind: 'header'; group: ReviewGroup } | { kind: 'item'; item: BulkRenamePreviewItem; group: ReviewGroup }

const HEADER_HEIGHT = 33
const ITEM_HEIGHT = 41

/**
 * Groups and their rows flattened into one list so the queue can be virtualized. A library can put
 * tens of thousands of books in a single bucket, and rendering every loaded page grew the DOM
 * without bound.
 */
const rows = computed<Row[]>(() => {
  const out: Row[] = []
  for (const group of props.groups) {
    out.push({ kind: 'header', group })
    if (props.collapsed.has(group.key)) continue
    for (const item of group.items) out.push({ kind: 'item', item, group })
  }
  return out
})

const headerIndexes = computed(() => rows.value.reduce<number[]>((acc, row, index) => (row.kind === 'header' ? [...acc, index] : acc), []))

/** The header pinned to the top of the viewport, kept rendered even when scrolled out of range. */
const activeHeaderIndex = ref(0)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => listRef.value,
    estimateSize: (index: number) => (rows.value[index]?.kind === 'header' ? HEADER_HEIGHT : ITEM_HEIGHT),
    overscan: 12,
    rangeExtractor: (range: { startIndex: number; endIndex: number; overscan: number; count: number }) => {
      const pinned = [...headerIndexes.value].reverse().find((index) => index <= range.startIndex) ?? 0
      activeHeaderIndex.value = pinned
      return [...new Set([pinned, ...defaultRangeExtractor(range)])].sort((a, b) => a - b)
    },
  })),
)

const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

/** Narrows a flattened row to its book. Only ever called for rows the template knows are items. */
function rowItem(index: number): BulkRenamePreviewItem {
  const row = rows.value[index]
  return row && row.kind === 'item' ? row.item : (undefined as unknown as BulkRenamePreviewItem)
}

function isPinnedHeader(index: number): boolean {
  return rows.value[index]?.kind === 'header' && activeHeaderIndex.value === index
}

function rowStyle(virtual: { index: number; start: number; size: number }): Record<string, string> {
  if (isPinnedHeader(virtual.index)) return { position: 'sticky', top: '0', zIndex: '2', width: '100%' }
  return {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '100%',
    transform: `translateY(${virtual.start}px)`,
  }
}

const SCOPES: { key: BulkRenameScope; label: string; status: BulkRenameStatus | null }[] = [
  { key: 'changes', label: 'tools.bulkRename.filter.changes', status: 'will_rename' },
  { key: 'collision', label: 'tools.bulkRename.filter.conflicts', status: 'collision' },
  { key: 'unchanged', label: 'tools.bulkRename.filter.unchanged', status: 'unchanged' },
  { key: 'all', label: 'tools.bulkRename.filter.all', status: null },
]

/** A conflict chip that always reads zero is noise, so it only appears when there are conflicts. */
const scopes = computed(() => SCOPES.filter((entry) => entry.key !== 'collision' || props.counts.collision > 0))

function countFor(status: BulkRenameStatus | null): number {
  if (status === null) return Object.values(props.counts).reduce((sum, value) => sum + value, 0)
  return props.counts[status]
}

const subtitleFor = (item: BulkRenamePreviewItem): string => props.kindOf(item)?.detail ?? item.currentPath.split('/')[0] ?? ''

function handleSearchInput(event: Event): void {
  emit('update:search', (event.target as HTMLInputElement).value)
}

function handleClearSearch(): void {
  emit('update:search', '')
}

function handleToggleAll(): void {
  emit('toggle-all')
}

function handleScroll(): void {
  const el = listRef.value
  if (!el || !props.hasMore || props.loadingMore) return
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) emit('load-more')
}

defineExpose({
  /**
   * Keeps the open row on screen when navigation comes from the keyboard. The row may not be
   * rendered yet, so this asks the virtualizer to bring the index into view rather than looking
   * for a DOM node.
   */
  revealCurrent(): void {
    if (props.currentId === null) return
    const index = rows.value.findIndex((row) => row.kind === 'item' && row.item.bookId === props.currentId)
    if (index >= 0) virtualizer.value.scrollToIndex(index, { align: 'auto' })
  },
})
</script>

<template>
  <div class="flex min-h-0 flex-col border-e border-border bg-card/45">
    <div class="grid flex-none gap-2 border-b border-border p-3">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <button
            class="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-background px-2 text-start text-sm font-semibold shadow-xs transition-colors hover:border-primary/45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span class="grid size-5.5 shrink-0 place-items-center rounded-[5px] bg-primary/12 text-primary">
              <LibraryIcon class="size-3" aria-hidden="true" />
            </span>
            <span class="min-w-0 flex-1 truncate">{{ library?.name ?? t('tools.bulkRename.selectLibraryPlaceholder') }}</span>
            <span class="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
              {{ t('tools.bulkRename.toRenameCount', { count: counts.will_rename }) }}
            </span>
            <ChevronDown class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-(--reka-dropdown-menu-trigger-width)">
          <DropdownMenuItem v-for="option in libraries" :key="option.id" @select="emit('select-library', option.id)">
            <span class="min-w-0 flex-1 truncate">{{ option.name }}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div
        class="flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/35"
      >
        <Search class="size-3.5 shrink-0" aria-hidden="true" />
        <input
          :value="search"
          class="w-full min-w-0 border-0 bg-transparent text-sm text-foreground outline-none"
          :placeholder="t('tools.bulkRename.search.placeholder')"
          :aria-label="t('tools.bulkRename.search.label')"
          @input="handleSearchInput"
        />
        <button
          v-if="search"
          class="grid shrink-0 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :aria-label="t('tools.bulkRename.search.clear')"
          @click="handleClearSearch"
        >
          <X class="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <div class="flex flex-wrap gap-1">
        <button
          v-for="entry in scopes"
          :key="entry.key"
          class="inline-flex h-6.5 items-center gap-1.5 rounded-full border px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          :class="
            scope === entry.key
              ? entry.key === 'collision'
                ? 'border-warning/40 bg-warning/14 font-semibold text-warning'
                : 'border-primary/40 bg-primary/12 font-semibold text-primary'
              : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          :aria-pressed="scope === entry.key"
          @click="emit('update:scope', entry.key)"
        >
          {{ t(entry.label) }}
          <span class="tabular-nums">{{ countFor(entry.status) }}</span>
        </button>
      </div>
    </div>

    <div v-if="counts.will_rename > 0" class="flex flex-none items-center gap-2 border-b border-border px-3 py-2">
      <SelectionCheckbox :state="selectionState" :label="t('tools.bulkRename.select.toggleAll')" @toggle="handleToggleAll" />
      <span class="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        <b class="text-sm text-foreground tabular-nums">{{ selectedCount }}</b>
        {{ t('tools.bulkRename.select.ofSelected', { total: counts.will_rename }) }}
      </span>
    </div>

    <div
      ref="listRef"
      class="min-h-0 flex-1 overflow-y-auto"
      role="listbox"
      :aria-label="t('tools.bulkRename.review.queue')"
      :aria-activedescendant="currentId !== null ? `bulk-rename-row-${currentId}` : undefined"
      tabindex="0"
      @scroll.passive="handleScroll"
    >
      <div class="relative w-full" :style="{ height: `${totalSize}px` }">
        <template v-for="virtual in virtualRows" :key="virtual.key">
          <div
            v-if="rows[virtual.index]!.kind === 'header'"
            :style="rowStyle(virtual)"
            class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border bg-card/95 px-3 py-1.5 backdrop-blur-sm"
          >
            <SelectionCheckbox
              v-if="rows[virtual.index]!.group.items.some((entry) => entry.status === 'will_rename')"
              :state="groupState(rows[virtual.index]!.group.key)"
              :label="t('tools.bulkRename.select.toggleGroup', { kind: rows[virtual.index]!.group.label })"
              @toggle="emit('toggle-group-selected', rows[virtual.index]!.group.key)"
            />
            <span v-else class="size-4" />

            <span
              class="truncate text-[0.6875rem] font-bold tracking-wider text-muted-foreground uppercase"
              :title="rows[virtual.index]!.group.label"
            >
              {{ rows[virtual.index]!.group.label }}
            </span>
            <span class="flex shrink-0 items-center gap-1">
              <span class="rounded-full bg-muted px-1.5 text-[0.6875rem] font-bold text-muted-foreground tabular-nums">
                {{ rows[virtual.index]!.group.items.length }}
              </span>
              <button
                class="grid size-4.5 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                :aria-expanded="!collapsed.has(rows[virtual.index]!.group.key)"
                :aria-label="
                  collapsed.has(rows[virtual.index]!.group.key)
                    ? t('tools.bulkRename.group.expand', { kind: rows[virtual.index]!.group.label })
                    : t('tools.bulkRename.group.collapse', { kind: rows[virtual.index]!.group.label })
                "
                @click="emit('toggle-group', rows[virtual.index]!.group.key)"
              >
                <ChevronDown
                  class="size-3.5 transition-transform"
                  :class="{ '-rotate-90': collapsed.has(rows[virtual.index]!.group.key) }"
                  aria-hidden="true"
                />
              </button>
            </span>
          </div>

          <div
            v-else
            :id="`bulk-rename-row-${rowItem(virtual.index).bookId}`"
            :style="rowStyle(virtual)"
            class="grid cursor-pointer grid-cols-[auto_auto_minmax(0,1fr)] items-center gap-2 border-b border-s-2 border-border/55 border-s-transparent px-3 py-1.5 text-start transition-colors hover:bg-muted"
            :class="{ 'border-s-primary bg-primary/12': currentId === rowItem(virtual.index).bookId }"
            role="option"
            :aria-selected="currentId === rowItem(virtual.index).bookId"
            @click="emit('select', rowItem(virtual.index).bookId)"
          >
            <SelectionCheckbox
              v-if="rowItem(virtual.index).status === 'will_rename'"
              :state="isSelected(rowItem(virtual.index)) ? 'all' : 'none'"
              :label="t('tools.bulkRename.select.toggleBook', { title: rowItem(virtual.index).title })"
              @toggle="emit('toggle-selected', rowItem(virtual.index))"
            />
            <span v-else class="grid size-4 shrink-0 place-items-center text-warning" :title="t('tools.bulkRename.group.heldBack')">
              <ShieldAlert v-if="rowItem(virtual.index).status === 'collision'" class="size-3" aria-hidden="true" />
              <Minus v-else class="size-3 text-muted-foreground" aria-hidden="true" />
            </span>

            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="{
                'bg-primary': rowItem(virtual.index).status === 'will_rename',
                'bg-warning': rowItem(virtual.index).status === 'collision',
                'bg-surface-4': rowItem(virtual.index).status === 'unchanged',
                'bg-muted-foreground/55': rowItem(virtual.index).status === 'no_pattern',
                'bg-destructive': rowItem(virtual.index).status === 'error',
              }"
              aria-hidden="true"
            />

            <span class="min-w-0">
              <span
                class="block truncate text-sm font-medium"
                :class="{
                  'text-muted-foreground line-through': rowItem(virtual.index).status === 'will_rename' && !isSelected(rowItem(virtual.index)),
                  'font-semibold text-primary': currentId === rowItem(virtual.index).bookId,
                }"
              >
                {{ rowItem(virtual.index).title }}
              </span>
              <span class="mt-px block truncate text-[0.6875rem] text-muted-foreground">{{ subtitleFor(rowItem(virtual.index)) }}</span>
            </span>
          </div>
        </template>
      </div>

      <div v-if="hasMore" class="p-3">
        <Button variant="outline" size="sm" class="w-full" :disabled="loadingMore" @click="emit('load-more')">
          {{ loadingMore ? t('common.loading') : t('tools.bulkRename.review.loadMore') }}
        </Button>
      </div>

      <p v-else-if="groups.length === 0" class="px-3 py-8 text-center text-sm text-muted-foreground">
        {{ t('tools.bulkRename.empty.noMatch') }}
      </p>
    </div>
  </div>
</template>
