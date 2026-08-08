<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, HelpCircle, Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { HardcoverEdition, HardcoverLinkedBook } from '@bookorbit/types'
import { fetchHardcoverEditions, fetchHardcoverLinkedBooks, setHardcoverEdition } from '../api/hardcover.api'

const books = ref<HardcoverLinkedBook[]>([])
const loading = ref(true)
const loadError = ref(false)
const expandedBookId = ref<number | null>(null)
const editionsByBookId = reactive<Record<number, HardcoverEdition[]>>({})
const loadingEditions = reactive<Record<number, boolean>>({})
const editionsLoadError = reactive<Record<number, boolean>>({})
const settingEdition = reactive<Record<number, boolean>>({})

onMounted(async () => {
  await loadBooks()
})

let loadRequestId = 0
async function loadBooks(): Promise<void> {
  const requestId = ++loadRequestId
  loading.value = true
  loadError.value = false
  try {
    const rows = await fetchHardcoverLinkedBooks()
    if (requestId === loadRequestId) books.value = rows
  } catch {
    if (requestId === loadRequestId) loadError.value = true
  } finally {
    if (requestId === loadRequestId) loading.value = false
  }
}

async function handleRetryLoadBooks(): Promise<void> {
  await loadBooks()
}

function toggleExpanded(bookId: number) {
  expandedBookId.value = expandedBookId.value === bookId ? null : bookId
}

const MATCH_METHOD_LABELS: Record<string, string> = {
  isbn: 'ISBN',
  title: 'Title',
  cached: 'Cached',
  manual: 'Manual',
  metadata_id: 'Metadata match',
}

function matchMethodLabel(method: string): string {
  return MATCH_METHOD_LABELS[method] ?? method
}

function statusLabel(book: HardcoverLinkedBook): string {
  if (book.matchError) return `Error: ${book.matchError}`
  if (book.hardcoverBookId) return `Linked${book.matchMethod ? ` (${matchMethodLabel(book.matchMethod)})` : ''}`
  return 'Not linked yet'
}

async function loadEditions(book: HardcoverLinkedBook) {
  if (editionsByBookId[book.bookId]) return
  loadingEditions[book.bookId] = true
  editionsLoadError[book.bookId] = false
  try {
    editionsByBookId[book.bookId] = await fetchHardcoverEditions(book.bookId)
  } catch {
    editionsLoadError[book.bookId] = true
  } finally {
    loadingEditions[book.bookId] = false
  }
}

