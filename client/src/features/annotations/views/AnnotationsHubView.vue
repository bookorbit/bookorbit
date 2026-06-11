<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ChevronLeft, ChevronRight, Download, Highlighter, Search, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { ANNOTATION_COLOR_FILTER_OPTIONS, ANNOTATION_HIGHLIGHT_COLORS, type AnnotationHubItem } from '@bookorbit/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import AnnotationCard from '../components/AnnotationCard.vue'
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

onMounted(() => {
  void hub.load()
})

function setActiveTab() {
  hub.status.value = 'active'
}

function setTrashTab() {
  hub.status.value = 'trashed'
}

function previousPage() {
  if (hub.page.value > 1) hub.page.value -= 1
}

function nextPage() {
  if (hub.page.value < hub.totalPages.value) hub.page.value += 1
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
  <div class="max-w-4xl mx-auto px-4 py-6">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-5">
      <div class="flex items-center gap-2">
        <Highlighter :size="22" class="text-primary" />
        <h1 class="text-xl font-semibold">Annotations</h1>
        <span class="text-sm text-muted-foreground">{{ hub.total.value }} total</span>
      </div>
      <div class="flex items-center gap-2">
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
      <select v-model="hub.colorFilter.value" class="h-9 px-2 rounded-md border border-border bg-background text-sm">
        <option v-for="option in COLOR_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <select v-model="hub.styleFilter.value" class="h-9 px-2 rounded-md border border-border bg-background text-sm">
        <option v-for="option in STYLE_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <select v-model="hub.originFilter.value" class="h-9 px-2 rounded-md border border-border bg-background text-sm">
        <option v-for="option in ORIGIN_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <select v-model="hub.sortBy.value" class="h-9 px-2 rounded-md border border-border bg-background text-sm">
        <option value="createdAt">By date</option>
        <option value="book">By book</option>
      </select>
    </div>

    <div
      v-if="hub.hasSelection.value"
      class="flex flex-wrap items-center gap-2 mb-4 px-3 py-2 rounded-md border border-primary/40 bg-primary/5 text-sm"
    >
      <span>{{ hub.selectedIds.value.size }} selected</span>
      <Button variant="ghost" size="sm" @click="hub.selectAllOnPage">Select page</Button>
      <Button variant="ghost" size="sm" @click="hub.clearSelection">Clear</Button>
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

    <div v-if="hub.loading.value" class="py-12 text-center text-sm text-muted-foreground">Loading annotations…</div>
    <div v-else-if="hub.error.value" class="py-12 text-center text-sm text-destructive">{{ hub.error.value }}</div>
    <div v-else-if="hub.items.value.length === 0" class="py-12 text-center text-sm text-muted-foreground">
      {{ hub.status.value === 'trashed' ? 'Trash is empty' : 'No annotations yet. Highlights you create on the web or your e-reader appear here.' }}
    </div>
    <div v-else class="flex flex-col gap-2">
      <AnnotationCard
        v-for="annotation in hub.items.value"
        :key="annotation.id"
        :annotation="annotation"
        :selected="hub.selectedIds.value.has(annotation.id)"
        :trashed="hub.status.value === 'trashed'"
        @toggleSelect="hub.toggleSelected"
        @jump="handleJump"
        @trash="handleTrash"
        @restore="handleRestore"
        @purge="handlePurge"
      />
    </div>

    <div v-if="hub.totalPages.value > 1" class="flex items-center justify-center gap-3 mt-6">
      <Button variant="outline" size="sm" :disabled="hub.page.value <= 1" @click="previousPage">
        <ChevronLeft :size="14" />
      </Button>
      <span class="text-sm text-muted-foreground">Page {{ hub.page.value }} of {{ hub.totalPages.value }}</span>
      <Button variant="outline" size="sm" :disabled="hub.page.value >= hub.totalPages.value" @click="nextPage">
        <ChevronRight :size="14" />
      </Button>
    </div>
  </div>
</template>
