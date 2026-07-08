<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, ExternalLink, HelpCircle, Loader2, RefreshCw, Link2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { StorygraphEdition, StorygraphLinkedBook } from '@bookorbit/types'
import {
  fetchStorygraphEditions,
  fetchStorygraphLinkedBooks,
  linkStorygraphBook,
  rematchStorygraphBook,
  setStorygraphEdition,
} from '../api/storygraph.api'
import { useStorygraphSync } from '../composables/useStorygraphSync'

function editionUrl(edition: StorygraphEdition): string {
  return `https://app.thestorygraph.com/books/${edition.id}`
}

const books = ref<StorygraphLinkedBook[]>([])
const loading = ref(true)
const loadError = ref(false)
const expandedBookId = ref<number | null>(null)
const linkInputs = reactive<Record<number, string>>({})
const linking = reactive<Record<number, boolean>>({})
const rematching = reactive<Record<number, boolean>>({})
const editionsByBookId = reactive<Record<number, StorygraphEdition[]>>({})
const loadingEditions = reactive<Record<number, boolean>>({})
const settingEdition = reactive<Record<number, boolean>>({})

onMounted(async () => {
  await loadBooks()
})

// A bulk sync can link books after this list was fetched, leaving rows stuck on
// "Not linked yet" until a manual refresh, so reload whenever a run finishes. The refresh is
// silent: toggling the loading state would swap the list for the spinner and collapse
// whatever row the user is mid-interaction with.
const { lastRunSummary } = useStorygraphSync()
watch(lastRunSummary, async (summary) => {
  if (summary) await loadBooks({ silent: true })
})

// Swallows its own failures (loadError drives the UI) so post-action refreshes can't
// bubble into callers' try/catch and misattribute a reload failure to the action itself.
// The request id guards against concurrent reloads (mount, post-action, post-run) resolving
// out of order and clobbering newer results with stale ones.
let loadRequestId = 0
async function loadBooks(options?: { silent?: boolean }): Promise<void> {
  const requestId = ++loadRequestId
  if (!options?.silent) loading.value = true
  loadError.value = false
  try {
    const rows = await fetchStorygraphLinkedBooks()
    if (requestId === loadRequestId) books.value = rows
  } catch {
    if (requestId === loadRequestId) loadError.value = true
  } finally {
    if (requestId === loadRequestId && !options?.silent) loading.value = false
  }
}

async function handleRetryLoadBooks(): Promise<void> {
  await loadBooks()
}

function toggleExpanded(bookId: number) {
  expandedBookId.value = expandedBookId.value === bookId ? null : bookId
}

// StoryGraph reports match methods as lowercase slugs; present them with real casing.
const MATCH_METHOD_LABELS: Record<string, string> = {
  isbn: 'ISBN',
  title: 'Title',
  cached: 'Cached',
  manual: 'Manual',
}

function matchMethodLabel(method: string): string {
  return MATCH_METHOD_LABELS[method] ?? method
}

function statusLabel(book: StorygraphLinkedBook): string {
  if (book.matchError) return `Error: ${book.matchError}`
  if (book.storygraphBookId) return `Linked${book.matchMethod ? ` (${matchMethodLabel(book.matchMethod)})` : ''}`
  return 'Not linked yet'
}

async function handleLink(book: StorygraphLinkedBook) {
  const input = (linkInputs[book.bookId] ?? '').trim()
  if (!input) {
    toast.error('Paste a StoryGraph URL or book id first')
    return
  }
  linking[book.bookId] = true
  try {
    const result = await linkStorygraphBook(book.bookId, input)
    if (result.success) {
      toast.success(`Linked: ${result.title || result.storygraphBookId}`)
      linkInputs[book.bookId] = ''
      delete editionsByBookId[book.bookId]
      await loadBooks()
    } else {
      toast.error('Could not find that StoryGraph book')
    }
  } catch {
    toast.error('Failed to link StoryGraph book')
  } finally {
    linking[book.bookId] = false
  }
}

