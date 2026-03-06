<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { BookOpen, Download, Folder, FolderPlus, Pencil, Trash2, TriangleAlert, X } from 'lucide-vue-next'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot } from 'reka-ui'
import { bookCoverStyle } from '@/features/book/lib/book-cover'
import { useCoverVersions } from '@/features/book/composables/useCoverVersions'
import type { BookDetail } from '@projectx/types'
import RecommendedBooksRow from '@/features/book/components/detail/RecommendedBooksRow.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{ book: BookDetail }>()
const router = useRouter()

const coverLoaded = ref(false)
const coverFailed = ref(false)
const coverLightboxOpen = ref(false)
const descriptionExpanded = ref(false)

const coverStyle = computed(() => bookCoverStyle(props.book.title ?? String(props.book.id)))
const { coverUrl } = useCoverVersions()
const coverSrc = computed(() => coverUrl(props.book.id, 'cover'))

const primaryFile = computed(() => props.book.files.find((f) => f.role === 'primary') ?? props.book.files[0] ?? null)
const authorLine = computed(() => props.book.authors.map((a) => a.name).join(', ') || null)
const formats = computed(() => [...new Set(props.book.files.map((f) => f.format ?? '?'))])

const seriesLine = computed(() => {
  if (!props.book.seriesName) return null
  const idx = props.book.seriesIndex
  return idx != null ? `${props.book.seriesName} #${idx % 1 === 0 ? Math.floor(idx) : idx}` : props.book.seriesName
})

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
  a.href = `/api/v1/books/files/${primaryFile.value.id}/serve`
  a.download = `book.${primaryFile.value.format ?? 'epub'}`
  a.click()
}
</script>

