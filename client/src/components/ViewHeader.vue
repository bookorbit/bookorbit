<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { CheckSquare, LayoutGrid, List, SlidersHorizontal, Square, Table2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { TableDensity } from '@bookorbit/types'
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
    showJumpRailToggle?: boolean
    showJumpRails?: boolean
    jumpRailModes?: BookViewMode[]
    rowDensity?: TableDensity
    showCoverFallbackToggle?: boolean
    coverFallback?: boolean
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
    /** Views search different things; the default placeholder describes books. */
    searchPlaceholder?: string
    allowedViewModes?: BookViewMode[]
    mobileSearchInMenu?: boolean
    mobileDisplayInMenu?: boolean
    /** Views with no covers and no grid have nothing for the cover-size and gap sliders to do. */
    showDisplayControls?: boolean
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
    showDisplayControls: true,
  },
)

const emit = defineEmits<{
  'update:coverSize': [value: number]
  'update:gridGap': [value: number]
  'update:showJumpRails': [value: boolean]
  'update:rowDensity': [value: TableDensity]
  'update:coverFallback': [value: boolean]
  'update:viewMode': [value: BookViewMode]
  'toggle-selection': []
  'update:coverShape': [value: 'square' | 'circle']
  'update:searchQuery': [value: string]
}>()

const { t } = useI18n()

const mobileDisplayOpen = ref(false)
const mobileSearchOpen = ref(false)

function handleShowJumpRailsUpdate(value: boolean) {
  emit('update:showJumpRails', value)
}

function handleCoverSizeUpdate(value: number) {
  emit('update:coverSize', value)
}

function handleGridGapUpdate(value: number) {
  emit('update:gridGap', value)
}

function handleRowDensityUpdate(value: TableDensity) {
  emit('update:rowDensity', value)
}

function handleCoverFallbackUpdate(value: boolean) {
  emit('update:coverFallback', value)
}

function handleCoverShapeUpdate(value: 'square' | 'circle') {
  emit('update:coverShape', value)
}

function handleViewModeUpdate(value: BookViewMode) {
  emit('update:viewMode', value)
}

function handleSearchQueryUpdate(value: string) {
  emit('update:searchQuery', value)
}

function handleToggleSelection() {
  emit('toggle-selection')
}

function handleGridView() {
  handleViewModeUpdate('grid')
}

function handleListView() {
  handleViewModeUpdate('list')
}

function handleTableView() {
  handleViewModeUpdate('table')
}

function handleOpenDisplay() {
  mobileDisplayOpen.value = true
}

function handleOpenMobileSearch() {
  mobileSearchOpen.value = true
}

function handleMobileSearchOpenUpdate(value: boolean) {
  mobileSearchOpen.value = value
}
</script>

