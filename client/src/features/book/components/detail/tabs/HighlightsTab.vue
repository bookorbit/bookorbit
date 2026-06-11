<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowUpDown, CheckSquare, Highlighter, Maximize2, Minimize2, Palette, Trash2 } from 'lucide-vue-next'
import type { AnnotationItem, BookDetail } from '@bookorbit/types'
import AnnotationListItem from '@/features/annotations/components/AnnotationListItem.vue'
import { useBookHighlights } from '@/features/book/composables/useBookHighlights'
import HighlightsFilterBar from './HighlightsFilterBar.vue'
import HighlightChapterGroup from './HighlightChapterGroup.vue'
import HighlightsExportMenu from './HighlightsExportMenu.vue'

const props = defineProps<{ book: BookDetail }>()

const router = useRouter()
const bookIdRef = computed(() => props.book.id)
const {
  items,
  total,
  stats,
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
  updateStyle,
  deleteHighlight,
  bulkTrash,
  bulkRestyle,
  setPage,
  setSort,
  toggleColor,
  setSearch,
  setChapter,
  setDateRange,
} = useBookHighlights(bookIdRef)

const BULK_COLORS = [
  { hex: '#FACC15', label: 'Yellow' },
  { hex: '#4ADE80', label: 'Green' },
  { hex: '#38BDF8', label: 'Blue' },
  { hex: '#F472B6', label: 'Pink' },
  { hex: '#FB923C', label: 'Orange' },
]

const BULK_STYLES = [
  { value: 'highlight', label: 'Highlight' },
  { value: 'underline', label: 'Underline' },
  { value: 'strikethrough', label: 'Strike' },
  { value: 'squiggly', label: 'Squiggle' },
  { value: 'invert', label: 'Invert' },
]

const ORIGIN_LABELS: Record<AnnotationItem['origin'], string> = {
  web: 'Web',
  koreader: 'KOReader',
  kobo: 'Kobo',
}

const ORIGIN_CLASSES: Record<AnnotationItem['origin'], string> = {
  web: 'border-primary/30 bg-primary/10 text-primary',
  koreader: 'border-border bg-secondary text-secondary-foreground',
  kobo: 'border-destructive/30 bg-destructive/10 text-destructive',
}

const density = ref<'compact' | 'comfortable'>('comfortable')
const selectedIds = ref<Set<number>>(new Set())
const savingIds = ref<Set<number>>(new Set())

