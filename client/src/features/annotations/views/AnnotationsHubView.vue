<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Highlighter,
  Maximize2,
  Minimize2,
  RotateCcw,
  Search,
  SlidersHorizontal,
  StickyNote,
  Trash2,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { ANNOTATION_HIGHLIGHT_COLORS, type AnnotationHubItem } from '@bookorbit/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import AnnotationCard from '../components/AnnotationCard.vue'
import AnnotationBookGroup from '../components/AnnotationBookGroup.vue'
import AnnotationBookCombobox from '../components/AnnotationBookCombobox.vue'
import AnnotationFiltersPanel from '../components/AnnotationFiltersPanel.vue'
import AnnotationFilterChips from '../components/AnnotationFilterChips.vue'
import { SORT_OPTIONS } from '../lib/filter-options'
import { sourcePill } from '../lib/pill-styles'
import { useAnnotationsHub } from '../composables/useAnnotationsHub'
import { useAnnotationsUrlSync } from '../composables/useAnnotationsUrlSync'

const router = useRouter()
const hub = useAnnotationsHub()
useAnnotationsUrlSync(hub)

const RECOLOR_OPTIONS = ANNOTATION_HIGHLIGHT_COLORS

const DENSITY_STORAGE_KEY = 'annotations:density'

function readStoredDensity(): 'compact' | 'comfortable' {
  const stored = localStorage.getItem(DENSITY_STORAGE_KEY)
  return stored === 'compact' || stored === 'comfortable' ? stored : 'comfortable'
}

const density = ref<'compact' | 'comfortable'>(readStoredDensity())
watch(density, (value) => localStorage.setItem(DENSITY_STORAGE_KEY, value))

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

const bookCountText = computed(() => {
  const books = hub.stats.value?.books ?? 0
  return books > 0 ? `${books} ${books === 1 ? 'book' : 'books'}` : null
})

const notesCount = computed(() => hub.stats.value?.withNotes ?? 0)

const originSummary = computed(() =>
  (hub.stats.value?.originBreakdown ?? []).map((entry) => ({ origin: entry.origin, ...sourcePill(entry.origin), count: entry.count })),
)

const HEADER_PILL_CLASS = 'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium transition-colors'

onMounted(() => {
  void hub.load()
})

function toggleDensity() {
  density.value = density.value === 'comfortable' ? 'compact' : 'comfortable'
}

function toggleOriginFilter(origin: string) {
  hub.originFilter.value = hub.originFilter.value === origin ? 'all' : origin
}

function bookIdForAnnotation(id: number): number | null {
  return hub.items.value.find((item) => item.id === id)?.bookId ?? null
}

function handleUpdateNote(id: number, note: string | null) {
  const bookId = bookIdForAnnotation(id)
  if (bookId != null) void hub.updateAnnotation(bookId, id, { note })
}

function handleUpdateColor(id: number, color: string) {
  const bookId = bookIdForAnnotation(id)
  if (bookId != null) void hub.updateAnnotation(bookId, id, { color })
}

function handleUpdateStyle(id: number, style: string) {
  const bookId = bookIdForAnnotation(id)
  if (bookId != null) void hub.updateAnnotation(bookId, id, { style })
}

function setActiveTab() {
  hub.status.value = 'active'
}

function setTrashTab() {
  hub.status.value = 'trashed'
}

function firstPage() {
  hub.page.value = 1
}

function previousPage() {
  if (hub.page.value > 1) hub.page.value -= 1
}

function nextPage() {
  if (hub.page.value < hub.totalPages.value) hub.page.value += 1
}

