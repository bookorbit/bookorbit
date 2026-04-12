<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, Download, Files, Headphones, History, FolderOpen, ArrowUpDown, MoreVertical } from 'lucide-vue-next'
import type { BookDetail, BookDetailFile, WriteLogEntry } from '@projectx/types'
import { READER_OPENABLE_FORMATS } from '@projectx/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { api } from '@/lib/api'
import { useBookDownload } from '@/features/book/composables/useBookDownload'
import { getFormatColor } from '@/features/book/lib/format-colors'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const props = defineProps<{ book: BookDetail }>()
const router = useRouter()

const { downloadFile: downloadBookFile } = useBookDownload()
const { hasPermission } = usePermissions()

const AUDIO_FORMATS = new Set(['m4b', 'm4a', 'mp3', 'opus', 'ogg', 'flac'])

function isAudioFile(file: BookDetailFile): boolean {
  return !!file.format && AUDIO_FORMATS.has(file.format.toLowerCase())
}

const audioTrackIndex = computed(() => {
  const map = new Map<number, number>()
  let track = 1
  for (const file of props.book.files) {
    if (isAudioFile(file)) {
      map.set(file.id, track++)
    }
  }
  return map
})

const audioTrackCount = computed(() => audioTrackIndex.value.size)

type SortKey = 'name' | 'format' | 'size' | 'date'
type SortDir = 'asc' | 'desc'

const sortKey = ref<SortKey>('name')
const sortDir = ref<SortDir>('asc')

function toggleSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'asc'
  }
}

const sortedFiles = computed(() => {
  const files = [...props.book.files]
  const dir = sortDir.value === 'asc' ? 1 : -1
  return files.sort((a, b) => {
    switch (sortKey.value) {
      case 'name':
        return dir * (a.filename ?? '').localeCompare(b.filename ?? '')
      case 'format':
        return dir * (a.format ?? '').localeCompare(b.format ?? '')
      case 'size':
        return dir * ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0))
      case 'date':
        return dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    }
  })
})

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function openFile(file: BookDetailFile) {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: { format: file.format ?? 'epub' },
  })
}

function downloadFile(file: BookDetailFile) {
  void downloadBookFile(file.id)
}

function fileIconStyle(format: string | null): Record<string, string> {
  const color = getFormatColor(format)
  return {
    backgroundColor: `${color}35`,
    color,
  }
}

const showPaths = ref(false)
const writeLogOpen = ref(false)
const writeLog = ref<WriteLogEntry[]>([])
const writeLogLoading = ref(false)

watch(
  () => props.book.id,
  () => {
    writeLogOpen.value = false
    writeLog.value = []
  },
)

async function toggleWriteLog() {
  if (writeLogOpen.value) {
    writeLogOpen.value = false
    return
  }
  writeLogOpen.value = true
  if (writeLog.value.length > 0) return
  writeLogLoading.value = true
  try {
    const res = await api(`/api/v1/books/${props.book.id}/write-log`)
    if (res.ok) {
      const data: { entries: WriteLogEntry[] } = await res.json()
      writeLog.value = data.entries
    }
  } finally {
    writeLogLoading.value = false
  }
}
</script>

