<script setup lang="ts">
import { computed, useSlots } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckSquare, MoreHorizontal, Search, SlidersHorizontal, Square } from '@lucide/vue'

const { t } = useI18n()
import { Button } from '@/components/ui/button'
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

const props = withDefaults(
  defineProps<{
    viewMode: BookViewMode
    selectionMode?: boolean
    showSelection?: boolean
    showViewModeToggle?: boolean
    searchable?: boolean
    mobileSearchInMenu?: boolean
    showDisplayAction?: boolean
    allowedViewModes?: BookViewMode[]
  }>(),
  {
    selectionMode: false,
    showSelection: true,
    showViewModeToggle: true,
    searchable: false,
    mobileSearchInMenu: true,
    showDisplayAction: true,
    allowedViewModes: () => ['grid', 'list', 'table'] as BookViewMode[],
  },
)

const emit = defineEmits<{
  'update:viewMode': [value: BookViewMode]
  'open-display': []
  'open-mobile-search': []
  'toggle-selection': []
}>()

function handleViewModeUpdate(value: unknown) {
  if (value !== 'grid' && value !== 'list' && value !== 'table') return
  emit('update:viewMode', value)
}

const slots = useSlots()

const hasViewModeActions = computed(
  () => props.showViewModeToggle && (props.allowedViewModes.includes('grid') || props.allowedViewModes.includes('list')),
)
const hasSearchAction = computed(() => props.searchable && props.mobileSearchInMenu)
const hasSelectionAction = computed(() => props.showSelection)
const hasCustomMobileMenu = computed(() => Boolean(slots['mobile-menu']))
const hasActions = computed(
  () => props.showDisplayAction || hasViewModeActions.value || hasSearchAction.value || hasSelectionAction.value || hasCustomMobileMenu.value,
)
</script>

<template>
  <DropdownMenu v-if="hasActions">
    <DropdownMenuTrigger as-child>
      <Button variant="ghost" size="icon" class="md:hidden h-8 w-8 text-muted-foreground hover:text-foreground">
        <MoreHorizontal :size="15" />
      </Button>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="end" class="w-44">
      <template v-if="showViewModeToggle && (allowedViewModes.includes('grid') || allowedViewModes.includes('list'))">
        <DropdownMenuRadioGroup :model-value="viewMode" @update:model-value="handleViewModeUpdate">
          <DropdownMenuRadioItem v-if="allowedViewModes.includes('grid')" value="grid">{{
            t('components.viewHeader.mobileMenu.grid')
          }}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem v-if="allowedViewModes.includes('list')" value="list">{{
            t('components.viewHeader.mobileMenu.list')
          }}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
      </template>

      <template v-if="showDisplayAction">
        <DropdownMenuItem @click="emit('open-display')">
          <SlidersHorizontal :size="14" class="mr-2" />
          {{ t('components.viewHeader.displayControls.display') }}
        </DropdownMenuItem>
      </template>

      <template v-if="$slots['mobile-menu']">
        <DropdownMenuSeparator />
        <slot name="mobile-menu" />
      </template>

      <template v-if="searchable && mobileSearchInMenu">
        <DropdownMenuSeparator />
        <DropdownMenuItem @click="emit('open-mobile-search')">
          <Search :size="14" class="mr-2" />
          {{ t('common.search') }}
        </DropdownMenuItem>
      </template>

      <template v-if="showSelection">
        <DropdownMenuSeparator />
        <DropdownMenuItem @click="emit('toggle-selection')">
          <CheckSquare v-if="selectionMode" :size="14" class="mr-2" />
          <Square v-else :size="14" class="mr-2" />
          {{ selectionMode ? t('components.viewHeader.mobileMenu.exitSelect') : t('components.viewHeader.mobileMenu.select') }}
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
