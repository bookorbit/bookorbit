<script setup lang="ts">
import { cn } from '@/lib/utils'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckSquare, LayoutGrid, List, SlidersHorizontal, Square, Table2 } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import ViewHeaderMobileMenu from '@/components/view-header/ViewHeaderMobileMenu.vue'
import type { BookViewMode } from '@/composables/useDisplaySettings'
import { barButton, barButtonOn, barDivider, barIconButton, segmentItem, segmentTrack } from './browse-header'

/**
 * The bar's right end: Select, the view modes and Display. Below md they collapse into the
 * existing mobile menu and a bottom sheet, so the phone bar keeps room for search.
 */
withDefaults(
  defineProps<{
    viewMode: BookViewMode
    allowedViewModes?: BookViewMode[]
    selectionMode?: boolean
    showSelection?: boolean
    showDisplay?: boolean
    /** Wider popover for the table's column panel. */
    displayWide?: boolean
  }>(),
  {
    allowedViewModes: () => ['grid', 'list', 'table'] as BookViewMode[],
    selectionMode: false,
    showSelection: true,
    showDisplay: true,
    displayWide: false,
  },
)

const emit = defineEmits<{
  'update:viewMode': [value: BookViewMode]
  'toggle-selection': []
}>()

const { t } = useI18n()
const displayOpen = ref(false)
const mobileDisplayOpen = ref(false)

const VIEW_ICONS = { grid: LayoutGrid, list: List, table: Table2 } as const

function handleViewMode(mode: BookViewMode) {
  emit('update:viewMode', mode)
}

function handleMobileViewMode(mode: BookViewMode) {
  emit('update:viewMode', mode)
}

function handleToggleSelection() {
  emit('toggle-selection')
}

function handleOpenMobileDisplay() {
  mobileDisplayOpen.value = true
}

function handleDisplayOpenChange(value: boolean) {
  displayOpen.value = value
}

function handleMobileDisplayOpenChange(value: boolean) {
  mobileDisplayOpen.value = value
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-1">
    <template v-if="showSelection">
      <button
        type="button"
        :class="cn(barButton, 'hidden md:inline-flex', selectionMode && barButtonOn)"
        :aria-pressed="selectionMode"
        :aria-label="t('components.viewHeader.select')"
        @click="handleToggleSelection"
      >
        <CheckSquare v-if="selectionMode" :size="14" class="text-primary" aria-hidden="true" />
        <Square v-else :size="14" class="text-muted-foreground" aria-hidden="true" />
        <span class="hidden xl:inline">{{ t('components.viewHeader.select') }}</span>
      </button>
      <span :class="cn(barDivider, 'hidden md:block')" aria-hidden="true" />
    </template>

    <div
      v-if="allowedViewModes.length > 1"
      :class="cn(segmentTrack, 'hidden md:inline-flex')"
      role="group"
      :aria-label="t('components.browseHeader.viewModes')"
    >
      <button
        v-for="mode in allowedViewModes"
        :key="mode"
        type="button"
        :class="cn(segmentItem, 'w-7 justify-center px-0')"
        :aria-pressed="viewMode === mode"
        :aria-label="t(`components.viewHeader.viewModes.${mode}`)"
        :title="t(`components.viewHeader.viewModes.${mode}`)"
        @click="handleViewMode(mode)"
      >
        <component :is="VIEW_ICONS[mode]" :size="15" :class="viewMode === mode ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
      </button>
    </div>

    <Popover v-if="showDisplay" :open="displayOpen" @update:open="handleDisplayOpenChange">
      <PopoverTrigger as-child>
        <button
          type="button"
          :class="cn(barIconButton, 'hidden md:inline-grid', displayOpen && barButtonOn)"
          :aria-label="t('components.viewHeader.display')"
          :title="t('components.viewHeader.display')"
        >
          <SlidersHorizontal :size="15" :class="displayOpen ? 'text-primary' : 'text-muted-foreground'" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" :side-offset="8" :class="displayWide ? 'max-h-[80vh] w-80 max-w-[90vw] overflow-y-auto p-4' : 'w-64 p-4'">
        <slot name="display" />
      </PopoverContent>
    </Popover>

    <ViewHeaderMobileMenu
      :view-mode="viewMode"
      :selection-mode="selectionMode"
      :show-selection="showSelection"
      :show-view-mode-toggle="allowedViewModes.length > 1"
      :searchable="false"
      :show-display-action="showDisplay"
      :allowed-view-modes="allowedViewModes"
      @update:view-mode="handleMobileViewMode"
      @open-display="handleOpenMobileDisplay"
      @toggle-selection="handleToggleSelection"
    >
      <template v-if="$slots['mobile-menu']" #mobile-menu>
        <slot name="mobile-menu" />
      </template>
    </ViewHeaderMobileMenu>

    <Sheet v-if="showDisplay" :open="mobileDisplayOpen" @update:open="handleMobileDisplayOpenChange">
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{{ t('components.viewHeader.display') }}</SheetTitle>
          <SheetDescription class="sr-only">{{ t('components.viewHeader.displayDescription') }}</SheetDescription>
        </SheetHeader>
        <div class="px-4 pb-6">
          <slot name="display" />
        </div>
      </SheetContent>
    </Sheet>
  </div>
</template>
