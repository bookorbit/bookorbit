<script setup lang="ts">
import { ref, watch } from 'vue'
import { Search, X } from 'lucide-vue-next'
import { ANNOTATION_HIGHLIGHT_COLORS } from '@bookorbit/types'

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

watch(
  () => props.activeColors,
  () => {},
  { deep: true },
)
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

    <div class="flex flex-wrap items-center gap-1.5 shrink-0">
      <button
        v-for="c in COLORS"
        :key="c.hex"
        class="w-7 h-7 rounded-full border-2 transition-all hover:scale-110"
        :class="
          activeColors.includes(c.hex) ? 'border-foreground scale-110 ring-1 ring-foreground/20' : 'border-transparent opacity-60 hover:opacity-100'
        "
        :style="{ background: c.hex }"
        :title="c.label"
        @click="emit('toggleColor', c.hex)"
      />
    </div>

    <select
      v-if="chapters.length > 0"
      class="h-9 px-3 rounded-md text-sm border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-auto sm:max-w-[160px] shrink-0"
      :value="selectedChapter ?? ''"
      @change="handleChapterChange"
    >
      <option value="">All chapters</option>
      <option v-for="ch in chapters" :key="ch" :value="ch">{{ ch }}</option>
    </select>

    <div class="flex items-center gap-2 shrink-0">
      <input
        type="date"
        class="h-9 px-2 rounded-md text-sm border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        :value="dateFrom ?? ''"
        @change="handleDateFromChange"
      />
      <span class="text-xs text-muted-foreground">to</span>
      <input
        type="date"
        class="h-9 px-2 rounded-md text-sm border border-border bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        :value="dateTo ?? ''"
        @change="handleDateToChange"
      />
    </div>

    <div class="flex items-center gap-2 shrink-0 sm:ml-auto">
      <slot />
    </div>
  </div>
</template>
