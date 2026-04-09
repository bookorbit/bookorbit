<script setup lang="ts">
import { computed } from 'vue'
import { ChevronDown, Download } from 'lucide-vue-next'
import { FORMAT_TO_GROUP, READER_OPENABLE_FORMATS } from '@projectx/types'
import type { BookDetailFile } from '@projectx/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getFormatColor } from '@/features/book/lib/format-colors'
import { useBookDownload } from '@/features/book/composables/useBookDownload'

const props = defineProps<{
  files: BookDetailFile[]
  bookId: number
}>()

const { isDownloading, downloadFile, exportBooks } = useBookDownload()

const readableFiles = computed(() => props.files.filter((f) => f.format && READER_OPENABLE_FORMATS.has(f.format)))

const primaryFile = computed(() => readableFiles.value.find((f) => f.role === 'primary') ?? readableFiles.value[0] ?? null)

// For multi-file audiobooks, show a single ZIP option instead of 35 individual track rows.
const isMultiTrackAudio = computed(() => {
  const audioFiles = readableFiles.value.filter((f) => FORMAT_TO_GROUP[f.format!] === 'audio')
  return audioFiles.length > 1
})
const nonAudioFiles = computed(() => readableFiles.value.filter((f) => FORMAT_TO_GROUP[f.format!] !== 'audio'))

const hasMultiple = computed(() => {
  if (isMultiTrackAudio.value) return nonAudioFiles.value.length > 0
  return readableFiles.value.length > 1
})

function formatBadgeStyle(fmt: string) {
  const color = getFormatColor(fmt)
  return { color, borderColor: `${color}66`, backgroundColor: `${color}1a` }
}

function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function handleSingleDownload() {
  if (isMultiTrackAudio.value) {
    exportBooks([props.bookId], false, 'audio')
  } else if (primaryFile.value) {
    downloadFile(primaryFile.value.id)
  }
}

function handleFileDownload(file: BookDetailFile) {
  downloadFile(file.id)
}

function handleExportAll() {
  exportBooks([props.bookId], true)
}

function handleExportPrimary() {
  if (isMultiTrackAudio.value) {
    exportBooks([props.bookId], false, 'audio')
    return
  }
  exportBooks([props.bookId], false)
}
</script>

<template>
  <Tooltip v-if="!hasMultiple">
    <TooltipTrigger as-child>
      <button
        class="flex w-full items-center justify-center h-9 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-50"
        :disabled="!primaryFile || isDownloading"
        @click="handleSingleDownload"
      >
        <Download class="size-3.5" />
      </button>
    </TooltipTrigger>
    <TooltipContent>Download</TooltipContent>
  </Tooltip>

  <Popover v-else>
    <PopoverTrigger as-child>
      <button
        class="flex w-full items-center justify-center gap-1.5 h-9 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-50"
        :disabled="!primaryFile || isDownloading"
        title="Download"
      >
        <Download class="size-3.5" />
        <ChevronDown class="size-3" />
      </button>
    </PopoverTrigger>
    <PopoverContent class="w-52 p-1" align="start">
      <!-- Multi-track audiobook: offer ZIP download, then any non-audio formats individually -->
      <template v-if="isMultiTrackAudio">
        <button class="flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors" @click="handleExportPrimary">
          <Download class="size-3.5 shrink-0" />
          <span>Audiobook (ZIP)</span>
        </button>
        <button
          v-for="file in nonAudioFiles"
          :key="file.id"
          class="flex w-full items-center gap-2.5 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors"
          @click="handleFileDownload(file)"
        >
          <span
            class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0"
            :style="formatBadgeStyle(file.format ?? '?')"
            >{{ file.format ?? '?' }}</span
          >
          <span class="flex-1 text-left text-muted-foreground text-xs truncate">{{ formatFileSize(file.sizeBytes) }}</span>
        </button>
      </template>

      <!-- Regular multi-format book: list each file individually -->
      <template v-else>
        <button
          v-for="file in readableFiles"
          :key="file.id"
          class="flex w-full items-center gap-2.5 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors"
          @click="handleFileDownload(file)"
        >
          <span
            class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0"
            :style="formatBadgeStyle(file.format ?? '?')"
            >{{ file.format ?? '?' }}</span
          >
          <span class="flex-1 text-left text-muted-foreground text-xs truncate">{{ formatFileSize(file.sizeBytes) }}</span>
          <span v-if="file.role === 'primary'" class="text-[10px] text-primary font-medium shrink-0">Primary</span>
        </button>
        <div class="my-1 border-t border-border" />
        <button
          class="flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors text-muted-foreground"
          @click="handleExportAll"
        >
          <Download class="size-3.5 shrink-0" />
          <span>All formats (ZIP)</span>
        </button>
        <button
          class="flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors text-muted-foreground"
          @click="handleExportPrimary"
        >
          <Download class="size-3.5 shrink-0" />
          <span>Primary only (ZIP)</span>
        </button>
      </template>
    </PopoverContent>
  </Popover>
</template>
