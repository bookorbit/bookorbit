<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Download, Highlighter, RotateCcw, StickyNote, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { AnnotationHubItem } from '@bookorbit/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import AnnotationCard from '../components/AnnotationCard.vue'
import AnnotationBookGroup from '../components/AnnotationBookGroup.vue'
import AnnotationBookCombobox from '../components/AnnotationBookCombobox.vue'
import AnnotationToolbar from '../components/AnnotationToolbar.vue'
import AnnotationFiltersPanel from '../components/AnnotationFiltersPanel.vue'
import AnnotationSummaryBar from '../components/AnnotationSummaryBar.vue'
import AnnotationBulkBar from '../components/AnnotationBulkBar.vue'
import AnnotationPagination from '../components/AnnotationPagination.vue'
import { ORIGIN_OPTIONS, SORT_OPTIONS, STYLE_OPTIONS } from '../lib/filter-options'
import { sourcePill } from '../lib/pill-styles'
import { useAnnotationsHub } from '../composables/useAnnotationsHub'
import { useAnnotationsUrlSync } from '../composables/useAnnotationsUrlSync'
import { useDensity } from '../composables/useDensity'

const router = useRouter()
const hub = useAnnotationsHub()
useAnnotationsUrlSync(hub)
const { density } = useDensity()

const SELECT_CLASS = 'h-9 w-full px-2 rounded-md border border-border bg-background text-sm'
const FIELD_LABEL_CLASS = 'flex flex-col gap-1.5 text-xs font-medium text-muted-foreground'

const isGrouped = computed(() => hub.sortBy.value === 'book')

const groupedByBook = computed(() => {
  const groups: { bookId: number; bookTitle: string; author: string | null; items: AnnotationHubItem[] }[] = []
  let current: (typeof groups)[number] | null = null
  for (const item of hub.items.value) {
    if (!current || current.bookId !== item.bookId) {
      current = { bookId: item.bookId, bookTitle: item.bookTitle ?? 'Unknown book', author: item.author, items: [] }
      groups.push(current)
    }
    current.items.push(item)
  }
  return groups
})

const summaryTexts = computed(() => {
  const stats = hub.stats.value
  if (!stats) return []
  const texts: string[] = []
  if (stats.books > 0) texts.push(`${stats.books} ${stats.books === 1 ? 'book' : 'books'}`)
  if (stats.withNotes > 0) texts.push(`${stats.withNotes} ${stats.withNotes === 1 ? 'note' : 'notes'}`)
  return texts
})

const originSummary = computed(() =>
  (hub.stats.value?.originBreakdown ?? [])
    .filter((entry) => entry.count > 0)
    .map((entry) => ({ origin: entry.origin, ...sourcePill(entry.origin), count: entry.count })),
)

onMounted(() => {
  void hub.load()
})

function setActiveTab() {
  hub.status.value = 'active'
}

function setTrashTab() {
  hub.status.value = 'trashed'
}

function toggleOriginFilter(origin: string) {
  hub.originFilter.value = hub.originFilter.value === origin ? 'all' : origin
}

function handleSetPage(page: number) {
  hub.page.value = page
}

function handleJump(annotation: AnnotationHubItem) {
  if (!annotation.jumpFileId) return
  const query: Record<string, string> = {}
  if (annotation.cfi) query.cfi = annotation.cfi
  else if (annotation.pageno != null) query.page = String(annotation.pageno)
  void router.push({ name: 'reader', params: { bookId: annotation.bookId, fileId: annotation.jumpFileId }, query })
}

async function handleTrash(id: number) {
  hub.selectedIds.value = new Set([id])
  const affected = await hub.bulk('trash')
  if (affected > 0) toast.success('Moved to trash')
}

async function handleRestore(id: number) {
  const ok = await hub.restore(id)
  if (ok) toast.success('Annotation restored')
}

async function handlePurge(id: number) {
  const result = await hub.purge(id)
  if (result.ok) toast.success('Annotation deleted forever')
  else toast.error(result.message ?? 'Failed to delete')
}

