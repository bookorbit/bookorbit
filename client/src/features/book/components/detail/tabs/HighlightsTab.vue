<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { Highlighter, RotateCcw, Trash2 } from '@lucide/vue'
import type { AnnotationItem, BookDetail } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import AnnotationListItem from '@/features/annotations/components/AnnotationListItem.vue'
import AnnotationToolbar from '@/features/annotations/components/AnnotationToolbar.vue'
import AnnotationFiltersPanel from '@/features/annotations/components/AnnotationFiltersPanel.vue'
import AnnotationSummaryBar from '@/features/annotations/components/AnnotationSummaryBar.vue'
import AnnotationBulkBar from '@/features/annotations/components/AnnotationBulkBar.vue'
import AnnotationPagination from '@/features/annotations/components/AnnotationPagination.vue'
import { sourcePill } from '@/features/annotations/lib/pill-styles'
import { useBookHighlights } from '@/features/book/composables/useBookHighlights'
import { useDensity } from '@/features/annotations/composables/useDensity'
import HighlightChapterGroup from './HighlightChapterGroup.vue'
import HighlightsExportMenu from './HighlightsExportMenu.vue'

const props = defineProps<{ book: BookDetail }>()

const router = useRouter()
const bookIdRef = computed(() => props.book.id)
const hl = useBookHighlights(bookIdRef)
const { density } = useDensity()

