<script setup lang="ts">
import { computed } from 'vue'
import { ArrowUpDown, Highlighter } from 'lucide-vue-next'
import type { BookDetail } from '@bookorbit/types'
import { useBookHighlights } from '@/features/book/composables/useBookHighlights'
import HighlightsFilterBar from './HighlightsFilterBar.vue'
import HighlightChapterGroup from './HighlightChapterGroup.vue'
import HighlightCard from './HighlightCard.vue'
import HighlightsExportMenu from './HighlightsExportMenu.vue'

const props = defineProps<{ book: BookDetail }>()

const bookIdRef = computed(() => props.book.id)
const {
  items,
  total,
  loading,
  error,
  page,
  pageSize,
  sortBy,
  sortDir,
  colors: activeColors,
  chapter: selectedChapter,
  dateFrom,
  dateTo,
  chapters,
  updateNote,
  updateColor,
  deleteHighlight,
  setPage,
  setSort,
  toggleColor,
  setSearch,
  setChapter,
  setDateRange,
} = useBookHighlights(bookIdRef)

const groupedHighlights = computed(() => {
  const groups = new Map<string, typeof items.value>()
  for (const item of items.value) {
    const key = item.chapterTitle ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }
  return groups
})

const hasChapterGroups = computed(() => {
  if (groupedHighlights.value.size === 0) return false
  if (groupedHighlights.value.size === 1 && groupedHighlights.value.has('')) return false
  return true
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const startItem = computed(() => Math.min((page.value - 1) * pageSize.value + 1, total.value))
const endItem = computed(() => Math.min(page.value * pageSize.value, total.value))

const sortLabel = computed(() => {
  if (sortBy.value === 'position') return 'Position'
  return sortDir.value === 'desc' ? 'Newest' : 'Oldest'
})

function handleToggleSort() {
  if (sortBy.value === 'position') {
    setSort('createdAt', 'desc')
  } else if (sortDir.value === 'desc') {
    setSort('createdAt', 'asc')
  } else {
    setSort('position', 'asc')
  }
}

async function handleUpdateNote(id: number, note: string | null) {
  await updateNote(id, note)
}

async function handleUpdateColor(id: number, color: string) {
  await updateColor(id, color)
}

async function handleDelete(id: number) {
  await deleteHighlight(id)
}

function handlePrevPage() {
  setPage(page.value - 1)
}

function handleNextPage() {
  setPage(page.value + 1)
}

function handleSearchChange(query: string) {
  setSearch(query)
}

function handleChapterChange(ch: string | undefined) {
  setChapter(ch)
}

function handleDateRangeChange(from: string | undefined, to: string | undefined) {
  setDateRange(from, to)
}
</script>

<template>
  <div class="space-y-5">
    <div v-if="error" class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {{ error }}
    </div>

    <HighlightsFilterBar
      :active-colors="activeColors"
      :chapters="chapters"
      :selected-chapter="selectedChapter"
      :date-from="dateFrom"
      :date-to="dateTo"
      @toggle-color="toggleColor"
      @search="handleSearchChange"
      @chapter-change="handleChapterChange"
      @date-range-change="handleDateRangeChange"
    >
      <div class="flex items-center gap-2">
        <button
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="handleToggleSort"
        >
          <ArrowUpDown :size="14" />
          {{ sortLabel }}
        </button>
        <HighlightsExportMenu :items="items" :book-title="book.title ?? 'Untitled'" />
      </div>
    </HighlightsFilterBar>

    <div class="transition-opacity" :class="{ 'opacity-50 pointer-events-none': loading && items.length > 0 }">
      <div v-if="items.length === 0 && !loading" class="flex flex-col items-center justify-center py-16 gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Highlighter :size="20" class="text-muted-foreground/60" />
        </div>
        <p class="text-sm text-muted-foreground">No highlights yet</p>
        <p class="text-xs text-muted-foreground/70">Select text while reading to create highlights</p>
      </div>

      <div v-else class="space-y-4">
        <template v-if="hasChapterGroups">
          <HighlightChapterGroup
            v-for="[chapterTitle, highlights] in groupedHighlights"
            :key="chapterTitle"
            :chapter-title="chapterTitle || 'Uncategorized'"
            :highlights="highlights"
            @update-note="handleUpdateNote"
            @update-color="handleUpdateColor"
            @delete="handleDelete"
          />
        </template>
        <template v-else>
          <HighlightCard
            v-for="h in items"
            :key="h.id"
            :highlight="h"
            @update-note="handleUpdateNote"
            @update-color="handleUpdateColor"
            @delete="handleDelete"
          />
        </template>
      </div>
    </div>

    <div v-if="total > 0" class="flex items-center justify-between text-sm text-muted-foreground">
      <span>Showing {{ startItem }}-{{ endItem }} of {{ total }} highlights</span>
      <div class="flex items-center gap-2">
        <button
          class="px-3 py-1.5 rounded border border-border bg-card hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed text-foreground text-sm"
          :disabled="page <= 1"
          @click="handlePrevPage"
        >
          Prev
        </button>
        <span class="text-xs">{{ page }} / {{ totalPages }}</span>
        <button
          class="px-3 py-1.5 rounded border border-border bg-card hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed text-foreground text-sm"
          :disabled="page >= totalPages"
          @click="handleNextPage"
        >
          Next
        </button>
      </div>
    </div>
  </div>
</template>
