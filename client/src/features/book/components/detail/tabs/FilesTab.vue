<script setup lang="ts">
import { useRouter } from 'vue-router'
import { BookOpen, Download, Files } from 'lucide-vue-next'
import type { BookDetail, BookDetailFile } from '@projectx/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{ book: BookDetail }>()
const router = useRouter()

const READABLE_FORMATS = new Set(['epub', 'pdf', 'cbz'])

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function openFile(file: BookDetailFile) {
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: file.id },
    query: { format: file.format ?? 'epub' },
  })
}

function downloadFile(file: BookDetailFile) {
  const a = document.createElement('a')
  a.href = `/api/v1/books/files/${file.id}/serve`
  a.download = file.filename ?? `book.${file.format ?? 'epub'}`
  a.click()
}

function fileIconBg(format: string | null): string {
  switch (format?.toLowerCase()) {
    case 'epub':
      return 'bg-blue-500/15'
    case 'pdf':
      return 'bg-red-500/15'
    case 'cbz':
    case 'cbr':
    case 'cb7':
      return 'bg-violet-500/15'
    case 'mobi':
    case 'azw':
    case 'azw3':
      return 'bg-orange-500/15'
    default:
      return 'bg-muted'
  }
}

function fileIconText(format: string | null): string {
  switch (format?.toLowerCase()) {
    case 'epub':
      return 'text-blue-600 dark:text-blue-400'
    case 'pdf':
      return 'text-red-600 dark:text-red-400'
    case 'cbz':
    case 'cbr':
    case 'cb7':
      return 'text-violet-600 dark:text-violet-400'
    case 'mobi':
    case 'azw':
    case 'azw3':
      return 'text-orange-600 dark:text-orange-400'
    default:
      return 'text-muted-foreground'
  }
}
</script>

<template>
  <div class="max-w-3xl space-y-2">
    <div
      v-for="file in book.files"
      :key="file.id"
      class="flex items-center gap-4 px-4 py-3.5 rounded-lg bg-card border border-border hover:bg-muted/30 transition-colors"
    >
      <div
        class="relative shrink-0 w-10 h-12 flex items-end justify-center pb-1.5"
        :class="[fileIconBg(file.format), fileIconText(file.format)]"
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
        <p class="text-sm font-medium truncate">{{ file.filename ?? '-' }}</p>
        <p class="text-[11px] font-mono text-muted-foreground/60 truncate mt-0.5" :title="file.absolutePath">{{ file.absolutePath }}</p>
        <p class="text-xs text-muted-foreground mt-1">
          {{ formatBytes(file.sizeBytes) }}
          <span class="mx-1 opacity-40">·</span>
          {{ formatDate(file.createdAt) }}
        </p>
      </div>

      <div class="flex items-center gap-2 shrink-0">
        <span v-if="file.role === 'primary'" class="text-[11px] font-medium px-2 py-0.5 rounded bg-primary/10 text-primary">Primary</span>
        <button
          v-if="READABLE_FORMATS.has(file.format ?? '')"
          class="flex items-center gap-1.5 h-7 px-2.5 rounded border border-input bg-background text-xs font-medium hover:bg-muted transition-colors"
          @click="openFile(file)"
        >
          <BookOpen class="size-3.5" />
          Read
        </button>
        <Tooltip>
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
    </div>

    <div v-if="book.files.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <div class="flex items-center justify-center w-12 h-12 rounded-xl bg-muted mb-3">
        <Files class="size-5 text-muted-foreground/50" />
      </div>
      <p class="text-sm font-medium">No files attached</p>
      <p class="text-xs text-muted-foreground mt-1">This book has no associated files.</p>
    </div>
  </div>
</template>