async function handleSetEdition(book: HardcoverLinkedBook, edition: HardcoverEdition) {
  settingEdition[book.bookId] = true
  try {
    const { success } = await setHardcoverEdition(book.bookId, edition.id)
    if (success) {
      toast.success(`Switched to ${edition.format}`)
      delete editionsByBookId[book.bookId]
      await loadBooks()
    } else {
      toast.error('Failed to switch edition')
    }
  } catch {
    toast.error('Failed to switch edition')
  } finally {
    settingEdition[book.bookId] = false
  }
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs space-y-4">
    <div>
      <p class="font-medium text-sm">Linked books</p>
      <p class="text-xs text-muted-foreground mt-0.5">
        Shows books you're currently reading. Once a book is matched to Hardcover, pick a different edition (physical, ebook, audiobook) here to
        change what your reading progress syncs against.
      </p>
    </div>

    <div v-if="loading" class="flex items-center gap-2 text-xs text-muted-foreground py-4">
      <Loader2 class="size-3.5 animate-spin" />
      Loading books...
    </div>

    <div v-else-if="loadError" class="flex items-center gap-2 text-xs text-destructive py-2">
      <AlertCircle class="size-3.5 shrink-0" />
      Failed to load books.
      <button type="button" class="underline underline-offset-2" @click="handleRetryLoadBooks">Retry</button>
    </div>

    <div v-else-if="books.length === 0" class="text-xs text-muted-foreground py-2">No books currently being read.</div>

    <div v-else class="divide-y divide-border/60">
      <div v-for="book in books" :key="book.bookId" class="py-2.5">
        <button type="button" class="flex w-full items-center justify-between gap-2 text-left" @click="toggleExpanded(book.bookId)">
          <div class="min-w-0">
            <p class="text-sm truncate">{{ book.title ?? 'Untitled' }}</p>
            <p class="text-xs text-muted-foreground truncate">{{ book.authorName ?? 'Unknown author' }}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span
              class="flex items-center gap-1 text-xs"
              :class="book.matchError ? 'text-destructive' : book.hardcoverBookId ? 'text-green-600' : 'text-muted-foreground'"
            >
              <AlertCircle v-if="book.matchError" class="size-3.5" />
              <CheckCircle2 v-else-if="book.hardcoverBookId" class="size-3.5" />
              <HelpCircle v-else class="size-3.5" />
              {{ statusLabel(book) }}
            </span>
            <ChevronUp v-if="expandedBookId === book.bookId" class="size-3.5 text-muted-foreground" />
            <ChevronDown v-else class="size-3.5 text-muted-foreground" />
          </div>
        </button>

        <div v-if="expandedBookId === book.bookId" class="mt-3 space-y-3 pl-1">
          <p v-if="!book.hardcoverBookId" class="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
            <HelpCircle class="size-3.5 shrink-0 mt-0.5" />
            This book hasn't been matched to Hardcover yet. It will be matched automatically the next time it syncs.
          </p>

          <div v-else>
            <div v-if="editionsLoadError[book.bookId]" class="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle class="size-3.5 shrink-0" />
              Failed to load editions.
              <button type="button" class="underline underline-offset-2" @click="loadEditions(book)">Retry</button>
            </div>

            <button
              v-else-if="!editionsByBookId[book.bookId]"
              type="button"
              :disabled="loadingEditions[book.bookId]"
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              @click="loadEditions(book)"
            >
              <Loader2 v-if="loadingEditions[book.bookId]" class="size-3 animate-spin" />
              View editions
            </button>

            <div v-else class="space-y-1.5">
              <p v-if="editionsByBookId[book.bookId]!.length === 0" class="text-xs text-muted-foreground">No editions found.</p>
              <div
                v-for="edition in editionsByBookId[book.bookId]"
                :key="edition.id"
                class="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5"
              >
                <div class="flex min-w-0 items-center gap-2.5">
                  <img
                    v-if="edition.coverUrl"
                    :src="edition.coverUrl"
                    alt=""
                    class="h-12 w-8 shrink-0 rounded-sm object-cover border border-border/60"
                    loading="lazy"
                  />
                  <div class="min-w-0 space-y-0.5">
                    <p class="text-xs truncate">
                      <span v-if="edition.title" class="font-medium">{{ edition.title }} · </span>
                      {{ edition.format }}
                      <span v-if="edition.pages" class="text-muted-foreground">· {{ edition.pages }} pages</span>
                      <span v-if="edition.language" class="text-muted-foreground">· {{ edition.language }}</span>
                    </p>
                    <p class="text-[11px] text-muted-foreground break-words">
                      <span v-if="edition.publisher">{{ edition.publisher }}</span>
                      <span v-if="edition.publisher && edition.publishedDate"> · </span>
                      <span v-if="edition.publishedDate">{{ edition.publishedDate }}</span>
                      <span v-if="(edition.publisher || edition.publishedDate) && (edition.isbn13 || edition.isbn10)"> · </span>
                      <span v-if="edition.isbn13 || edition.isbn10">ISBN {{ edition.isbn13 ?? edition.isbn10 }}</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  :disabled="settingEdition[book.bookId] || edition.id === book.hardcoverEditionId"
                  class="shrink-0 px-2 py-1 text-xs rounded-md border border-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  @click="handleSetEdition(book, edition)"
                >
                  {{ edition.id === book.hardcoverEditionId ? 'Current' : 'Use this' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
