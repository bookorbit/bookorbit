<script setup lang="ts">
import { useRouter } from 'vue-router'
import { BookOpen, Download } from 'lucide-vue-next'
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
  a.href = `/api/books/files/${file.id}/serve`
  a.download = file.filename ?? `book.${file.format ?? 'epub'}`
  a.click()
}
</script>

<template>
  <div class="divide-y divide-border">
    <div v-for="file in book.files" :key="file.id" class="flex items-center gap-4 py-3">
      <!-- Format badge + primary dot -->
      <div class="flex items-center gap-1.5 shrink-0 w-20">
        <span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground">
          {{ file.format ?? '?' }}
        </span>
        <span v-if="file.role === 'primary'" class="text-primary text-xs" title="Primary">●</span>
      </div>

      <!-- File info -->
      <div class="flex-1 min-w-0">
        <p class="text-sm truncate">{{ file.filename ?? '-' }}</p>
        <p class="text-xs text-muted-foreground mt-0.5">
          {{ formatBytes(file.sizeBytes) }}
          <span class="mx-1">·</span>
          {{ formatDate(file.createdAt) }}
        </p>
      </div>

      <!-- Actions -->
      <div class="flex items-center gap-1 shrink-0">
        <button
          v-if="READABLE_FORMATS.has(file.format ?? '')"
          class="flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-input bg-background text-xs hover:bg-muted transition-colors"
          title="Read"
          @click="openFile(file)"
        >
          <BookOpen class="size-3.5" />
          Read
        </button>
        <button
          class="flex items-center justify-center h-8 w-8 rounded-md border border-input bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          title="Download"
          @click="downloadFile(file)"
        >
          <Download class="size-3.5" />
        </button>
      </div>
    </div>

    <p v-if="book.files.length === 0" class="py-8 text-sm text-muted-foreground text-center">No files attached to this book.</p>
  </div>
</template>