const SORT_OPTIONS = [
  { value: 'position', label: 'Position' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
]

const groupedHighlights = computed(() => {
  const groups = new Map<string, AnnotationItem[]>()
  for (const item of hl.items.value) {
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

const summaryTexts = computed(() => {
  const texts = [`${hl.total.value} ${hl.total.value === 1 ? 'highlight' : 'highlights'}`]
  if (hl.stats.value) {
    texts.push(`${hl.stats.value.highlightsWithNotes} notes`)
    texts.push(`${hl.stats.value.chaptersWithHighlights} chapters`)
  }
  return texts
})

const originSummary = computed(() =>
  (hl.stats.value?.originBreakdown ?? [])
    .filter((entry) => entry.count > 0)
    .map((entry) => ({ origin: entry.origin, ...sourcePill(entry.origin), count: entry.count })),
)

function handleJump(annotation: AnnotationItem) {
  if (!annotation.jumpFileId) return
  const query: Record<string, string> = {}
  const file = props.book.files.find((bookFile) => bookFile.id === annotation.jumpFileId)
  if (file?.format) query.format = file.format
  if (annotation.cfi) query.cfi = annotation.cfi
  else if (annotation.pageno != null) query.page = String(annotation.pageno)
  void router.push({ name: 'reader', params: { bookId: annotation.bookId, fileId: annotation.jumpFileId }, query })
}

function handleSetPage(page: number) {
  hl.page.value = page
}

async function handleDelete(id: number) {
  await hl.deleteHighlight(id)
}

async function handleBulkColor(color: string) {
  const affected = await hl.bulkRestyle([...hl.selectedIds.value], { color })
  if (affected > 0) hl.clearSelection()
}

async function handleBulkStyle(style: string) {
  const affected = await hl.bulkRestyle([...hl.selectedIds.value], { style })
  if (affected > 0) hl.clearSelection()
}

async function handleBulkTrash() {
  const affected = await hl.bulkTrash([...hl.selectedIds.value])
  if (affected > 0) hl.clearSelection()
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="hl.error.value" class="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {{ hl.error.value }}
    </div>

    <AnnotationToolbar
      v-model:search="hl.search.value"
      v-model:sort-key="hl.sortKey.value"
      v-model:density="density"
      :sort-options="SORT_OPTIONS"
      :filter-count="hl.popoverFilterCount.value"
      :chips="hl.activeFilterChips.value"
      @remove-chip="hl.removeFilterChip"
      @clear-filters="hl.clearPopoverFilters"
    >
      <template #inline-filters>
        <select
          v-if="hl.chapters.value.length > 0"
          v-model="hl.chapter.value"
          aria-label="Filter by chapter"
          class="h-9 max-w-[14rem] px-2 rounded-md border border-border bg-background text-sm"
        >
          <option value="">All chapters</option>
          <option v-for="ch in hl.chapters.value" :key="ch" :value="ch">{{ ch }}</option>
        </select>
      </template>
      <template #filters>
        <AnnotationFiltersPanel
          v-model:colors="hl.colors.value"
          v-model:date-from="hl.dateFrom.value"
          v-model:date-to="hl.dateTo.value"
          @clear-all="hl.clearPopoverFilters"
        />
      </template>
    </AnnotationToolbar>

    <div v-if="hl.total.value > 0" class="flex flex-wrap items-center justify-between gap-2">
      <AnnotationSummaryBar :texts="summaryTexts" :origins="originSummary" />
      <HighlightsExportMenu :items="hl.items.value" :book-title="book.title ?? 'Untitled'" label="Export page" />
    </div>

    <AnnotationBulkBar
      v-if="hl.hasSelection.value"
      :count="hl.selectedIds.value.size"
      :all-visible-selected="hl.allVisibleSelected.value"
      show-restyle
      @select-page="hl.selectAllOnPage"
      @clear="hl.clearSelection"
      @recolor="handleBulkColor"
      @restyle="handleBulkStyle"
    >
      <template #trailing>
        <HighlightsExportMenu :items="hl.selectedItems.value" :book-title="book.title ?? 'Untitled'" label="Export selected" />
        <Button variant="destructive" size="sm" class="gap-1.5" @click="handleBulkTrash">
          <Trash2 :size="14" />
          Trash
        </Button>
      </template>
    </AnnotationBulkBar>

    <div class="transition-opacity" :class="{ 'opacity-50 pointer-events-none': hl.loading.value && hl.items.value.length > 0 }">
      <div v-if="hl.items.value.length === 0 && !hl.loading.value" class="flex flex-col items-center justify-center py-16 gap-3">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Highlighter :size="20" class="text-muted-foreground/60" />
        </div>
        <template v-if="hl.hasActiveFilters.value">
          <p class="text-sm text-muted-foreground">No highlights match your filters.</p>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
            @click="hl.resetAllFilters"
          >
            <RotateCcw :size="14" />
            Reset filters
          </button>
        </template>
        <template v-else>
          <p class="text-sm text-muted-foreground">No highlights yet</p>
          <p class="text-xs text-muted-foreground/70">Select text while reading to create highlights</p>
        </template>
      </div>

      <div v-else class="space-y-4">
        <template v-if="hasChapterGroups">
          <HighlightChapterGroup
            v-for="[chapterTitle, highlights] in groupedHighlights"
            :key="chapterTitle"
            :chapter-title="chapterTitle || 'Uncategorized'"
            :highlights="highlights"
            :selected-ids="hl.selectedIds.value"
            :density="density"
            :saving-ids="hl.savingIds.value"
            @toggle-select="hl.toggleSelected"
            @jump="handleJump"
            @update-note="hl.updateNote"
            @update-color="hl.updateColor"
            @update-style="hl.updateStyle"
            @trash="handleDelete"
          />
        </template>
        <template v-else>
          <AnnotationListItem
            v-for="h in hl.items.value"
            :key="h.id"
            :annotation="h"
            :selected="hl.selectedIds.value.has(h.id)"
            :density="density"
            :saving="hl.savingIds.value.has(h.id)"
            mode="book"
            @toggle-select="hl.toggleSelected"
            @jump="handleJump"
            @update-note="hl.updateNote"
            @update-color="hl.updateColor"
            @update-style="hl.updateStyle"
            @trash="handleDelete"
          />
        </template>
      </div>
    </div>

    <AnnotationPagination
      v-if="hl.total.value > 0"
      :page="hl.page.value"
      :total-pages="hl.totalPages.value"
      :range-start="hl.rangeStart.value"
      :range-end="hl.rangeEnd.value"
      :total="hl.total.value"
      unit="highlights"
      @update:page="handleSetPage"
    />
  </div>
</template>