async function handleBulkTrash() {
  const affected = await hub.bulk('trash')
  if (affected > 0) toast.success(`Moved ${affected} annotation(s) to trash`)
}

async function handleBulkRestore() {
  const affected = await hub.bulk('restore')
  if (affected > 0) toast.success(`Restored ${affected} annotation(s)`)
}

async function handleBulkRecolor(color: string) {
  const affected = await hub.bulk('restyle', { color })
  if (affected > 0) toast.success(`Recolored ${affected} annotation(s)`)
}

async function handleBulkRestyle(style: string) {
  const affected = await hub.bulk('restyle', { style })
  if (affected > 0) toast.success(`Restyled ${affected} annotation(s)`)
}

function handleExport(format: 'md' | 'csv' | 'json') {
  window.open(hub.exportUrl(format), '_blank')
}

function handleExportMarkdown() {
  handleExport('md')
}

function handleExportCsv() {
  handleExport('csv')
}

function handleExportJson() {
  handleExport('json')
}
</script>

<template>
  <div class="w-full max-w-8xl py-4 sm:py-6">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div class="flex flex-wrap items-center gap-2.5">
        <Highlighter :size="22" class="text-primary" />
        <h1 class="text-xl font-semibold">Annotations</h1>
        <span class="text-sm text-muted-foreground">{{ hub.total.value }} total</span>
        <template v-if="summaryTexts.length > 0 || originSummary.length > 0">
          <span class="hidden h-5 w-px bg-border sm:block" />
          <AnnotationSummaryBar
            class="hidden sm:flex"
            :texts="summaryTexts"
            :origins="originSummary"
            :active-origin="hub.originFilter.value"
            @origin-click="toggleOriginFilter"
          />
        </template>
      </div>
      <div class="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" size="sm" class="gap-1.5">
              <Download :size="14" />
              Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem @click="handleExportMarkdown">Markdown</DropdownMenuItem>
            <DropdownMenuItem @click="handleExportCsv">CSV</DropdownMenuItem>
            <DropdownMenuItem @click="handleExportJson">JSON</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <div class="flex items-center gap-1 border-b border-border mb-4">
      <button
        type="button"
        class="px-3 py-2 text-sm transition-colors border-b-2 -mb-px"
        :class="hub.status.value === 'active' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'"
        @click="setActiveTab"
      >
        Highlights
      </button>
      <button
        type="button"
        class="px-3 py-2 text-sm transition-colors border-b-2 -mb-px inline-flex items-center gap-1.5"
        :class="hub.status.value === 'trashed' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'"
        @click="setTrashTab"
      >
        <Trash2 :size="13" />
        Trash
      </button>
    </div>

    <AnnotationToolbar
      v-model:search="hub.search.value"
      v-model:sort-key="hub.sortKey.value"
      v-model:density="density"
      class="mb-4"
      :sort-options="SORT_OPTIONS"
      :filter-count="hub.popoverFilterCount.value"
      :chips="hub.activeFilterChips.value"
      @remove-chip="hub.removeFilterChip"
      @clear-filters="hub.clearPopoverFilters"
    >
      <template #inline-filters>
        <AnnotationBookCombobox v-model="hub.bookFilter.value" v-model:selected-label="hub.selectedBookLabel.value" :search-fn="hub.searchBooks" />
        <button
          type="button"
          :aria-pressed="hub.notesOnly.value"
          class="inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors"
          :class="
            hub.notesOnly.value
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground'
          "
          @click="hub.toggleNotesOnly"
        >
          <StickyNote :size="14" />
          Notes only
        </button>
      </template>
      <template #filters>
        <AnnotationFiltersPanel
          v-model:colors="hub.colors.value"
          v-model:date-from="hub.dateFrom.value"
          v-model:date-to="hub.dateTo.value"
          @clear-all="hub.clearPopoverFilters"
        >
          <template #extra>
            <label :class="FIELD_LABEL_CLASS">
              Style
              <select v-model="hub.styleFilter.value" :class="SELECT_CLASS">
                <option v-for="option in STYLE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label :class="FIELD_LABEL_CLASS">
              Source
              <select v-model="hub.originFilter.value" :class="SELECT_CLASS">
                <option v-for="option in ORIGIN_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
          </template>
        </AnnotationFiltersPanel>
      </template>
    </AnnotationToolbar>

    <AnnotationBulkBar
      v-if="hub.hasSelection.value"
      class="mb-4"
      :count="hub.selectedIds.value.size"
      :all-visible-selected="hub.allVisibleSelected.value"
      :show-restyle="hub.status.value === 'active'"
      @select-page="hub.selectAllOnPage"
      @clear="hub.clearSelection"
      @recolor="handleBulkRecolor"
      @restyle="handleBulkRestyle"
    >
      <template #trailing>
        <Button v-if="hub.status.value === 'active'" variant="destructive" size="sm" class="gap-1.5" @click="handleBulkTrash">
          <Trash2 :size="13" />
          Trash
        </Button>
        <Button v-else variant="outline" size="sm" @click="handleBulkRestore">Restore</Button>
      </template>
    </AnnotationBulkBar>

    <div v-if="hub.loading.value && hub.items.value.length === 0" class="flex flex-col gap-2">
      <div v-for="i in 6" :key="i" class="h-24 rounded-lg bg-muted animate-shimmer" />
    </div>
    <div v-else-if="hub.error.value" class="py-12 text-center text-sm text-destructive">{{ hub.error.value }}</div>
    <div v-else-if="hub.items.value.length === 0" class="py-12 text-center">
      <template v-if="hub.hasActiveFilters.value">
        <p class="text-sm text-muted-foreground">No highlights match your filters.</p>
        <button
          type="button"
          class="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
          @click="hub.resetAllFilters"
        >
          <RotateCcw :size="14" />
          Reset filters
        </button>
      </template>
      <p v-else class="text-sm text-muted-foreground">
        {{ hub.status.value === 'trashed' ? 'Trash is empty' : 'No annotations yet. Highlights you create on the web or your e-reader appear here.' }}
      </p>
    </div>
    <div v-else class="transition-opacity" :class="{ 'opacity-50 pointer-events-none': hub.loading.value }">
      <div v-if="isGrouped" class="flex flex-col gap-4">
        <AnnotationBookGroup
          v-for="group in groupedByBook"
          :key="group.bookId"
          :book-id="group.bookId"
          :book-title="group.bookTitle"
          :author="group.author"
          :items="group.items"
          :selected-ids="hub.selectedIds.value"
          :saving-ids="hub.savingIds.value"
          :trashed="hub.status.value === 'trashed'"
          :density="density"
          @toggle-select="hub.toggleSelected"
          @jump="handleJump"
          @trash="handleTrash"
          @restore="handleRestore"
          @purge="handlePurge"
          @update-note="hub.updateNote"
          @update-color="hub.updateColor"
          @update-style="hub.updateStyle"
        />
      </div>
      <div v-else class="flex flex-col gap-2">
        <AnnotationCard
          v-for="annotation in hub.items.value"
          :key="annotation.id"
          :annotation="annotation"
          :selected="hub.selectedIds.value.has(annotation.id)"
          :saving="hub.savingIds.value.has(annotation.id)"
          :trashed="hub.status.value === 'trashed'"
          :density="density"
          @toggleSelect="hub.toggleSelected"
          @jump="handleJump"
          @trash="handleTrash"
          @restore="handleRestore"
          @purge="handlePurge"
          @update-note="hub.updateNote"
          @update-color="hub.updateColor"
          @update-style="hub.updateStyle"
        />
      </div>
    </div>

    <AnnotationPagination
      v-if="hub.total.value > 0"
      :page="hub.page.value"
      :total-pages="hub.totalPages.value"
      :range-start="hub.rangeStart.value"
      :range-end="hub.rangeEnd.value"
      :total="hub.total.value"
      @update:page="handleSetPage"
    />
  </div>
</template>
