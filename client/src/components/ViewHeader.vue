<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { CheckSquare, Circle, LayoutGrid, List, MoreHorizontal, Search, SlidersHorizontal, Square, Table2, X } from 'lucide-vue-next'
import * as LucideIcons from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { BookViewMode } from '@/composables/useDisplaySettings'

withDefaults(
  defineProps<{
    title: string
    icon?: string
    total: number
    coverSize: number
    gridGap: number
    viewMode: BookViewMode
    selectionMode?: boolean
    showSelection?: boolean
    showViewModeToggle?: boolean
    coverShape?: 'square' | 'circle'
    coverSizeMin?: number
    coverSizeMax?: number
    coverSizeStep?: number
    gridGapMin?: number
    gridGapMax?: number
    gridGapStep?: number
    searchable?: boolean
    searchQuery?: string
    allowedViewModes?: BookViewMode[]
  }>(),
  {
    coverSizeMin: 100,
    coverSizeMax: 280,
    coverSizeStep: 10,
    gridGapMin: 4,
    gridGapMax: 40,
    gridGapStep: 4,
    showSelection: true,
    showViewModeToggle: true,
    allowedViewModes: () => ['grid', 'list', 'table'] as BookViewMode[],
  },
)

const emit = defineEmits<{
  'update:coverSize': [value: number]
  'update:gridGap': [value: number]
  'update:viewMode': [value: BookViewMode]
  'toggle-selection': []
  'update:coverShape': [value: 'square' | 'circle']
  'update:searchQuery': [value: string]
}>()

const mobileDisplayOpen = ref(false)
const mobileSearchOpen = ref(false)
const searchActive = ref(false)
const searchInputRef = ref<HTMLInputElement | null>(null)
const mobileSearchInputRef = ref<HTMLInputElement | null>(null)

function getIconComponent(name: string) {
  return (LucideIcons as Record<string, unknown>)[name] ?? null
}

function openSearch() {
  if (searchActive.value) return
  searchActive.value = true
  nextTick(() => searchInputRef.value?.focus())
}

function openMobileSearch() {
  mobileSearchOpen.value = true
  nextTick(() => mobileSearchInputRef.value?.focus())
}

function closeMobileSearch() {
  mobileSearchOpen.value = false
}

function clearSearchQuery() {
  emit('update:searchQuery', '')
}

function closeSearch() {
  searchActive.value = false
  clearSearchQuery()
}

function handleSearchKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  if (mobileSearchOpen.value) {
    closeMobileSearch()
    return
  }
  closeSearch()
}

