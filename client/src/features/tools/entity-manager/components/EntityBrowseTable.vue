<script setup lang="ts">
import { computed } from 'vue'
import { ChevronLeft, ChevronRight, GitMerge, MoreHorizontal, Pencil, Search, Scissors, Trash2, X } from 'lucide-vue-next'
import type { BrowseEntityItem, EntityTypeCapabilities } from '@bookorbit/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const props = defineProps<{
  items: BrowseEntityItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  search: string
  loading: boolean
  selectedIds: Set<number | string>
  capabilities: EntityTypeCapabilities
  isInline: boolean
}>()

const emit = defineEmits<{
  'update:page': [value: number]
  'update:search': [value: string]
  select: [id: number | string, event: MouseEvent]
  rename: [item: BrowseEntityItem]
  delete: [item: BrowseEntityItem]
  bulkDelete: []
  bulkMerge: []
  clearSelection: []
  split: [item: BrowseEntityItem]
  refresh: []
}>()

function handleSearchInput(event: Event): void {
  emit('update:search', (event.target as HTMLInputElement).value)
}

function handlePrevPage(): void {
  emit('update:page', props.page - 1)
}

function handleNextPage(): void {
  emit('update:page', props.page + 1)
}

function handleSelectItem(id: number | string, event: MouseEvent): void {
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

function handleBulkDelete(): void {
  emit('bulkDelete')
}

function handleBulkMerge(): void {
  emit('bulkMerge')
}

const hasSelection = computed(() => props.selectedIds.size > 0)
const canMerge = computed(() => props.selectedIds.size >= 2)
</script>

<template>
  <div class="flex flex-col h-full border border-border rounded-lg overflow-hidden">
    <!-- Sticky header -->
    <div class="flex-none p-2 border-b border-border">
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 sm:pr-4">
        <div class="relative flex-1 sm:max-w-sm">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            :value="search"
            placeholder="Search..."
            class="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            @input="handleSearchInput"
          />
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button
            v-if="hasSelection"
            class="inline-flex items-center gap-1 h-8 px-2 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors mr-1"
            @click="emit('clearSelection')"
          >
            <X class="h-3.5 w-3.5" />
            <span class="text-sm font-medium">Clear</span>
          </button>
          <button
            v-if="canMerge"
            class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
            @click="handleBulkMerge"
          >
            <GitMerge class="h-3.5 w-3.5" />
            Merge ({{ selectedIds.size }})
          </button>
          <button
            v-if="hasSelection"
            class="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors"
            @click="handleBulkDelete"
          >
            <Trash2 class="h-3.5 w-3.5" />
            Delete ({{ selectedIds.size }})
          </button>
          <span class="text-sm text-muted-foreground">{{ total }} total</span>
        </div>
      </div>
    </div>

    <!-- Scrollable content area -->
    <div class="flex-1 overflow-y-auto min-h-0 divide-y divide-border">
      <div v-if="loading" class="text-center py-8 text-muted-foreground text-sm">Loading...</div>

      <div v-else-if="items.length === 0" class="text-center py-8 text-muted-foreground text-sm">No entities found</div>

      <template v-else>
        <div v-for="item in items" :key="String(item.id)" class="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
          <input
            type="checkbox"
            :checked="selectedIds.has(item.id)"
            class="rounded accent-primary shrink-0"
            @click="handleSelectItem(item.id, $event)"
          />
          <div class="flex-1 min-w-0">
            <span class="text-sm font-medium truncate block">{{ item.name }}</span>
            <div v-if="item.sortName" class="text-xs text-muted-foreground">sort: {{ item.sortName }}</div>
          </div>
          <span class="text-xs text-muted-foreground shrink-0">{{ item.bookCount }} {{ item.bookCount === 1 ? 'book' : 'books' }}</span>
          <!-- Desktop: inline action buttons -->
          <div class="hidden sm:flex items-center gap-1 shrink-0">
            <button
              class="h-7 px-2 text-xs rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              @click.stop="handleRename(item)"
            >
              Rename
            </button>
            <button
              v-if="capabilities.canSplit && !isInline"
              class="h-7 px-2 text-xs rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              @click.stop="handleSplit(item)"
            >
              Split
            </button>
            <button
              class="h-7 px-2 text-xs rounded hover:bg-muted text-destructive/70 hover:text-destructive transition-colors"
              @click.stop="handleDelete(item)"
            >
              Delete
            </button>
          </div>
          <!-- Mobile: dropdown menu -->
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button class="sm:hidden p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0">
                <MoreHorizontal class="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="handleRename(item)">
                <Pencil class="size-4 mr-2" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem v-if="capabilities.canSplit && !isInline" @click="handleSplit(item)">
                <Scissors class="size-4 mr-2" />
                Split
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem class="text-destructive focus:text-destructive" @click="handleDelete(item)">
                <Trash2 class="size-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </template>
    </div>

    <!-- Sticky footer -->
    <div v-if="totalPages > 1" class="flex-none p-2 border-t border-border">
      <div class="flex items-center justify-center gap-3">
        <button
          class="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
          :disabled="page <= 1"
          @click="handlePrevPage"
        >
          <ChevronLeft class="h-4 w-4" />
        </button>
        <span class="text-sm text-muted-foreground">{{ page }} / {{ totalPages }}</span>
        <button
          class="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-muted disabled:opacity-30 disabled:pointer-events-none transition-colors"
          :disabled="page >= totalPages"
          @click="handleNextPage"
        >
          <ChevronRight class="h-4 w-4" />
        </button>
      </div>
    </div>
  </div>
</template>