function lastPage() {
  hub.page.value = hub.totalPages.value
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
        <template v-if="bookCountText || notesCount > 0 || originSummary.length > 0">
          <span class="hidden h-5 w-px bg-border sm:block" />
          <div class="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
            <span v-if="bookCountText">{{ bookCountText }}</span>
            <button
              v-if="notesCount > 0"
              type="button"
              :aria-pressed="hub.notesOnly.value"
              :class="[
                HEADER_PILL_CLASS,
                hub.notesOnly.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
              ]"
              @click="hub.toggleNotesOnly"
            >
              {{ notesCount }} {{ notesCount === 1 ? 'note' : 'notes' }}
            </button>
            <span v-if="(bookCountText || notesCount > 0) && originSummary.length > 0" class="h-4 w-px bg-border" />
            <button
              v-for="origin in originSummary"
              :key="origin.origin"
              type="button"
              :aria-pressed="hub.originFilter.value === origin.origin"
              :class="[HEADER_PILL_CLASS, origin.class, hub.originFilter.value === origin.origin ? 'ring-1 ring-primary' : 'hover:opacity-80']"
              @click="toggleOriginFilter(origin.origin)"
            >
              {{ origin.label }} {{ origin.count }}
            </button>
          </div>
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

    <div class="flex flex-col gap-3 mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="relative w-full sm:w-auto sm:flex-1 sm:min-w-[14rem]">
          <Search :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            v-model="hub.search.value"
            type="search"
            placeholder="Search text and notes"
            class="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
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

        <div class="hidden sm:block">
          <Popover>
            <PopoverTrigger as-child>
              <Button variant="outline" size="sm" class="gap-1.5">
                <SlidersHorizontal :size="14" />
                Filters
                <Badge v-if="hub.popoverFilterCount.value > 0" variant="secondary" class="ml-0.5 h-5 min-w-5 justify-center px-1">
                  {{ hub.popoverFilterCount.value }}
                </Badge>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" class="w-80">
              <AnnotationFiltersPanel
                v-model:color="hub.colorFilter.value"
                v-model:highlight-style="hub.styleFilter.value"
                v-model:origin="hub.originFilter.value"
                v-model:date-from="hub.dateFrom.value"
                v-model:date-to="hub.dateTo.value"
                @clear-all="hub.clearPopoverFilters"
              />
            </PopoverContent>
          </Popover>
        </div>

        <div class="sm:hidden">
          <Sheet>
            <SheetTrigger as-child>
              <Button variant="outline" size="sm" class="gap-1.5">
                <SlidersHorizontal :size="14" />
                Filters
                <Badge v-if="hub.popoverFilterCount.value > 0" variant="secondary" class="ml-0.5 h-5 min-w-5 justify-center px-1">
                  {{ hub.popoverFilterCount.value }}
                </Badge>
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" class="max-h-[85vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
              </SheetHeader>
              <div class="px-4 pb-6">
                <AnnotationFiltersPanel
                  v-model:color="hub.colorFilter.value"
                  v-model:highlight-style="hub.styleFilter.value"
                  v-model:origin="hub.originFilter.value"
                  v-model:date-from="hub.dateFrom.value"
                  v-model:date-to="hub.dateTo.value"
                  @clear-all="hub.clearPopoverFilters"
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        <select v-model="hub.sortKey.value" aria-label="Sort order" class="h-9 px-2 rounded-md border border-border bg-background text-sm">
          <option v-for="option in SORT_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
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

      <AnnotationFilterChips
        v-if="hub.activeFilterChips.value.length > 0"
        :chips="hub.activeFilterChips.value"
        @remove="hub.removeFilterChip"
        @clear-all="hub.clearPopoverFilters"
      />
    </div>

    <div
      v-if="hub.hasSelection.value"
      class="flex flex-wrap items-center gap-2 mb-4 px-3 py-2 rounded-md border border-primary/40 bg-primary/5 text-sm"
    >
      <span class="font-medium text-foreground">{{ hub.selectedIds.value.size }} selected</span>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="hub.selectAllOnPage"
      >
        Select page
      </button>
      <button
        type="button"
        class="rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="hub.clearSelection"
      >
        Clear
      </button>
      <div class="flex-1" />
      <template v-if="hub.status.value === 'active'">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" size="sm">Recolor</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem v-for="option in RECOLOR_OPTIONS" :key="option.hex" @click="handleBulkRecolor(option.hex)">
              <span class="w-3 h-3 rounded-full mr-2" :style="{ background: option.hex }" />
              {{ option.label }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="destructive" size="sm" class="gap-1.5" @click="handleBulkTrash">
          <Trash2 :size="13" />
          Trash
        </Button>
      </template>
      <Button v-else variant="outline" size="sm" @click="handleBulkRestore">Restore</Button>
    </div>

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
          @update-note="handleUpdateNote"
          @update-color="handleUpdateColor"
          @update-style="handleUpdateStyle"
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
          @update-note="handleUpdateNote"
          @update-color="handleUpdateColor"
          @update-style="handleUpdateStyle"
        />
      </div>
    </div>

    <div v-if="hub.total.value > 0" class="mt-6 flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>Showing {{ hub.rangeStart.value }}-{{ hub.rangeEnd.value }} of {{ hub.total.value }}</span>
      <div v-if="hub.totalPages.value > 1" class="flex items-center gap-1.5">
        <Button variant="outline" size="icon-sm" :disabled="hub.page.value <= 1" aria-label="First page" @click="firstPage">
          <ChevronsLeft :size="14" />
        </Button>
        <Button variant="outline" size="icon-sm" :disabled="hub.page.value <= 1" aria-label="Previous page" @click="previousPage">
          <ChevronLeft :size="14" />
        </Button>
        <span class="px-1">Page {{ hub.page.value }} of {{ hub.totalPages.value }}</span>
        <Button variant="outline" size="icon-sm" :disabled="hub.page.value >= hub.totalPages.value" aria-label="Next page" @click="nextPage">
          <ChevronRight :size="14" />
        </Button>
        <Button variant="outline" size="icon-sm" :disabled="hub.page.value >= hub.totalPages.value" aria-label="Last page" @click="lastPage">
          <ChevronsRight :size="14" />
        </Button>
      </div>
    </div>
  </div>
</template>
