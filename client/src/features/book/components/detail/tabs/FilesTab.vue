<script setup lang="ts">
import { useRouter } from 'vue-router'
import { BookOpen, Download, Files } from 'lucide-vue-next'
import type { BookDetail, BookDetailFile } from '@projectx/types'

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

function accentClass(format: string | null): string {
  switch (format?.toLowerCase()) {
    case 'epub':
      return 'border-l-blue-500'
    case 'pdf':
      return 'border-l-red-500'
    case 'cbz':
    case 'cbr':
    case 'cb7':
      return 'border-l-violet-500'
    case 'mobi':
    case 'azw':
    case 'azw3':
      return 'border-l-orange-500'
    default:
      return 'border-l-border'
  }
}

function badgeClass(format: string | null): string {
  switch (format?.toLowerCase()) {
    case 'epub':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
    case 'pdf':
      return 'bg-red-500/10 text-red-600 dark:text-red-400'
    case 'cbz':
    case 'cbr':
    case 'cb7':
      return 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
    case 'mobi':
    case 'azw':
    case 'azw3':
      return 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
    default:
      return 'bg-muted text-muted-foreground'
  }
}
</script>

<template>
  <div class="space-y-3 max-w-4xl">
    <div
      v-for="file in book.files"
      :key="file.id"
      class="border border-border border-l-4 rounded-xl bg-card px-5 py-4 transition-shadow hover:shadow-sm"
      :class="accentClass(file.format)"
    >
      <div class="flex items-start justify-between gap-6">
        <!-- File info -->
        <div class="flex items-start gap-3.5 min-w-0">
          <span class="mt-0.5 shrink-0 text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md" :class="badgeClass(file.format)">
            {{ file.format ?? '?' }}
          </span>
          <div class="min-w-0">
            <p class="text-sm font-medium truncate leading-snug">{{ file.filename ?? '-' }}</p>
            <p class="text-[11px] font-mono text-muted-foreground/70 truncate mt-0.5" :title="file.absolutePath">
              {{ file.absolutePath }}
            </p>
            <div class="flex items-center gap-1.5 mt-1.5">
              <span class="text-xs text-muted-foreground">{{ formatBytes(file.sizeBytes) }}</span>
              <span class="text-muted-foreground/40 select-none">·</span>
              <span class="text-xs text-muted-foreground">{{ formatDate(file.createdAt) }}</span>
            </div>
          </div>
        </div>

        <!-- Badges + actions -->
        <div class="flex items-center gap-2 shrink-0 pt-0.5">
          <span v-if="file.role === 'primary'" class="text-[11px] font-medium px-2 py-0.5 rounded-md bg-primary/10 text-primary"> Primary </span>
          <button
            v-if="READABLE_FORMATS.has(file.format ?? '')"
            class="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-input bg-background text-xs font-medium hover:bg-muted transition-colors"
            @click="openFile(file)"
          >
            <BookOpen class="size-3.5" />
            Read
          </button>
          <button
            class="flex items-center justify-center h-8 w-8 rounded-lg border border-input bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Download"
            @click="downloadFile(file)"
          >
            <Download class="size-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="book.files.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <div class="flex items-center justify-center w-12 h-12 rounded-xl bg-muted mb-3">
        <Files class="size-5 text-muted-foreground/50" />
      </div>
      <p class="text-sm font-medium">No files attached</p>
      <p class="text-xs text-muted-foreground mt-1">This book has no associated files.</p>
    </div>
  </div>
</template>
