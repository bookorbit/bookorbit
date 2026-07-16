<script setup lang="ts">
import { computed, ref } from 'vue'
import { BookOpen, ChevronDown, ChevronUp, ExternalLink, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { BookDuplicateCandidate, BookDuplicateGroup, BookDuplicateMatchReason, ReadStatus } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { formatDate, formatNumber } from '@/i18n/formatters'

const props = defineProps<{ group: BookDuplicateGroup }>()
const emit = defineEmits<{ resolve: [groupId: number, bookIds: number[]]; dismiss: [groupId: number] }>()
const { t } = useI18n()
const keeperId = ref<number | null>(null)
const discardIds = ref(new Set<number>())
const expanded = ref(false)

const canResolve = computed(() => keeperId.value !== null && discardIds.value.size > 0)

const reasonOrder: BookDuplicateMatchReason[] = ['file_hash', 'isbn', 'exact_metadata', 'fuzzy_metadata']
const sortedReasons = computed(() => [...props.group.reasons].sort((a, b) => reasonOrder.indexOf(a) - reasonOrder.indexOf(b)))

function handleKeeperChange(bookId: number): void {
  keeperId.value = bookId
  discardIds.value = new Set([...discardIds.value].filter(canDiscard))
}

function handleDiscardChange(bookId: number): void {
  if (!canDiscard(bookId)) return
  const next = new Set(discardIds.value)
  if (next.has(bookId)) next.delete(bookId)
  else next.add(bookId)
  discardIds.value = next
}

function canDiscard(bookId: number): boolean {
  if (keeperId.value === null || keeperId.value === bookId) return false
  return props.group.pairs.some(
    (pair) => (pair.bookIdA === keeperId.value && pair.bookIdB === bookId) || (pair.bookIdB === keeperId.value && pair.bookIdA === bookId),
  )
}

function discardLabel(bookId: number): string {
  if (keeperId.value === null) return t('tools.bookDuplicates.selectKeeperFirst')
  if (keeperId.value !== bookId && !canDiscard(bookId)) return t('tools.bookDuplicates.noDirectMatch')
  return t('tools.bookDuplicates.discardThis')
}

function handleResolve(): void {
  if (!canResolve.value) return
  emit('resolve', props.group.id, [...discardIds.value])
}

function handleDismiss(): void {
  emit('dismiss', props.group.id)
}

function handleToggleDetails(): void {
  expanded.value = !expanded.value
}

function reasonLabel(reason: BookDuplicateMatchReason): string {
  return t(`tools.bookDuplicates.reasons.${reason}`)
}

function authorLine(book: BookDuplicateCandidate): string {
  return book.authors.length > 0 ? book.authors.join(', ') : t('tools.bookDuplicates.unknownAuthor')
}

function formatLine(book: BookDuplicateCandidate): string {
  const formats = [...new Set(book.files.map((file) => file.format || t('tools.bookDuplicates.unknown')))]
  return formats.join(', ') || t('tools.bookDuplicates.unknown')
}

function primaryFile(book: BookDuplicateCandidate): BookDuplicateCandidate['files'][number] | null {
  return book.files[0] ?? null
}

function formatBytes(value: number | null): string {
  if (value === null) return t('tools.bookDuplicates.unknown')
  if (value < 1024) return `${formatNumber(value)} B`
  if (value < 1024 * 1024) return `${formatNumber(value / 1024, { maximumFractionDigits: 1 })} KB`
  if (value < 1024 * 1024 * 1024) return `${formatNumber(value / (1024 * 1024), { maximumFractionDigits: 1 })} MB`
  return `${formatNumber(value / (1024 * 1024 * 1024), { maximumFractionDigits: 1 })} GB`
}

function statusLabel(status: ReadStatus): string {
  const key = status.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
  return t(`book.readStatus.${key}`)
}

function bookTitle(bookId: number): string {
  return props.group.books.find((book) => book.id === bookId)?.title || t('book.untitled')
}
</script>

<template>
  <article class="rounded-lg border border-border bg-card shadow-sm">
    <header class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
      <div class="flex flex-wrap items-center gap-2">
        <span
          v-for="matchReason in sortedReasons"
          :key="matchReason"
          class="rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
        >
          {{ reasonLabel(matchReason) }}
        </span>
        <span v-if="group.maxTitleSimilarity !== null" class="text-xs text-muted-foreground">
          {{ t('tools.bookDuplicates.similarityValue', { percent: formatNumber(group.maxTitleSimilarity * 100, { maximumFractionDigits: 0 }) }) }}
        </span>
      </div>
      <Button variant="ghost" size="sm" @click="handleDismiss">
        <X aria-hidden="true" />
        {{ t('tools.bookDuplicates.notDuplicates') }}
      </Button>
    </header>

    <div class="grid gap-3 p-4 lg:grid-cols-2">
      <section
        v-for="book in group.books"
        :key="book.id"
        class="rounded-md border border-border bg-background/60 p-3"
        :class="keeperId === book.id ? 'ring-2 ring-primary/60' : ''"
      >
        <div class="flex gap-3">
          <div class="flex h-28 w-20 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-muted">
            <BookCoverImage v-if="book.hasCover" :book-id="book.id" class="h-full w-full object-cover" alt="" />
            <BookOpen v-else class="size-8 text-muted-foreground" aria-hidden="true" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <h3 class="font-semibold text-foreground">{{ book.title || t('book.untitled') }}</h3>
                <p class="truncate text-sm text-muted-foreground">{{ authorLine(book) }}</p>
              </div>
              <RouterLink
                :to="{ name: 'book-detail', params: { bookId: book.id } }"
                class="rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="t('tools.bookDuplicates.openBook', { title: book.title || t('book.untitled') })"
              >
                <ExternalLink class="size-4" aria-hidden="true" />
              </RouterLink>
            </div>
            <dl class="mt-2 space-y-1 text-xs text-muted-foreground">
              <div class="flex gap-1">
                <dt class="font-medium text-foreground">{{ t('tools.bookDuplicates.fields.library') }}:</dt>
                <dd>{{ book.libraryName }}</dd>
              </div>
              <div class="flex gap-1">
                <dt class="font-medium text-foreground">{{ t('tools.bookDuplicates.fields.formats') }}:</dt>
                <dd>{{ formatLine(book) }}</dd>
              </div>
              <div class="flex min-w-0 gap-1">
                <dt class="shrink-0 font-medium text-foreground">{{ t('tools.bookDuplicates.fields.fileLocation') }}:</dt>
                <dd class="flex min-w-0 gap-1.5">
                  <span class="truncate" :title="primaryFile(book)?.path || book.folderPath || t('tools.bookDuplicates.unknown')">
                    {{ primaryFile(book)?.path || book.folderPath || t('tools.bookDuplicates.unknown') }}
                  </span>
                  <span v-if="primaryFile(book)?.sizeBytes !== null && primaryFile(book)?.sizeBytes !== undefined" class="shrink-0">
                    ({{ formatBytes(primaryFile(book)?.sizeBytes ?? null) }})
                  </span>
                  <span v-if="book.files.length > 1" class="shrink-0">{{
                    t('tools.bookDuplicates.moreFiles', { count: book.files.length - 1 })
                  }}</span>
                </dd>
              </div>
              <div v-if="book.isbn13 || book.isbn10" class="flex gap-1">
                <dt class="font-medium text-foreground">{{ t('tools.bookDuplicates.fields.isbn') }}:</dt>
                <dd>{{ book.isbn13 || book.isbn10 }}</dd>
              </div>
              <div v-if="book.readStatus" class="flex gap-1">
                <dt class="font-medium text-foreground">{{ t('tools.bookDuplicates.fields.readingStatus') }}:</dt>
                <dd>{{ statusLabel(book.readStatus.status) }}</dd>
              </div>
              <div v-if="book.readingProgress !== null" class="flex gap-1">
                <dt class="font-medium text-foreground">{{ t('tools.bookDuplicates.fields.progress') }}:</dt>
                <dd>{{ formatNumber(book.readingProgress / 100, { style: 'percent', maximumFractionDigits: 0 }) }}</dd>
              </div>
            </dl>
          </div>
        </div>

        <div class="mt-3 grid gap-2 sm:grid-cols-2">
          <label
            class="flex cursor-pointer items-center gap-2 rounded border border-border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring"
          >
            <input type="radio" :name="`keeper-${group.id}`" :checked="keeperId === book.id" @change="handleKeeperChange(book.id)" />
            {{ t('tools.bookDuplicates.keepThis') }}
          </label>
          <label
            class="flex items-center gap-2 rounded border border-border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring"
            :class="canDiscard(book.id) ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'"
          >
            <input type="checkbox" :checked="discardIds.has(book.id)" :disabled="!canDiscard(book.id)" @change="handleDiscardChange(book.id)" />
            {{ discardLabel(book.id) }}
          </label>
        </div>

        <div v-if="expanded" class="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <dl class="space-y-1.5">
            <div>
              <dt class="font-medium text-foreground">{{ t('tools.bookDuplicates.fields.files') }}</dt>
              <dd>
                <ul class="mt-1 space-y-1">
                  <li v-for="file in book.files" :key="file.id" class="flex flex-wrap gap-x-2">
                    <span class="font-medium text-foreground">{{ file.format || t('tools.bookDuplicates.unknown') }}</span>
                    <span>{{ formatBytes(file.sizeBytes) }}</span>
                    <span class="basis-full break-all">{{ file.path || t('tools.bookDuplicates.unknown') }}</span>
                  </li>
                </ul>
              </dd>
            </div>
            <div>
              <dt class="font-medium text-foreground">{{ t('tools.bookDuplicates.fields.collections') }}</dt>
              <dd>{{ book.collections.map((collection) => collection.name).join(', ') || t('tools.bookDuplicates.none') }}</dd>
            </div>
            <div>
              <dt class="font-medium text-foreground">{{ t('tools.bookDuplicates.fields.added') }}</dt>
              <dd>{{ formatDate(new Date(book.addedAt)) }}</dd>
            </div>
            <div v-if="book.updatedAt">
              <dt class="font-medium text-foreground">{{ t('tools.bookDuplicates.fields.updated') }}</dt>
              <dd>{{ formatDate(new Date(book.updatedAt)) }}</dd>
            </div>
          </dl>
        </div>
      </section>
    </div>

    <div v-if="expanded" class="border-t border-border px-4 py-3 text-xs text-muted-foreground">
      <p class="font-medium text-foreground">{{ t('tools.bookDuplicates.pairDetails') }}</p>
      <ul class="mt-1.5 space-y-1">
        <li v-for="pair in group.pairs" :key="`${pair.bookIdA}-${pair.bookIdB}`">
          {{ t('tools.bookDuplicates.pairLabel', { first: bookTitle(pair.bookIdA), second: bookTitle(pair.bookIdB) }) }}:
          {{ pair.reasons.map(reasonLabel).join(', ') }}
        </li>
      </ul>
    </div>

    <footer class="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
      <Button variant="ghost" size="sm" @click="handleToggleDetails">
        <ChevronUp v-if="expanded" aria-hidden="true" />
        <ChevronDown v-else aria-hidden="true" />
        {{ expanded ? t('tools.bookDuplicates.hideDetails') : t('tools.bookDuplicates.showDetails') }}
      </Button>
      <Button variant="destructive" :disabled="!canResolve" @click="handleResolve">
        {{ t('tools.bookDuplicates.deleteSelected', { count: discardIds.size }, discardIds.size) }}
      </Button>
    </footer>
  </article>
</template>
