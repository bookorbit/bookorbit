<script setup lang="ts">
import { ref } from 'vue'
import { CheckSquare, LayoutGrid, List, SlidersHorizontal, Square, Table2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { BookViewMode } from '@/composables/useDisplaySettings'
import ViewHeaderDesktopSearch from '@/components/view-header/ViewHeaderDesktopSearch.vue'
import ViewHeaderDisplayControls from '@/components/view-header/ViewHeaderDisplayControls.vue'
import ViewHeaderMobileMenu from '@/components/view-header/ViewHeaderMobileMenu.vue'
import ViewHeaderMobileSearchSheet from '@/components/view-header/ViewHeaderMobileSearchSheet.vue'
import AppIcon from '@/components/AppIcon.vue'

withDefaults(
  defineProps<{
    title: string
    icon?: string
    fallbackIcon?: string
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
    mobileSearchInMenu?: boolean
    mobileDisplayInMenu?: boolean
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
    mobileSearchInMenu: true,
    mobileDisplayInMenu: true,
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
</script>

<template>
  <div class="sticky top-0 z-20 mb-2 mt-2 flex h-10 shrink-0 items-center gap-2 bg-background/80 p-2 backdrop-blur-md transition-all duration-300">
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <AppIcon v-if="icon" :icon="icon" :fallback="fallbackIcon" :size="16" class="shrink-0 text-muted-foreground" />
      <span class="truncate text-[16px] font-bold tracking-tight text-foreground/90">{{ title }}</span>
      <span class="shrink-0 tabular-nums text-[12px] font-semibold text-primary/70">({{ total.toLocaleString() }})</span>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <ViewHeaderDesktopSearch v-if="searchable" :search-query="searchQuery" @update:search-query="emit('update:searchQuery', $event)" />

      <slot name="toolbar" />
      <slot name="actions" />

      <Button
        v-if="showSelection"
        variant="ghost"
        size="sm"
        class="hidden h-8 gap-1.5 rounded-lg px-2.5 text-[11px] font-bold uppercase tracking-tight transition-all md:flex"
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

      <div v-if="showSelection" class="mx-1.5 hidden h-3.5 w-px bg-border/40 md:block" />

      <div v-if="showViewModeToggle && allowedViewModes.length > 0" class="hidden items-center gap-0.5 md:flex">
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

      <Popover>
        <PopoverTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="hidden h-8 w-8 rounded-lg text-muted-foreground/70 hover:bg-primary/5 hover:text-foreground md:flex"
          >
            <SlidersHorizontal :size="14" />
          </Button>
        </PopoverTrigger>
        <PopoverContent :class="viewMode === 'table' ? 'w-80 max-w-[90vw] max-h-[80vh] overflow-y-auto p-4' : 'w-56 p-4'" align="end">
          <ViewHeaderDisplayControls
            :view-mode="viewMode"
            :cover-size="coverSize"
            :grid-gap="gridGap"
            :cover-shape="coverShape"
            :cover-size-min="coverSizeMin"
            :cover-size-max="coverSizeMax"
            :cover-size-step="coverSizeStep"
            :grid-gap-min="gridGapMin"
            :grid-gap-max="gridGapMax"
            :grid-gap-step="gridGapStep"
            @update:cover-size="emit('update:coverSize', $event)"
            @update:grid-gap="emit('update:gridGap', $event)"
            @update:cover-shape="emit('update:coverShape', $event)"
          >
            <template #columns>
              <slot name="columns">
                <p class="text-xs text-muted-foreground">Use the column visibility panel in the table header to show or hide columns.</p>
              </slot>
            </template>
          </ViewHeaderDisplayControls>
        </PopoverContent>
      </Popover>

      <ViewHeaderMobileMenu
        :view-mode="viewMode"
        :selection-mode="selectionMode"
        :show-selection="showSelection"
        :show-view-mode-toggle="showViewModeToggle"
        :searchable="searchable"
        :mobile-search-in-menu="mobileSearchInMenu"
        :show-display-action="mobileDisplayInMenu"
        :allowed-view-modes="allowedViewModes"
        @update:view-mode="emit('update:viewMode', $event)"
        @open-display="mobileDisplayOpen = true"
        @open-mobile-search="mobileSearchOpen = true"
        @toggle-selection="emit('toggle-selection')"
      >
        <template v-if="$slots['mobile-menu']" #mobile-menu>
          <slot name="mobile-menu" />
        </template>
      </ViewHeaderMobileMenu>
    </div>
  </div>

  <Sheet v-model:open="mobileDisplayOpen">
    <SheetContent side="bottom">
      <SheetHeader>
        <SheetTitle>Display</SheetTitle>
        <SheetDescription class="sr-only">Adjust cover size, grid spacing, and view display options.</SheetDescription>
      </SheetHeader>
      <div class="px-4 pb-6">
        <ViewHeaderDisplayControls
          :view-mode="viewMode"
          :cover-size="coverSize"
          :grid-gap="gridGap"
          :cover-shape="coverShape"
          :cover-size-min="coverSizeMin"
          :cover-size-max="coverSizeMax"
          :cover-size-step="coverSizeStep"
          :grid-gap-min="gridGapMin"
          :grid-gap-max="gridGapMax"
          :grid-gap-step="gridGapStep"
          @update:cover-size="emit('update:coverSize', $event)"
          @update:grid-gap="emit('update:gridGap', $event)"
          @update:cover-shape="emit('update:coverShape', $event)"
        >
          <template #columns>
            <slot name="columns">
              <p class="text-xs text-muted-foreground">Column visibility can be managed from the table header.</p>
            </slot>
          </template>
        </ViewHeaderDisplayControls>
      </div>
    </SheetContent>
  </Sheet>

  <ViewHeaderMobileSearchSheet
    v-if="searchable && mobileSearchInMenu"
    :open="mobileSearchOpen"
    :search-query="searchQuery"
    @update:open="mobileSearchOpen = $event"
    @update:search-query="emit('update:searchQuery', $event)"
  />
</template>
