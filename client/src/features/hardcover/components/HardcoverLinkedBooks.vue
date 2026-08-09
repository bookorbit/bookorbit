<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, HelpCircle, Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { HardcoverEdition, HardcoverLinkedBook } from '@bookorbit/types'
import { fetchHardcoverEditions, fetchHardcoverLinkedBooks, setHardcoverEdition } from '../api/hardcover.api'

const { t, te } = useI18n()

const books = ref<HardcoverLinkedBook[]>([])
const booksTruncated = ref(false)
const loading = ref(true)
const loadError = ref(false)
const expandedBookId = ref<number | null>(null)
const editionsByBookId = reactive<Record<number, HardcoverEdition[]>>({})
const editionsTruncated = reactive<Record<number, boolean>>({})
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
    const result = await fetchHardcoverLinkedBooks()
    if (requestId === loadRequestId) {
      books.value = result.books
      booksTruncated.value = result.truncated
    }
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

function panelId(bookId: number): string {
  return `hardcover-linked-book-${bookId}`
}

function matchMethodLabel(method: string): string {
  const key = `hardcover.linkedBooks.matchMethod.${method}`
  return te(key) ? t(key) : method
}

function statusLabel(book: HardcoverLinkedBook): string {
  if (book.matchError) return t('hardcover.linkedBooks.status.error', { error: book.matchError })
  if (book.hardcoverBookId) {
    return book.matchMethod
      ? t('hardcover.linkedBooks.status.linkedWithMethod', { method: matchMethodLabel(book.matchMethod) })
      : t('hardcover.linkedBooks.status.linked')
  }
  return t('hardcover.linkedBooks.status.notLinked')
}

async function loadEditions(book: HardcoverLinkedBook) {
  if (editionsByBookId[book.bookId] || loadingEditions[book.bookId]) return
  loadingEditions[book.bookId] = true
  editionsLoadError[book.bookId] = false
  try {
    const result = await fetchHardcoverEditions(book.bookId)
    editionsByBookId[book.bookId] = result.editions
    editionsTruncated[book.bookId] = result.truncated
  } catch {
    editionsLoadError[book.bookId] = true
  } finally {
    loadingEditions[book.bookId] = false
  }
}

