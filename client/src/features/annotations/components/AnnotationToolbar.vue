<script setup lang="ts">
import { Maximize2, Minimize2, Search, SlidersHorizontal } from '@lucide/vue'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import AnnotationFilterChips from './AnnotationFilterChips.vue'
import type { ActiveFilterChip } from '../lib/filter-chips'
import type { AnnotationDensity } from '../composables/useDensity'

defineProps<{
  sortOptions: { value: string; label: string }[]
  filterCount: number
  chips: ActiveFilterChip[]
  searchPlaceholder?: string
}>()

const search = defineModel<string>('search', { required: true })
const sortKey = defineModel<string>('sortKey', { required: true })
const density = defineModel<AnnotationDensity>('density', { required: true })

const emit = defineEmits<{ removeChip: [id: string]; clearFilters: [] }>()

function toggleDensity() {
  density.value = density.value === 'comfortable' ? 'compact' : 'comfortable'
}

function handleRemoveChip(id: string) {
  emit('removeChip', id)
}

function handleClearFilters() {
  emit('clearFilters')
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <div class="relative w-full sm:w-auto sm:flex-1 sm:min-w-[14rem]">
        <Search :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="search"
          type="search"
          :placeholder="searchPlaceholder ?? 'Search text and notes'"
          class="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <slot name="inline-filters" />

      <div class="hidden sm:block">
        <Popover>
          <PopoverTrigger as-child>
            <Button variant="outline" size="sm" class="gap-1.5">
              <SlidersHorizontal :size="14" />
              Filters
              <Badge v-if="filterCount > 0" variant="secondary" class="ml-0.5 h-5 min-w-5 justify-center px-1">{{ filterCount }}</Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" class="w-80">
            <slot name="filters" />
          </PopoverContent>
        </Popover>
      </div>
      <div class="sm:hidden">
        <Sheet>
          <SheetTrigger as-child>
            <Button variant="outline" size="sm" class="gap-1.5">
              <SlidersHorizontal :size="14" />
              Filters
              <Badge v-if="filterCount > 0" variant="secondary" class="ml-0.5 h-5 min-w-5 justify-center px-1">{{ filterCount }}</Badge>
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" class="max-h-[85vh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
            </SheetHeader>
            <div class="px-4 pb-6">
              <slot name="filters" />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <select v-model="sortKey" aria-label="Sort order" class="h-9 px-2 rounded-md border border-border bg-background text-sm">
        <option v-for="option in sortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <button
        type="button"
        :aria-label="density === 'comfortable' ? 'Switch to compact view' : 'Switch to comfortable view'"
        :title="density === 'comfortable' ? 'Compact view' : 'Comfortable view'"
        class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="toggleDensity"
      >
        <Minimize2 v-if="density === 'comfortable'" :size="14" />
        <Maximize2 v-else :size="14" />
      </button>
    </div>

    <AnnotationFilterChips v-if="chips.length > 0" :chips="chips" @remove="handleRemoveChip" @clear-all="handleClearFilters" />
  </div>
</template>