<template>
  <div class="sticky top-0 z-20 mb-2 mt-2 flex h-10 shrink-0 items-center gap-2 bg-background/80 p-2 backdrop-blur-md transition-all duration-300">
    <div class="flex min-w-0 flex-1 items-center gap-2">
      <AppIcon v-if="icon" :icon="icon" :fallback="fallbackIcon" :size="16" class="shrink-0 text-muted-foreground" />
      <span class="truncate text-[16px] font-bold tracking-tight text-foreground">{{ title }}</span>
      <span class="shrink-0 tabular-nums text-[12px] font-semibold text-primary">({{ formatNumber(total) }})</span>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <ViewHeaderDesktopSearch
        v-if="searchable"
        :search-query="searchQuery"
        :placeholder="searchPlaceholder"
        @update:search-query="handleSearchQueryUpdate"
      />

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
            : 'text-muted-foreground hover:text-foreground hover:bg-primary/5'
        "
        @click="handleToggleSelection"
      >
        <CheckSquare v-if="selectionMode" :size="13" />
        <Square v-else :size="13" />
        {{ t('components.viewHeader.select') }}
      </Button>

      <div v-if="showSelection" class="mx-1.5 hidden h-3.5 w-px bg-border/40 md:block" />

      <div v-if="showViewModeToggle && allowedViewModes.length > 0" class="hidden items-center gap-0.5 md:flex">
        <Tooltip v-if="allowedViewModes.includes('grid')">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 rounded-lg"
              :class="viewMode === 'grid' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-primary/5'"
              :aria-label="t('components.viewHeader.viewModes.grid')"
              :aria-pressed="viewMode === 'grid'"
              @click="handleGridView"
            >
              <LayoutGrid :size="14" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('components.viewHeader.viewModes.grid') }}</TooltipContent>
        </Tooltip>
        <Tooltip v-if="allowedViewModes.includes('list')">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 rounded-lg"
              :class="viewMode === 'list' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-primary/5'"
              :aria-label="t('components.viewHeader.viewModes.list')"
              :aria-pressed="viewMode === 'list'"
              @click="handleListView"
            >
              <List :size="14" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('components.viewHeader.viewModes.list') }}</TooltipContent>
        </Tooltip>
        <Tooltip v-if="allowedViewModes.includes('table')">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 rounded-lg"
              :class="viewMode === 'table' ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-primary/5'"
              :aria-label="t('components.viewHeader.viewModes.table')"
              :aria-pressed="viewMode === 'table'"
              @click="handleTableView"
            >
              <Table2 :size="14" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ t('components.viewHeader.viewModes.table') }}</TooltipContent>
        </Tooltip>
      </div>

      <Tooltip v-if="showDisplayControls">
        <Popover>
          <TooltipTrigger as-child>
            <PopoverTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="hidden h-8 w-8 rounded-lg text-muted-foreground hover:bg-primary/5 hover:text-foreground md:flex"
                :aria-label="t('components.viewHeader.display')"
              >
                <SlidersHorizontal :size="14" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <PopoverContent :class="viewMode === 'table' ? 'w-80 max-w-[90vw] max-h-[80vh] overflow-y-auto p-4' : 'w-56 p-4'" align="end">
            <ViewHeaderDisplayControls
              :view-mode="viewMode"
              :cover-size="coverSize"
              :grid-gap="gridGap"
              :show-jump-rail-toggle="showJumpRailToggle"
              :show-jump-rails="showJumpRails"
              :jump-rail-modes="jumpRailModes"
              :row-density="rowDensity"
              :show-cover-fallback-toggle="showCoverFallbackToggle"
              :cover-fallback="coverFallback"
              :cover-shape="coverShape"
              :cover-size-min="coverSizeMin"
              :cover-size-max="coverSizeMax"
              :cover-size-step="coverSizeStep"
              :grid-gap-min="gridGapMin"
              :grid-gap-max="gridGapMax"
              :grid-gap-step="gridGapStep"
              @update:cover-size="handleCoverSizeUpdate"
              @update:grid-gap="handleGridGapUpdate"
              @update:show-jump-rails="handleShowJumpRailsUpdate"
              @update:row-density="handleRowDensityUpdate"
              @update:cover-fallback="handleCoverFallbackUpdate"
              @update:cover-shape="handleCoverShapeUpdate"
            >
              <template #columns>
                <slot name="columns">
                  <p class="text-xs text-muted-foreground">{{ t('components.viewHeader.columnVisibilityHint') }}</p>
                </slot>
              </template>
            </ViewHeaderDisplayControls>
          </PopoverContent>
        </Popover>
        <TooltipContent>{{ t('components.viewHeader.display') }}</TooltipContent>
      </Tooltip>

      <ViewHeaderMobileMenu
        :view-mode="viewMode"
        :selection-mode="selectionMode"
        :show-selection="showSelection"
        :show-view-mode-toggle="showViewModeToggle"
        :searchable="searchable"
        :mobile-search-in-menu="mobileSearchInMenu"
        :show-display-action="mobileDisplayInMenu && showDisplayControls"
        :allowed-view-modes="allowedViewModes"
        @update:view-mode="handleViewModeUpdate"
        @open-display="handleOpenDisplay"
        @open-mobile-search="handleOpenMobileSearch"
        @toggle-selection="handleToggleSelection"
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
        <SheetTitle>{{ t('components.viewHeader.display') }}</SheetTitle>
        <SheetDescription class="sr-only">{{ t('components.viewHeader.displayDescription') }}</SheetDescription>
      </SheetHeader>
      <div class="px-4 pb-6">
        <ViewHeaderDisplayControls
          :view-mode="viewMode"
          :cover-size="coverSize"
          :grid-gap="gridGap"
          :show-jump-rail-toggle="showJumpRailToggle"
          :show-jump-rails="showJumpRails"
          :jump-rail-modes="jumpRailModes"
          :row-density="rowDensity"
          :show-cover-fallback-toggle="showCoverFallbackToggle"
          :cover-fallback="coverFallback"
          :cover-shape="coverShape"
          :cover-size-min="coverSizeMin"
          :cover-size-max="coverSizeMax"
          :cover-size-step="coverSizeStep"
          :grid-gap-min="gridGapMin"
          :grid-gap-max="gridGapMax"
          :grid-gap-step="gridGapStep"
          @update:cover-size="handleCoverSizeUpdate"
          @update:grid-gap="handleGridGapUpdate"
          @update:show-jump-rails="handleShowJumpRailsUpdate"
          @update:row-density="handleRowDensityUpdate"
          @update:cover-fallback="handleCoverFallbackUpdate"
          @update:cover-shape="handleCoverShapeUpdate"
        >
          <template #columns>
            <slot name="columns">
              <p class="text-xs text-muted-foreground">{{ t('components.viewHeader.columnVisibilityMobileHint') }}</p>
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
    :placeholder="searchPlaceholder"
    @update:open="handleMobileSearchOpenUpdate"
    @update:search-query="handleSearchQueryUpdate"
  />
</template>