// The list is deliberately kept mounted: reloading the books refreshes which row reads as
// "Current", so collapsing the panel would only cost the user their place.
async function handleSetEdition(book: HardcoverLinkedBook, edition: HardcoverEdition) {
  settingEdition[book.bookId] = true
  try {
    await setHardcoverEdition(book.bookId, edition.id)
    toast.success(t('hardcover.linkedBooks.toast.switched', { format: edition.format }))
    await loadBooks()
  } catch {
    toast.error(t('hardcover.linkedBooks.toast.switchFailed'))
  } finally {
    settingEdition[book.bookId] = false
  }
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs space-y-4">
    <div>
      <p class="font-medium text-sm">{{ t('hardcover.linkedBooks.title') }}</p>
      <p class="text-xs text-muted-foreground mt-0.5">
        {{ t('hardcover.linkedBooks.description') }}
      </p>
    </div>

    <div v-if="loading" role="status" class="flex items-center gap-2 text-xs text-muted-foreground py-4">
      <Loader2 class="size-3.5 animate-spin" />
      {{ t('hardcover.linkedBooks.loading') }}
    </div>

    <div v-else-if="loadError" role="alert" class="flex items-center gap-2 text-xs text-destructive py-2">
      <AlertCircle class="size-3.5 shrink-0" />
      {{ t('hardcover.linkedBooks.loadError') }}
      <button type="button" class="underline underline-offset-2" @click="handleRetryLoadBooks">{{ t('hardcover.linkedBooks.retry') }}</button>
    </div>

    <div v-else-if="books.length === 0" class="text-xs text-muted-foreground py-2">{{ t('hardcover.linkedBooks.empty') }}</div>

    <div v-else class="divide-y divide-border/60">
      <p v-if="booksTruncated" class="text-[11px] text-muted-foreground pb-2">
        {{ t('hardcover.linkedBooks.booksTruncated', { count: books.length }) }}
      </p>
      <div v-for="book in books" :key="book.bookId" class="py-2.5">
        <button
          type="button"
          class="flex w-full items-center justify-between gap-2 text-left"
          :aria-expanded="expandedBookId === book.bookId"
          :aria-controls="panelId(book.bookId)"
          @click="toggleExpanded(book.bookId)"
        >
          <div class="min-w-0">
            <p class="text-sm truncate">{{ book.title ?? t('hardcover.linkedBooks.untitled') }}</p>
            <p class="text-xs text-muted-foreground truncate">{{ book.authorName ?? t('hardcover.linkedBooks.unknownAuthor') }}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span
              class="flex items-center gap-1 text-xs"
              :class="book.matchError ? 'text-destructive' : book.hardcoverBookId ? 'text-success' : 'text-muted-foreground'"
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

        <div v-if="expandedBookId === book.bookId" :id="panelId(book.bookId)" class="mt-3 space-y-3 pl-1">
          <p v-if="!book.hardcoverBookId" class="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
            <HelpCircle class="size-3.5 shrink-0 mt-0.5" />
            {{ t('hardcover.linkedBooks.unmatchedHint') }}
          </p>

          <div v-else>
            <div v-if="editionsLoadError[book.bookId]" role="alert" class="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle class="size-3.5 shrink-0" />
              {{ t('hardcover.linkedBooks.editionsLoadError') }}
              <button
                type="button"
                :disabled="loadingEditions[book.bookId]"
                class="underline underline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed"
                @click="loadEditions(book)"
              >
                {{ t('hardcover.linkedBooks.retry') }}
              </button>
            </div>

            <button
              v-else-if="!editionsByBookId[book.bookId]"
              type="button"
              :disabled="loadingEditions[book.bookId]"
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              @click="loadEditions(book)"
            >
              <Loader2 v-if="loadingEditions[book.bookId]" class="size-3 animate-spin" />
              {{ t('hardcover.linkedBooks.viewEditions') }}
            </button>

            <div v-else class="space-y-1.5">
              <p v-if="editionsByBookId[book.bookId]!.length === 0" class="text-xs text-muted-foreground">
                {{ t('hardcover.linkedBooks.noEditionsFound') }}
              </p>
              <p v-if="editionsTruncated[book.bookId]" class="text-[11px] text-muted-foreground">
                {{ t('hardcover.linkedBooks.editionsTruncated', { count: editionsByBookId[book.bookId]!.length }) }}
              </p>
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
                      <span v-if="edition.pages" class="text-muted-foreground"
                        >· {{ t('hardcover.linkedBooks.pages', { count: edition.pages }) }}</span
                      >
                      <span v-if="edition.language" class="text-muted-foreground">· {{ edition.language }}</span>
                    </p>
                    <p class="text-[11px] text-muted-foreground break-words">
                      <span v-if="edition.publisher">{{ edition.publisher }}</span>
                      <span v-if="edition.publisher && edition.publishedDate"> · </span>
                      <span v-if="edition.publishedDate">{{ edition.publishedDate }}</span>
                      <span v-if="(edition.publisher || edition.publishedDate) && (edition.isbn13 || edition.isbn10)"> · </span>
                      <span v-if="edition.isbn13 || edition.isbn10">{{
                        t('hardcover.linkedBooks.isbn', { isbn: edition.isbn13 ?? edition.isbn10 })
                      }}</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  :disabled="settingEdition[book.bookId] || edition.id === book.hardcoverEditionId"
                  class="shrink-0 px-2 py-1 text-xs rounded-md border border-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  @click="handleSetEdition(book, edition)"
                >
                  {{ edition.id === book.hardcoverEditionId ? t('hardcover.linkedBooks.current') : t('hardcover.linkedBooks.useThis') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