<template>
  <div v-if="book.status === 'missing'" class="mb-6 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3">
    <TriangleAlert class="size-4 text-amber-500 shrink-0 mt-0.5" />
    <div>
      <p class="text-sm font-medium text-amber-600 dark:text-amber-400">Files not found</p>
      <p class="text-xs text-muted-foreground mt-0.5">
        The file(s) for this book can no longer be found on disk. Metadata is still available. Run a library scan to confirm, or remove the record.
      </p>
    </div>
  </div>

  <div class="flex flex-col md:flex-row gap-8">
    <!-- Left column: cover + actions -->
    <div class="md:w-56 shrink-0 md:sticky md:top-4 md:self-start">
      <div class="max-w-48 mx-auto md:max-w-none">
        <div
          class="group relative w-full rounded-sm overflow-hidden shadow-md cursor-zoom-in bg-muted/50"
          style="aspect-ratio: 2/3"
          :style="coverLoaded ? {} : coverStyle"
          @click="coverLoaded && !coverFailed && (coverLightboxOpen = true)"
        >
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="absolute top-1.5 right-1.5 z-10 p-1 rounded bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                @click.stop="router.push({ name: 'book-edit', params: { bookId: book.id } })"
              >
                <Pencil class="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Edit cover</TooltipContent>
          </Tooltip>
          <img
            v-if="!coverFailed"
            :src="coverSrc"
            class="w-full h-full object-contain transition-opacity duration-200"
            :class="coverLoaded ? 'opacity-100' : 'opacity-0'"
            :alt="book.title ?? ''"
            @load="coverLoaded = true"
            @error="coverFailed = true"
          />
        </div>

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
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex flex-1 items-center justify-center h-9 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors disabled:opacity-50"
                  :disabled="!primaryFile"
                  @click="downloadFile"
                >
                  <Download class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Download</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex flex-1 items-center justify-center h-9 rounded-md border border-input bg-background text-sm hover:bg-muted transition-colors"
                >
                  <FolderPlus class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add to collection</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex flex-1 items-center justify-center h-9 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
                >
                  <Trash2 class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </div>

    <!-- Right column -->
    <div class="flex-1 min-w-0">
      <!-- Identity block -->
      <h1 class="text-2xl font-bold leading-tight">{{ book.title ?? 'Untitled' }}</h1>
      <p v-if="book.subtitle" class="text-base text-muted-foreground mt-1 leading-snug">{{ book.subtitle }}</p>

      <div class="flex items-baseline flex-wrap gap-x-2 gap-y-1 mt-3">
        <p v-if="authorLine" class="text-sm">
          <span class="text-muted-foreground">by</span>
          <span class="ml-1 font-medium text-foreground">{{ authorLine }}</span>
        </p>
        <template v-if="seriesLine">
          <span class="text-muted-foreground/40 text-xs">·</span>
          <span class="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">{{ seriesLine }}</span>
        </template>
      </div>

      <!-- Format badges -->
      <div v-if="formats.length" class="flex flex-wrap gap-1.5 mt-4">
        <span
          v-for="fmt in formats"
          :key="fmt"
          class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border border-border text-muted-foreground"
        >
          {{ fmt }}
        </span>
      </div>

      <!-- Genres -->
      <div v-if="book.genres.length" class="flex flex-wrap gap-1.5 mt-4">
        <span v-for="genre in book.genres" :key="genre" class="text-xs px-2.5 py-0.5 rounded-full border border-primary/30 text-primary/80">
          {{ genre }}
        </span>
      </div>

      <!-- Metadata grid -->
      <dl
        v-if="book.publisher || book.publishedYear || book.language || book.pageCount || book.isbn13 || book.isbn10"
        class="mt-5 pt-5 border-t border-border grid grid-cols-2 gap-x-8 gap-y-4"
      >
        <div v-if="book.publisher" class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Publisher</dt>
          <dd class="text-sm text-foreground mt-0.5 leading-snug">{{ book.publisher }}</dd>
        </div>
        <div v-if="book.publishedYear">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Published</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ book.publishedYear }}</dd>
        </div>
        <div v-if="book.language">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Language</dt>
          <dd class="text-sm text-foreground mt-0.5 capitalize">{{ book.language }}</dd>
        </div>
        <div v-if="book.pageCount">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">Pages</dt>
          <dd class="text-sm text-foreground mt-0.5">{{ book.pageCount }}</dd>
        </div>
        <div v-if="book.isbn13" class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">ISBN-13</dt>
          <dd class="text-sm text-foreground mt-0.5 font-mono">{{ book.isbn13 }}</dd>
        </div>
        <div v-if="book.isbn10" class="min-w-0">
          <dt class="text-[10px] uppercase tracking-wider font-medium text-muted-foreground">ISBN-10</dt>
          <dd class="text-sm text-foreground mt-0.5 font-mono">{{ book.isbn10 }}</dd>
        </div>
      </dl>

      <!-- Location -->
      <div class="mt-5 pt-5 border-t border-border">
        <div class="flex items-center gap-2 min-w-0">
          <Folder class="size-3.5 text-muted-foreground shrink-0" />
          <p class="text-xs text-muted-foreground font-mono truncate min-w-0" :title="book.folderPath">{{ book.folderPath }}</p>
        </div>
      </div>

      <!-- Synopsis -->
      <div class="mt-6 pt-5 border-t border-border">
        <p class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">Synopsis</p>
        <div v-if="book.description">
          <div
            class="text-sm leading-relaxed text-foreground/80 transition-all"
            :class="descriptionExpanded ? '' : 'line-clamp-3'"
            v-html="book.description"
          />
          <button
            class="text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
            @click="descriptionExpanded = !descriptionExpanded"
          >
            {{ descriptionExpanded ? 'Show less' : 'Show more' }}
          </button>
        </div>
        <p v-else class="text-sm text-muted-foreground italic">No description available.</p>
      </div>
    </div>
  </div>

  <RecommendedBooksRow :book-id="book.id" />

  <!-- Cover lightbox -->
  <DialogRoot :open="coverLightboxOpen" @update:open="coverLightboxOpen = $event">
    <DialogPortal>
      <DialogOverlay
        class="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 max-w-[90vw] max-h-[90vh] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
      >
        <img :src="coverSrc" :alt="book.title ?? ''" class="max-w-[90vw] max-h-[90vh] rounded-md shadow-2xl object-contain" />
        <DialogClose
          class="absolute -top-3 -right-3 p-1 rounded-full bg-background border border-border text-muted-foreground hover:text-foreground transition-colors"
        >
          <X class="size-4" />
        </DialogClose>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