function handleSearchInput(event: Event) {
  emit('update:searchQuery', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="sticky top-0 z-20 mb-2 mt-2 flex h-10 shrink-0 items-center gap-2 p-2 transition-all duration-300 bg-background/80 backdrop-blur-md">
    <!-- Left: icon + title + count -->
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <component v-if="icon" :is="getIconComponent(icon)" :size="16" class="shrink-0 text-muted-foreground" />
      <span class="font-bold text-[16px] text-foreground/90 tracking-tight truncate">{{ title }}</span>
      <span class="text-[12px] font-semibold text-primary/70 tabular-nums shrink-0">({{ total.toLocaleString() }})</span>
    </div>

    <!-- Right -->
    <div class="flex items-center gap-2 shrink-0">
      <!-- Desktop: search widget — left of sort/filter in toolbar slot -->
      <div v-if="searchable" class="relative hidden md:flex items-center shrink-0">
        <Search
          :size="14"
          class="absolute left-2 pointer-events-none z-10 transition-colors duration-200"
          :class="searchActive ? 'text-primary' : 'text-muted-foreground'"
        />
        <input
          ref="searchInputRef"
          :value="searchQuery ?? ''"
          @focus="openSearch"
          @input="handleSearchInput"
          @keydown="handleSearchKeydown"
          type="text"
          placeholder="Search title, author, series, narrator..."
          class="h-8 text-[13px] focus:outline-none transition-all duration-300"
          :class="
            searchActive
              ? 'w-44 lg:w-72 pl-8 pr-6 rounded-lg border border-primary/30 bg-primary/5 focus:ring-1 focus:ring-primary/30 cursor-text text-foreground placeholder:text-muted-foreground/60'
              : 'w-8 pl-2.25 pr-0 rounded-lg border border-input bg-transparent hover:bg-primary/5 hover:border-muted-foreground/30 cursor-pointer text-transparent placeholder:text-transparent select-none'
          "
        />
        <button v-if="searchActive" @click="closeSearch" class="absolute right-1.5 text-muted-foreground/70 hover:text-foreground transition-colors">
          <X :size="13" />
        </button>
      </div>

      <slot name="toolbar" />
      <slot name="actions" />

      <!-- Select mode toggle -->
      <Button
        v-if="showSelection"
        variant="ghost"
        size="sm"
        class="hidden md:flex h-8 gap-1.5 text-[11px] font-bold uppercase tracking-tight px-2.5 rounded-lg transition-all"
        :class="
          selectionMode
            ? 'text-primary bg-primary/10 hover:bg-primary/20 ring-1 ring-primary/20'
            : 'text-muted-foreground/80 hover:text-foreground hover:bg-primary/5'
        "
        @click="emit('toggle-selection')"
      >
        <CheckSquare v-if="selectionMode" :size="13" />
        <Square v-else :size="13" />
        Select
      </Button>

      <div v-if="showSelection" class="hidden md:block w-px h-3.5 bg-border/40 mx-1.5" />

      <!-- Desktop: view mode toggle -->
      <div v-if="showViewModeToggle && allowedViewModes.length > 0" class="hidden md:flex items-center gap-0.5">
        <Button
          v-if="allowedViewModes.includes('grid')"
          variant="ghost"
          size="icon"
          class="h-8 w-8 rounded-lg"
          :class="viewMode === 'grid' ? 'text-primary bg-primary/10' : 'text-muted-foreground/70 hover:text-foreground hover:bg-primary/5'"
          @click="emit('update:viewMode', 'grid')"
        >
          <LayoutGrid :size="14" />
        </Button>
        <Button
          v-if="allowedViewModes.includes('list')"
          variant="ghost"
          size="icon"
          class="h-8 w-8 rounded-lg"
          :class="viewMode === 'list' ? 'text-primary bg-primary/10' : 'text-muted-foreground/70 hover:text-foreground hover:bg-primary/5'"
          @click="emit('update:viewMode', 'list')"
        >
          <List :size="14" />
        </Button>
        <Button
          v-if="allowedViewModes.includes('table')"
          variant="ghost"
          size="icon"
          class="h-8 w-8 rounded-lg"
          :class="viewMode === 'table' ? 'text-primary bg-primary/10' : 'text-muted-foreground/70 hover:text-foreground hover:bg-primary/5'"
          @click="emit('update:viewMode', 'table')"
        >
          <Table2 :size="14" />
        </Button>
      </div>

      <!-- Desktop: display settings popover -->
      <Popover>
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="hidden md:flex h-8 w-8 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-primary/5"
          >
            <SlidersHorizontal :size="14" />
          </Button>
        </PopoverTrigger>
        <PopoverContent :class="viewMode === 'table' ? 'w-80 max-w-[90vw] max-h-[80vh] overflow-y-auto p-4' : 'w-56 p-4'" align="end">
          <div class="space-y-4">
            <p class="text-xs font-semibold text-foreground uppercase tracking-wider">Display</p>
            <template v-if="viewMode !== 'table'">
              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-muted-foreground">Cover size</span>
                  <span class="text-xs font-medium tabular-nums text-foreground">{{ coverSize }}px</span>
                </div>
                <input
                  :value="coverSize"
                  @input="emit('update:coverSize', Number(($event.target as HTMLInputElement).value))"
                  type="range"
                  :min="coverSizeMin"
                  :max="coverSizeMax"
                  :step="coverSizeStep"
                  class="w-full accent-primary cursor-pointer"
                />
              </div>
              <div class="space-y-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-muted-foreground">Grid gap</span>
                  <span class="text-xs font-medium tabular-nums text-foreground">{{ gridGap }}px</span>
                </div>
                <input
                  :value="gridGap"
                  @input="emit('update:gridGap', Number(($event.target as HTMLInputElement).value))"
                  type="range"
                  :min="gridGapMin"
                  :max="gridGapMax"
                  :step="gridGapStep"
                  class="w-full accent-primary cursor-pointer"
                />
              </div>
            </template>
            <template v-else>
              <slot name="columns">
                <p class="text-xs text-muted-foreground">Use the column visibility panel in the table header to show or hide columns.</p>
              </slot>
            </template>
            <div v-if="coverShape !== undefined && viewMode !== 'table'" class="space-y-1.5">
              <span class="text-xs text-muted-foreground">Cover shape</span>
              <div class="flex items-center gap-1 mt-1.5">
                <button
                  class="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-colors"
                  :class="
                    coverShape === 'circle'
                      ? 'border-primary text-primary bg-primary/8'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
                  "
                  @click="emit('update:coverShape', 'circle')"
                >
                  <Circle :size="12" /> Circle
                </button>
                <button
                  class="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-colors"
                  :class="
                    coverShape === 'square'
                      ? 'border-primary text-primary bg-primary/8'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
                  "
                  @click="emit('update:coverShape', 'square')"
                >
                  <Square :size="12" /> Square
                </button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <!-- Mobile: overflow dropdown -->
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="ghost" size="icon" class="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground">
            <MoreHorizontal :size="15" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-44">
          <DropdownMenuRadioGroup :model-value="viewMode" @update:model-value="emit('update:viewMode', $event as BookViewMode)">
            <DropdownMenuRadioItem v-if="allowedViewModes.includes('grid')" value="grid">Grid</DropdownMenuRadioItem>
            <DropdownMenuRadioItem v-if="allowedViewModes.includes('list')" value="list">List</DropdownMenuRadioItem>
            <DropdownMenuRadioItem v-if="allowedViewModes.includes('table')" value="table">Table</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="mobileDisplayOpen = true">
            <SlidersHorizontal :size="14" class="mr-2" />
            Display
          </DropdownMenuItem>
          <template v-if="$slots['mobile-menu']">
            <DropdownMenuSeparator />
            <slot name="mobile-menu" />
          </template>
          <template v-if="searchable">
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="openMobileSearch">
              <Search :size="14" class="mr-2" />
              Search
            </DropdownMenuItem>
          </template>
          <template v-if="showSelection">
            <DropdownMenuSeparator />
            <DropdownMenuItem @click="emit('toggle-selection')">
              <CheckSquare v-if="selectionMode" :size="14" class="mr-2" />
              <Square v-else :size="14" class="mr-2" />
              {{ selectionMode ? 'Exit Select' : 'Select' }}
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>

  <!-- Mobile display sheet -->
  <Sheet v-model:open="mobileDisplayOpen">
    <SheetContent side="bottom">
      <SheetHeader>
        <SheetTitle>Display</SheetTitle>
      </SheetHeader>
      <div class="space-y-4 px-4 pb-6">
        <template v-if="viewMode !== 'table'">
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground">Cover size</span>
              <span class="text-xs font-medium tabular-nums text-foreground">{{ coverSize }}px</span>
            </div>
            <input
              :value="coverSize"
              @input="emit('update:coverSize', Number(($event.target as HTMLInputElement).value))"
              type="range"
              :min="coverSizeMin"
              :max="coverSizeMax"
              :step="coverSizeStep"
              class="w-full accent-primary cursor-pointer"
            />
          </div>
          <div class="space-y-1.5">
            <div class="flex items-center justify-between">
              <span class="text-xs text-muted-foreground">Grid gap</span>
              <span class="text-xs font-medium tabular-nums text-foreground">{{ gridGap }}px</span>
            </div>
            <input
              :value="gridGap"
              @input="emit('update:gridGap', Number(($event.target as HTMLInputElement).value))"
              type="range"
              :min="gridGapMin"
              :max="gridGapMax"
              :step="gridGapStep"
              class="w-full accent-primary cursor-pointer"
            />
          </div>
        </template>
        <template v-else>
          <slot name="columns">
            <p class="text-xs text-muted-foreground">Column visibility can be managed from the table header.</p>
          </slot>
        </template>
        <div v-if="coverShape !== undefined && viewMode !== 'table'" class="space-y-1.5">
          <span class="text-xs text-muted-foreground">Cover shape</span>
          <div class="flex items-center gap-1 mt-1.5">
            <button
              class="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-colors"
              :class="
                coverShape === 'circle'
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
              "
              @click="emit('update:coverShape', 'circle')"
            >
              <Circle :size="12" /> Circle
            </button>
            <button
              class="flex flex-1 items-center justify-center gap-1.5 rounded-md border py-1.5 text-xs font-medium transition-colors"
              :class="
                coverShape === 'square'
                  ? 'border-primary text-primary bg-primary/8'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40'
              "
              @click="emit('update:coverShape', 'square')"
            >
              <Square :size="12" /> Square
            </button>
          </div>
        </div>
      </div>
    </SheetContent>
  </Sheet>

  <Sheet v-if="searchable" v-model:open="mobileSearchOpen">
    <SheetContent side="top">
      <SheetHeader>
        <SheetTitle>Search</SheetTitle>
      </SheetHeader>
      <div class="space-y-3 px-4 pb-6">
        <div class="flex h-9 items-center rounded-md border border-input bg-background px-2.5">
          <Search :size="13" class="mr-1.5 shrink-0 text-muted-foreground/85" />
          <input
            ref="mobileSearchInputRef"
            :value="searchQuery ?? ''"
            @input="handleSearchInput"
            @keydown="handleSearchKeydown"
            type="search"
            placeholder="Search title, author, series, narrator..."
            class="h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/85"
          />
          <button
            v-if="(searchQuery ?? '').trim().length > 0"
            class="ml-1 text-muted-foreground/85 transition-colors hover:text-foreground"
            @click="clearSearchQuery"
          >
            <X :size="12" />
          </button>
        </div>
        <Button variant="outline" size="sm" class="w-full" @click="closeMobileSearch">Done</Button>
      </div>
    </SheetContent>
  </Sheet>
</template>
