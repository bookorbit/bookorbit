<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-vue-next'
import { ANNOTATION_HIGHLIGHT_COLORS } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const props = defineProps<{
  activeColors: string[]
  chapters: string[]
  selectedChapter: string | undefined
  dateFrom: string | undefined
  dateTo: string | undefined
}>()

const emit = defineEmits<{
  toggleColor: [color: string]
  search: [query: string]
  chapterChange: [chapter: string | undefined]
  dateRangeChange: [from: string | undefined, to: string | undefined]
}>()

const COLORS = ANNOTATION_HIGHLIGHT_COLORS

const searchInput = ref('')
let searchTimeout: ReturnType<typeof setTimeout> | null = null

const activeFilterCount = computed(() => {
  let count = props.activeColors.length
  if (props.selectedChapter) count += 1
  if (props.dateFrom) count += 1
  if (props.dateTo) count += 1
  return count
})

function handleSearchInput(e: Event) {
  const value = (e.target as HTMLInputElement).value
  searchInput.value = value
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => emit('search', value), 300)
}

function clearSearch() {
  searchInput.value = ''
  if (searchTimeout) clearTimeout(searchTimeout)
  emit('search', '')
}

function handleColorToggle(color: string) {
  emit('toggleColor', color)
}

function handleChapterChange(e: Event) {
  const value = (e.target as HTMLSelectElement).value || undefined
  emit('chapterChange', value)
}

function handleDateFromChange(e: Event) {
  const value = (e.target as HTMLInputElement).value || undefined
  emit('dateRangeChange', value, props.dateTo)
}

function handleDateToChange(e: Event) {
  const value = (e.target as HTMLInputElement).value || undefined
  emit('dateRangeChange', props.dateFrom, value)
}

function clearAllFilters() {
  for (const color of [...props.activeColors]) emit('toggleColor', color)
  emit('chapterChange', undefined)
  emit('dateRangeChange', undefined, undefined)
}
</script>

<template>
  <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
    <div class="relative sm:flex-1 sm:min-w-[140px]">
      <Search :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        :value="searchInput"
        placeholder="Search highlights..."
        class="w-full h-9 pl-9 pr-8 rounded-md border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        @input="handleSearchInput"
      />
      <button v-if="searchInput" class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" @click="clearSearch">
        <X :size="14" />
      </button>
    </div>

    <Popover>
      <PopoverTrigger as-child>
        <button
          type="button"
          class="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground shrink-0"
        >
          <SlidersHorizontal :size="14" />
          Filters
          <span
            v-if="activeFilterCount > 0"
            class="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
          >
            {{ activeFilterCount }}
          </span>
          <ChevronDown :size="14" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" class="w-80 space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-foreground">Filters</span>
          <button
            v-if="activeFilterCount > 0"
            type="button"
            class="text-xs text-muted-foreground transition-colors hover:text-foreground"
            @click="clearAllFilters"
          >
            Clear all
          </button>
        </div>

        <div class="space-y-1.5">
          <span class="text-xs font-medium text-muted-foreground">Colors</span>
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              v-for="c in COLORS"
              :key="c.hex"
              type="button"
              class="h-7 w-7 rounded-full border-2 transition-all hover:scale-110"
              :class="
                activeColors.includes(c.hex)
                  ? 'border-foreground scale-110 ring-1 ring-foreground/20'
                  : 'border-transparent opacity-60 hover:opacity-100'
              "
              :style="{ background: c.hex }"
              :title="c.label"
              @click="handleColorToggle(c.hex)"
            />
          </div>
        </div>

        <div v-if="chapters.length > 0" class="space-y-1.5">
          <span class="text-xs font-medium text-muted-foreground">Chapter</span>
          <select
            class="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            :value="selectedChapter ?? ''"
            @change="handleChapterChange"
          >
            <option value="">All chapters</option>
            <option v-for="ch in chapters" :key="ch" :value="ch">{{ ch }}</option>
          </select>
        </div>

        <div class="space-y-1.5">
          <span class="text-xs font-medium text-muted-foreground">Date range</span>
          <div class="flex items-center gap-2">
            <input
              type="date"
              class="h-9 flex-1 rounded-md border border-border bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              :value="dateFrom ?? ''"
              @change="handleDateFromChange"
            />
            <span class="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              class="h-9 flex-1 rounded-md border border-border bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              :value="dateTo ?? ''"
              @change="handleDateToChange"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>

    <div class="flex items-center gap-2 shrink-0 sm:ml-auto">
      <slot />
    </div>
  </div>
</template>