<template>
  <div class="max-w-8xl space-y-3">
    <!-- header strip -->
    <div
      class="sticky top-0 z-20 -mx-4 border-b border-border/70 bg-card/95 px-4 pb-3 pt-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] backdrop-blur supports-[backdrop-filter]:bg-card/85 sm:static sm:mx-0 sm:border-b-0 sm:bg-transparent sm:px-0 sm:py-1 sm:backdrop-blur-none"
    >
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p v-if="book.lastWrittenAt" class="text-sm md:text-xs font-medium text-muted-foreground/90 truncate">
          Last synced: {{ formatRelative(book.lastWrittenAt) }}
        </p>
        <span v-else class="hidden sm:inline" />
        <div class="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1 -mb-1 sm:overflow-visible sm:pb-0 sm:mb-0">
          <div class="flex items-center gap-1.5 whitespace-nowrap">
            <ArrowUpDown class="size-4 md:size-3 text-muted-foreground" />
            <span class="text-sm md:text-xs font-medium text-muted-foreground">Sort:</span>
            <button
              v-for="opt in [
                ['name', 'Name'],
                ['format', 'Format'],
                ['size', 'Size'],
                ['date', 'Date'],
              ] as [SortKey, string][]"
              :key="opt[0]"
              class="h-8 md:h-6 px-2.5 md:px-1.5 rounded-md md:rounded text-sm md:text-xs transition-colors whitespace-nowrap"
              :class="sortKey === opt[0] ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground'"
              @click="toggleSort(opt[0])"
            >
              {{ opt[1] }}{{ sortKey === opt[0] ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '' }}
            </button>
          </div>
          <button
            class="flex items-center gap-1.5 h-8 md:h-auto px-2 md:px-0 rounded-md md:rounded-none text-sm md:text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70 md:hover:bg-transparent transition-colors whitespace-nowrap"
            @click="showPaths = !showPaths"
          >
            <FolderOpen class="size-4 md:size-3" />
            {{ showPaths ? 'Hide paths' : 'Show paths' }}
          </button>
          <button
            v-if="book.lastWrittenAt"
            class="flex items-center gap-1.5 h-8 md:h-auto px-2 md:px-0 rounded-md md:rounded-none text-sm md:text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/70 md:hover:bg-transparent transition-colors whitespace-nowrap"
            @click="toggleWriteLog"
          >
            <History class="size-4 md:size-3" />
            {{ writeLogOpen ? 'Hide log' : 'View sync log' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Inline sync log -->
    <div v-if="writeLogOpen" class="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-1.5">
      <p v-if="writeLogLoading" class="text-sm md:text-xs text-muted-foreground">Loading...</p>
      <p v-else-if="writeLog.length === 0" class="text-sm md:text-xs text-muted-foreground">No write history yet.</p>
      <div v-for="entry in writeLog" :key="entry.id" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm md:text-xs">
        <span
          class="shrink-0 font-medium"
          :class="{
            'text-green-600 dark:text-green-400': entry.status === 'success',
            'text-destructive': entry.status === 'failed',
            'text-muted-foreground': entry.status === 'skipped',
          }"
          >{{ entry.status }}</span
        >
        <span class="text-muted-foreground/90">{{ formatRelative(entry.writtenAt) }}</span>
        <span class="text-muted-foreground font-mono uppercase">{{ entry.format }}</span>
        <span v-if="entry.status === 'failed' && entry.errorMessage" class="min-w-0 flex-1 basis-full sm:basis-auto text-destructive truncate">{{
          entry.errorMessage
        }}</span>
        <span v-else-if="entry.fieldsWritten.length" class="min-w-0 flex-1 basis-full sm:basis-auto text-muted-foreground truncate"
          >{{ entry.fieldsWritten.length }} fields</span
        >
      </div>
    </div>

    <!-- File list -->
    <div
      v-for="file in sortedFiles"
      :key="file.id"
      class="min-h-14 flex items-center gap-3 md:gap-4 px-4 py-3 md:py-2.5 rounded-xl md:rounded-lg bg-card/90 border border-border/80 hover:bg-muted/30 transition-colors"
    >
      <div
        class="relative shrink-0 w-10 h-12 flex items-end justify-center pb-1.5"
        :style="fileIconStyle(file.format)"
        style="clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 0 100%); border-radius: 3px 0 3px 3px"
      >
        <!-- corner fold — clipped to a triangle by the parent clip-path -->
        <div class="absolute top-0 right-0 w-[9px] h-[9px] bg-current opacity-25"></div>
        <!-- document lines -->
        <div class="absolute left-1.5 right-1.5 top-3.5 flex flex-col gap-[3px]">
          <div class="h-px bg-current opacity-20 rounded-full"></div>
          <div class="h-px bg-current opacity-20 rounded-full w-3/4"></div>
          <div class="h-px bg-current opacity-20 rounded-full w-1/2"></div>
        </div>
        <span class="text-[9px] font-bold uppercase tracking-wide leading-none">
          {{ file.format ?? '?' }}
        </span>
      </div>

      <div class="min-w-0 flex-1">
        <p class="text-base md:text-sm leading-tight font-semibold md:font-medium truncate text-foreground/90">{{ file.filename ?? '-' }}</p>
        <p v-if="showPaths" class="text-xs md:text-[11px] font-mono text-muted-foreground/90 truncate mt-1">
          {{ file.absolutePath }}
        </p>
        <p class="text-sm md:text-xs text-muted-foreground/90 mt-1.5">
          {{ formatBytes(file.sizeBytes) }}
          <span class="mx-1 opacity-40">·</span>
          {{ formatDate(file.createdAt) }}
          <template v-if="formatDuration(file.durationSeconds)">
            <span class="mx-1 opacity-40">·</span>
            {{ formatDuration(file.durationSeconds) }}
          </template>
        </p>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <span
          v-if="isAudioFile(file) && audioTrackCount > 1"
          class="text-xs md:text-[11px] font-semibold md:font-medium px-2.5 md:px-2 py-1 md:py-0.5 rounded-md md:rounded bg-muted text-muted-foreground"
          >Track {{ audioTrackIndex.get(file.id) }}</span
        >
        <span
          v-else-if="file.role === 'primary'"
          class="text-xs md:text-[11px] font-semibold md:font-medium px-2.5 md:px-2 py-1 md:py-0.5 rounded-md md:rounded bg-primary/10 text-primary"
          >Primary</span
        >

        <!-- Desktop actions -->
        <div class="hidden md:flex items-center gap-2">
          <button
            v-if="READER_OPENABLE_FORMATS.has(file.format ?? '') && !isAudioFile(file)"
            class="flex items-center gap-1.5 h-7 px-2.5 rounded border border-input bg-background text-xs font-medium hover:bg-muted transition-colors"
            @click="openFile(file)"
          >
            <BookOpen class="size-3.5" />
            Read
          </button>
          <button
            v-if="isAudioFile(file)"
            class="flex items-center gap-1.5 h-7 px-2.5 rounded border border-input bg-background text-xs font-medium hover:bg-muted transition-colors"
            @click="openFile(file)"
          >
            <Headphones class="size-3.5" />
            Play
          </button>
          <Tooltip v-if="hasPermission('library_download')">
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center h-7 w-7 rounded border border-input bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                @click="downloadFile(file)"
              >
                <Download class="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Download</TooltipContent>
          </Tooltip>
        </div>

        <!-- Mobile actions -->
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button
              class="flex md:hidden items-center justify-center h-11 w-11 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="More actions"
            >
              <MoreVertical class="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem v-if="READER_OPENABLE_FORMATS.has(file.format ?? '') && !isAudioFile(file)" @click="openFile(file)">
              <BookOpen class="mr-2 size-4" />
              Read
            </DropdownMenuItem>
            <DropdownMenuItem v-if="isAudioFile(file)" @click="openFile(file)">
              <Headphones class="mr-2 size-4" />
              Play
            </DropdownMenuItem>
            <DropdownMenuItem v-if="hasPermission('library_download')" @click="downloadFile(file)">
              <Download class="mr-2 size-4" />
              Download
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>

    <div v-if="book.files.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <div class="flex items-center justify-center w-12 h-12 rounded-xl bg-muted mb-3">
        <Files class="size-5 text-muted-foreground/70" />
      </div>
      <p class="text-base md:text-sm font-semibold md:font-medium">No files attached</p>
      <p class="text-sm md:text-xs text-muted-foreground/90 mt-1">This book has no associated files.</p>
    </div>
  </div>
</template>
