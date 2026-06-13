<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Highlighter,
  Maximize2,
  Minimize2,
  Search,
  StickyNote,
  Trash2,
  X,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { ANNOTATION_COLOR_FILTER_OPTIONS, ANNOTATION_HIGHLIGHT_COLORS, type AnnotationHubItem } from '@bookorbit/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import AnnotationCard from '../components/AnnotationCard.vue'
import AnnotationBookGroup from '../components/AnnotationBookGroup.vue'
import { sourcePill } from '../lib/pill-styles'
import { useAnnotationsHub } from '../composables/useAnnotationsHub'

const router = useRouter()
const hub = useAnnotationsHub()

const COLOR_OPTIONS = [
  { value: 'all', label: 'All colors' },
  ...ANNOTATION_COLOR_FILTER_OPTIONS.map((color) => ({ value: color.hex, label: color.label })),
]
const RECOLOR_OPTIONS = ANNOTATION_HIGHLIGHT_COLORS

const STYLE_OPTIONS = [
  { value: 'all', label: 'All styles' },
  { value: 'highlight', label: 'Highlight' },
  { value: 'underline', label: 'Underline' },
  { value: 'strikethrough', label: 'Strikethrough' },
  { value: 'squiggly', label: 'Squiggly' },
  { value: 'invert', label: 'Invert' },
]

const ORIGIN_OPTIONS = [
  { value: 'all', label: 'All sources' },
  { value: 'web', label: 'Web' },
  { value: 'koreader', label: 'KOReader' },
]

const density = ref<'compact' | 'comfortable'>('comfortable')

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

const summaryItems = computed(() => {
  const s = hub.stats.value
  if (!s) return []
  const items: string[] = []
  if (s.books > 0) items.push(`${s.books} ${s.books === 1 ? 'book' : 'books'}`)
  if (s.withNotes > 0) items.push(`${s.withNotes} ${s.withNotes === 1 ? 'note' : 'notes'}`)
  return items
})

const originSummary = computed(() => (hub.stats.value?.originBreakdown ?? []).map((entry) => ({ ...sourcePill(entry.origin), count: entry.count })))

const HEADER_PILL_CLASS = 'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium'

const sortDirLabel = computed(() => {
  if (hub.sortBy.value === 'book') return hub.sortDir.value === 'asc' ? 'A to Z' : 'Z to A'
  return hub.sortDir.value === 'desc' ? 'Newest' : 'Oldest'
})

onMounted(() => {
  void hub.load()
  void hub.loadBooks()
})

function toggleSortDir() {
  hub.sortDir.value = hub.sortDir.value === 'desc' ? 'asc' : 'desc'
}

function toggleDensity() {
  density.value = density.value === 'comfortable' ? 'compact' : 'comfortable'
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
        <template v-if="summaryItems.length > 0 || originSummary.length > 0">
          <span class="hidden h-5 w-px bg-border sm:block" />
          <div class="hidden items-center gap-2.5 text-sm text-muted-foreground sm:flex">
            <span v-for="item in summaryItems" :key="item">{{ item }}</span>
            <span v-if="summaryItems.length > 0 && originSummary.length > 0" class="h-4 w-px bg-border" />
            <span v-for="origin in originSummary" :key="origin.label" :class="[HEADER_PILL_CLASS, origin.class]"
              >{{ origin.label }} {{ origin.count }}</span
            >
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

    <div class="flex flex-wrap items-center gap-2 mb-4">
      <div class="relative flex-1 min-w-[12rem]">
        <Search :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          v-model="hub.search.value"
          type="search"
          placeholder="Search text and notes"
          class="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <select v-model="hub.bookFilter.value" class="h-9 max-w-[14rem] px-2 rounded-md border border-border bg-background text-sm">
        <option :value="'all'">All books</option>
        <option v-for="book in hub.books.value" :key="book.bookId" :value="book.bookId">
          {{ book.bookTitle ?? 'Unknown book' }} ({{ book.count }})
        </option>
      </select>
      <select v-model="hub.colorFilter.value" class="h-9 px-2 rounded-md border border-border bg-background text-sm">
        <option v-for="option in COLOR_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <select v-model="hub.styleFilter.value" class="h-9 px-2 rounded-md border border-border bg-background text-sm">
        <option v-for="option in STYLE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <select v-model="hub.originFilter.value" class="h-9 px-2 rounded-md border border-border bg-background text-sm">
        <option v-for="option in ORIGIN_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
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
      <div class="inline-flex items-center gap-1.5">
        <input
          v-model="hub.dateFrom.value"
          type="date"
          aria-label="From date"
          class="h-9 px-2 rounded-md border border-border bg-background text-sm"
        />
        <span class="text-xs text-muted-foreground">to</span>
        <input v-model="hub.dateTo.value" type="date" aria-label="To date" class="h-9 px-2 rounded-md border border-border bg-background text-sm" />
        <button
          v-if="hub.dateFrom.value || hub.dateTo.value"
          type="button"
          aria-label="Clear date range"
          class="inline-flex h-9 items-center rounded-md border border-border bg-background px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click="hub.clearDates"
        >
          <X :size="13" />
        </button>
      </div>
      <select v-model="hub.sortBy.value" class="h-9 px-2 rounded-md border border-border bg-background text-sm">
        <option value="createdAt">By date</option>
        <option value="book">By book</option>
      </select>
      <button
        type="button"
        class="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="toggleSortDir"
      >
        <ArrowDownUp :size="14" />
        {{ sortDirLabel }}
      </button>
      <button
        type="button"
        class="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="toggleDensity"
      >
        <Minimize2 v-if="density === 'comfortable'" :size="14" />
        <Maximize2 v-else :size="14" />
        {{ density === 'comfortable' ? 'Compact' : 'Comfortable' }}
      </button>
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
    <div v-else-if="hub.items.value.length === 0" class="py-12 text-center text-sm text-muted-foreground">
      {{ hub.status.value === 'trashed' ? 'Trash is empty' : 'No annotations yet. Highlights you create on the web or your e-reader appear here.' }}
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
          :trashed="hub.status.value === 'trashed'"
          :density="density"
          @toggle-select="hub.toggleSelected"
          @jump="handleJump"
          @trash="handleTrash"
          @restore="handleRestore"
          @purge="handlePurge"
        />
      </div>
      <div v-else class="flex flex-col gap-2">
        <AnnotationCard
          v-for="annotation in hub.items.value"
          :key="annotation.id"
          :annotation="annotation"
          :selected="hub.selectedIds.value.has(annotation.id)"
          :trashed="hub.status.value === 'trashed'"
          :density="density"
          @toggleSelect="hub.toggleSelected"
          @jump="handleJump"
          @trash="handleTrash"
          @restore="handleRestore"
          @purge="handlePurge"
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