const groupedHighlights = computed(() => {
  const groups = new Map<string, AnnotationItem[]>()
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
const visibleIds = computed(() => items.value.map((item) => item.id))
const selectedItems = computed(() => items.value.filter((item) => selectedIds.value.has(item.id)))
const hasSelection = computed(() => selectedIds.value.size > 0)
const allVisibleSelected = computed(() => visibleIds.value.length > 0 && visibleIds.value.every((id) => selectedIds.value.has(id)))

const sortLabel = computed(() => {
  if (sortBy.value === 'position') return 'Position'
  return sortDir.value === 'desc' ? 'Newest' : 'Oldest'
})

const originSummary = computed(() => {
  return (stats.value?.originBreakdown ?? [])
    .filter((entry) => entry.count > 0)
    .map((entry) => ({ label: ORIGIN_LABELS[entry.origin], count: entry.count, class: ORIGIN_CLASSES[entry.origin] }))
})

const summaryItems = computed(() => {
  const result = [`${total.value} highlights`]
  if (stats.value) {
    result.push(`${stats.value.highlightsWithNotes} notes`)
    result.push(`${stats.value.chaptersWithHighlights} chapters`)
  }
  return result
})

watch(items, (nextItems) => {
  const currentIds = new Set(nextItems.map((item) => item.id))
  selectedIds.value = new Set([...selectedIds.value].filter((id) => currentIds.has(id)))
  savingIds.value = new Set([...savingIds.value].filter((id) => currentIds.has(id)))
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

function toggleDensity() {
  density.value = density.value === 'compact' ? 'comfortable' : 'compact'
}

function toggleSelected(id: number) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selectedIds.value = next
}

function selectAllOnPage() {
  const next = new Set(selectedIds.value)
  for (const id of visibleIds.value) next.add(id)
  selectedIds.value = next
}

function clearSelection() {
  selectedIds.value = new Set()
}

function setSaving(id: number, saving: boolean) {
  const next = new Set(savingIds.value)
  if (saving) next.add(id)
  else next.delete(id)
  savingIds.value = next
}

function selectedIdsArray(): number[] {
  return [...selectedIds.value]
}

function handleJump(annotation: AnnotationItem) {
  if (!annotation.jumpFileId) return
  const query: Record<string, string> = {}
  const file = props.book.files.find((bookFile) => bookFile.id === annotation.jumpFileId)
  if (file?.format) query.format = file.format
  if (annotation.cfi) query.cfi = annotation.cfi
  else if (annotation.pageno != null) query.page = String(annotation.pageno)
  void router.push({ name: 'reader', params: { bookId: annotation.bookId, fileId: annotation.jumpFileId }, query })
}

async function handleUpdateNote(id: number, note: string | null) {
  setSaving(id, true)
  try {
    await updateNote(id, note)
  } finally {
    setSaving(id, false)
  }
}

async function handleUpdateColor(id: number, color: string) {
  setSaving(id, true)
  try {
    await updateColor(id, color)
  } finally {
    setSaving(id, false)
  }
}

async function handleUpdateStyle(id: number, style: string) {
  setSaving(id, true)
  try {
    await updateStyle(id, style)
  } finally {
    setSaving(id, false)
  }
}

async function handleDelete(id: number) {
  await deleteHighlight(id)
  const next = new Set(selectedIds.value)
  next.delete(id)
  selectedIds.value = next
}

async function handleBulkTrash() {
  const affected = await bulkTrash(selectedIdsArray())
  if (affected > 0) clearSelection()
}

async function handleBulkColor(color: string) {
  const affected = await bulkRestyle(selectedIdsArray(), { color })
  if (affected > 0) clearSelection()
}

async function handleBulkStyle(style: string) {
  const affected = await bulkRestyle(selectedIdsArray(), { style })
  if (affected > 0) clearSelection()
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
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="handleToggleSort"
        >
          <ArrowUpDown :size="14" />
          {{ sortLabel }}
        </button>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          @click="toggleDensity"
        >
          <Minimize2 v-if="density === 'comfortable'" :size="14" />
          <Maximize2 v-else :size="14" />
          {{ density === 'comfortable' ? 'Compact' : 'Comfortable' }}
        </button>
        <HighlightsExportMenu :items="items" :book-title="book.title ?? 'Untitled'" label="Export page" />
      </div>
    </HighlightsFilterBar>

    <div
      v-if="total > 0"
      class="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
    >
      <span v-for="item in summaryItems" :key="item" class="font-medium text-foreground">{{ item }}</span>
      <span v-for="origin in originSummary" :key="origin.label" class="rounded border px-2 py-0.5" :class="origin.class">
        {{ origin.label }} {{ origin.count }}
      </span>
    </div>

    <div v-if="hasSelection" class="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
      <span class="font-medium text-foreground">{{ selectedIds.size }} selected</span>
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        @click="selectAllOnPage"
      >
        <CheckSquare :size="13" />
        {{ allVisibleSelected ? 'Page selected' : 'Select page' }}
      </button>
      <button type="button" class="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" @click="clearSelection">
        Clear
      </button>

      <div class="h-5 w-px bg-border" />

      <div class="flex items-center gap-1">
        <Palette :size="13" class="text-muted-foreground" />
        <button
          v-for="color in BULK_COLORS"
          :key="color.hex"
          type="button"
          class="h-6 w-6 rounded-full border border-border transition-transform hover:scale-110"
          :style="{ background: color.hex }"
          :title="color.label"
          @click="() => handleBulkColor(color.hex)"
        />
      </div>

      <div class="flex flex-wrap items-center gap-1">
        <button
          v-for="style in BULK_STYLES"
          :key="style.value"
          type="button"
          class="rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="() => handleBulkStyle(style.value)"
        >
          {{ style.label }}
        </button>
      </div>

      <div class="flex-1" />
      <HighlightsExportMenu :items="selectedItems" :book-title="book.title ?? 'Untitled'" label="Export selected" />
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground transition-colors hover:bg-destructive/90"
        @click="handleBulkTrash"
      >
        <Trash2 :size="14" />
        Trash
      </button>
    </div>

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
            :selected-ids="selectedIds"
            :density="density"
            :saving-ids="savingIds"
            @toggle-select="toggleSelected"
            @jump="handleJump"
            @update-note="handleUpdateNote"
            @update-color="handleUpdateColor"
            @update-style="handleUpdateStyle"
            @trash="handleDelete"
          />
        </template>
        <template v-else>
          <AnnotationListItem
            v-for="h in items"
            :key="h.id"
            :annotation="h"
            :selected="selectedIds.has(h.id)"
            :density="density"
            :saving="savingIds.has(h.id)"
            mode="book"
            @toggle-select="toggleSelected"
            @jump="handleJump"
            @update-note="handleUpdateNote"
            @update-color="handleUpdateColor"
            @update-style="handleUpdateStyle"
            @trash="handleDelete"
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
