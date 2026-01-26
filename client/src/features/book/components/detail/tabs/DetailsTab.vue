<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, Download, FolderPlus, Trash2, X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'
import { Skeleton } from '@/components/ui/skeleton'
import { bookCoverStyle } from '@/features/book/lib/book-cover'
import type { BookDetail } from '@projectx/types'

const props = defineProps<{ book: BookDetail }>()

const router = useRouter()

const coverLoaded = ref(false)
const coverFailed = ref(false)
const coverLightboxOpen = ref(false)
const descriptionExpanded = ref(false)

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))

const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)

const authorLine = computed(() => props.book.authors.map((a) => a.name).join(', ') || null)

const seriesLine = computed(() => {
  if (!props.book.seriesName) return null
  const idx = props.book.seriesIndex
  return idx != null ? `${props.book.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : props.book.seriesName
})

const isbn = computed(() => props.book.isbn13 ?? props.book.isbn10 ?? null)

function openBook() {
  if (!primaryFile.value) return
  router.push({
    name: 'reader',
    params: { bookId: props.book.id, fileId: primaryFile.value.id },
    query: { format: primaryFile.value.format ?? 'epub' },
  })
}

function downloadFile() {
  if (!primaryFile.value) return
  const a = document.createElement('a')
  a.href = `/api/books/files/${primaryFile.value.id}/serve`
  a.download = `book.${primaryFile.value.format ?? 'epub'}`
  a.click()
}
</script>

<template>
  <div class="flex flex-col md:flex-row gap-8">
    <!-- Left column: cover + actions -->
    <div class="md:w-56 shrink-0 md:sticky md:top-4 md:self-start">
      <div class="max-w-48 mx-auto md:max-w-none">
        <!-- Cover -->
        <div
          class="w-full rounded-sm overflow-hidden shadow-md cursor-zoom-in"
          style="aspect-ratio: 2/3"
          :style="coverLoaded ? {} : coverStyle"
          @click="coverLoaded && !coverFailed && (coverLightboxOpen = true)"
        >
          <img
            v-if="!coverFailed"
            :src="`/api/books/${book.id}/cover`"
            class="w-full h-full object-cover transition-opacity duration-200"
            :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
            :alt="book.title ?? ''"
            @load="coverLoaded = true"
            @error="coverFailed = true"
          />
        </div>

        <!-- Actions -->
        <div class="mt-4 space-y-2">
          <button
            class="flex w-full items-center justify-center gap-2 h-9 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            :disabled="!primaryFile"
            @click="openBook"
          >
            <BookOpen class="size-4" />
            Read
          </button>
          <div class="flex gap-2">
            <button
              class="flex flex-1 items-center justify-center h-9 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-50"
              title="Download"
              :disabled="!primaryFile"
              @click="downloadFile"
            >
              <Download class="size-3.5" />
            </button>
            <button
              class="flex flex-1 items-center justify-center h-9 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors"
              title="Add to Collection"
            >
              <FolderPlus class="size-3.5" />
            </button>
            <button
              class="flex flex-1 items-center justify-center h-9 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
              title="Delete"
            >
              <Trash2 class="size-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Right column: metadata -->
    <div class="flex-1 min-w-0">
      <!-- Title block -->
      <h1 class="text-2xl font-bold leading-tight">{{ book.title ?? 'Untitled' }}</h1>
      <p v-if="book.subtitle" class="text-base text-muted-foreground mt-1">{{ book.subtitle }}</p>
      <p v-if="authorLine" class="text-sm text-foreground/80 mt-2">{{ authorLine }}</p>
      <p v-if="seriesLine" class="text-sm text-muted-foreground italic mt-0.5">{{ seriesLine }}</p>

      <!-- Badges -->
      <div class="flex flex-wrap gap-1.5 mt-4">
        <span
          v-for="file in book.files"
          :key="file.id"
          class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground"
        >
          {{ file.format ?? '?' }}
        </span>
        <span v-if="book.pageCount" class="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
          {{ book.pageCount }} pages
        </span>
        <span v-if="book.publishedYear" class="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
          {{ book.publishedYear }}
        </span>
        <span v-if="book.language" class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-muted text-muted-foreground">
          {{ book.language }}
        </span>
      </div>

      <!-- Tags -->
      <div v-if="book.tags.length" class="flex flex-wrap gap-1.5 mt-3">
        <span v-for="tag in book.tags" :key="tag" class="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary">
          {{ tag }}
        </span>
      </div>

      <!-- Publisher + ISBN -->
      <div class="mt-3 space-y-0.5">
        <p v-if="book.publisher" class="text-xs text-muted-foreground">{{ book.publisher }}</p>
        <p v-if="isbn" class="text-xs text-muted-foreground">ISBN: {{ isbn }}</p>
      </div>

      <!-- Description -->
      <div class="border-t mt-4 pt-4">
        <div v-if="book.description">
          <div
            class="text-sm leading-relaxed text-foreground/80 transition-all"
            :class="descriptionExpanded ? '' : 'line-clamp-4'"
            v-html="book.description"
          />
          <button
            class="text-xs text-muted-foreground hover:text-foreground mt-1.5 transition-colors"
            @click="descriptionExpanded = !descriptionExpanded"
          >
            {{ descriptionExpanded ? 'Show less' : 'Show more' }}
          </button>
        </div>
        <p v-else class="text-xs text-muted-foreground italic">No description available.</p>
      </div>
    </div>
  </div>

  <!-- Cover lightbox -->
  <DialogRoot :open="coverLightboxOpen" @update:open="coverLightboxOpen = $event">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 max-w-[90vw] max-h-[90vh] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      >
        <img :src="`/api/books/${book.id}/cover`" :alt="book.title ?? ''" class="max-w-[90vw] max-h-[90vh] rounded-md shadow-2xl object-contain" />
        <DialogClose
          class="absolute -top-3 -right-3 p-1 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          <X class="size-4" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