async function handleRematch(book: StorygraphLinkedBook) {
  rematching[book.bookId] = true
  try {
    const { result } = await rematchStorygraphBook(book.bookId)
    if (result === 'synced') toast.success('Re-matched and synced with StoryGraph')
    else if (result === 'failed') toast.error('StoryGraph re-match failed, check the server logs')
    else toast.info('StoryGraph sync is not connected for your account')
    delete editionsByBookId[book.bookId]
    await loadBooks()
  } catch {
    toast.error('Failed to re-match with StoryGraph')
  } finally {
    rematching[book.bookId] = false
  }
}

async function loadEditions(book: StorygraphLinkedBook) {
  if (editionsByBookId[book.bookId]) return
  loadingEditions[book.bookId] = true
  try {
    editionsByBookId[book.bookId] = await fetchStorygraphEditions(book.bookId)
  } finally {
    loadingEditions[book.bookId] = false
  }
}

async function handleSetEdition(book: StorygraphLinkedBook, edition: StorygraphEdition) {
  settingEdition[book.bookId] = true
  try {
    const { success } = await setStorygraphEdition(book.bookId, edition.id)
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
        Shows books you're currently reading. StoryGraph has no public API, so matching is sometimes wrong. Fix a book here by pasting its correct
        StoryGraph URL, or pick a different edition (paperback, ebook, audiobook) once it's linked.
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
              :class="book.matchError ? 'text-destructive' : book.storygraphBookId ? 'text-green-600' : 'text-muted-foreground'"
            >
              <AlertCircle v-if="book.matchError" class="size-3.5" />
              <CheckCircle2 v-else-if="book.storygraphBookId" class="size-3.5" />
              <HelpCircle v-else class="size-3.5" />
              {{ statusLabel(book) }}
            </span>
            <ChevronUp v-if="expandedBookId === book.bookId" class="size-3.5 text-muted-foreground" />
            <ChevronDown v-else class="size-3.5 text-muted-foreground" />
          </div>
        </button>

        <div v-if="expandedBookId === book.bookId" class="mt-3 space-y-3 pl-1">
          <p v-if="!book.storygraphBookId" class="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
            <HelpCircle class="size-3.5 shrink-0 mt-0.5" />
            This book couldn't be matched to StoryGraph automatically. Use "Try auto-match" to search again, or paste the book's StoryGraph URL, or
            its StoryGraph book ID (the code after <code class="px-1 rounded bg-muted">/books/</code> in the URL, not an ISBN), below for an exact
            link.
          </p>
          <div class="flex gap-2">
            <input
              v-model="linkInputs[book.bookId]"
              type="text"
              placeholder="Paste a StoryGraph URL or book ID"
              class="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              type="button"
              :disabled="linking[book.bookId]"
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              @click="handleLink(book)"
            >
              <Loader2 v-if="linking[book.bookId]" class="size-3 animate-spin" />
              <Link2 v-else class="size-3" />
              Link
            </button>
          </div>

          <button
            type="button"
            :disabled="rematching[book.bookId]"
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            @click="handleRematch(book)"
          >
            <Loader2 v-if="rematching[book.bookId]" class="size-3 animate-spin" />
            <RefreshCw v-else class="size-3" />
            Try auto-match
          </button>

          <div v-if="book.storygraphBookId">
            <button
              v-if="!editionsByBookId[book.bookId]"
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
                      <span v-if="edition.publisher && edition.publicationDate"> · </span>
                      <span v-if="edition.publicationDate">{{ edition.publicationDate }}</span>
                      <span v-if="(edition.publisher || edition.publicationDate) && edition.isbn"> · </span>
                      <span v-if="edition.isbn">ISBN {{ edition.isbn }}</span>
                    </p>
                  </div>
                </div>
                <div class="flex shrink-0 items-center gap-1.5">
                  <a
                    :href="editionUrl(edition)"
                    target="_blank"
                    rel="noopener"
                    title="Open on StoryGraph"
                    aria-label="Open on StoryGraph"
                    class="flex items-center justify-center p-1.5 rounded-md border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  >
                    <ExternalLink class="size-3.5" />
                  </a>
                  <button
                    type="button"
                    :disabled="settingEdition[book.bookId] || edition.id === book.storygraphBookId"
                    class="px-2 py-1 text-xs rounded-md border border-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    @click="handleSetEdition(book, edition)"
                  >
                    {{ edition.id === book.storygraphBookId ? 'Current' : 'Use this' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
