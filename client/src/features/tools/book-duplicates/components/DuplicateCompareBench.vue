<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementSize } from '@vueuse/core'
import { Check } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { BookDuplicateGroup } from '@bookorbit/types'

import { differingFields, largestCopyId, bestMetadataId, rankedReasons, sharedFields, type DuplicateField } from '../utils/duplicate-diff'
import { copyFolderLabel } from '../utils/duplicate-keeper'
import DuplicateConfidenceChip from './DuplicateConfidenceChip.vue'
import DuplicateCopyCard from './DuplicateCopyCard.vue'
import DuplicateFieldValue from './DuplicateFieldValue.vue'
import DuplicatePathDiff from './DuplicatePathDiff.vue'

const props = defineProps<{ group: BookDuplicateGroup; keeperId: number; recommendedId: number }>()
const emit = defineEmits<{ keep: [bookId: number] }>()

const { t } = useI18n()

const root = ref<HTMLElement | null>(null)
const { width } = useElementSize(root)
/**
 * The bench reflows on its own width, not the window's: it is rendered both full width and inside
 * an expanded ledger row, and a collapsed sidebar makes a 1440 window as roomy as a 1700 one.
 * Below this the column-per-copy comparison stops fitting and each copy states its own values.
 */
const stacked = computed(() => width.value > 0 && width.value < 640)

const books = computed(() => props.group.books)
const paths = computed(() => books.value.map((book) => book.files[0]?.path ?? book.folderPath ?? ''))
const differing = computed(() => differingFields(books.value))
/** A field every copy lacks says nothing about the choice, so it stays out of the summary. */
const shared = computed(() => sharedFields(books.value).filter((field) => !isEmptyEverywhere(field)))

function isEmptyEverywhere(field: DuplicateField): boolean {
  const book = books.value[0]
  if (!book) return true
  if (field === 'isbn') return !book.isbn13 && !book.isbn10
  if (field === 'reading') return book.readingProgress === null || book.readingProgress === 0
  if (field === 'collections') return book.collections.length === 0
  return false
}
const biggest = computed(() => largestCopyId(books.value))
const bestMetadata = computed(() => bestMetadataId(books.value))
const pairs = computed(() => props.group.pairs)

function isWinner(bookId: number, field: string): boolean {
  if (field === 'size') return biggest.value === bookId
  if (field === 'metadata') return bestMetadata.value === bookId
  return false
}

function bookById(bookId: number) {
  return books.value.find((book) => book.id === bookId)
}

function pairLabel(bookId: number): string {
  const book = bookById(bookId)
  return book ? copyFolderLabel(book) || book.title || t('book.untitled') : t('book.untitled')
}

function fieldLabel(field: string): string {
  return t(`tools.bookDuplicates.fields.${field}`)
}

function handleKeep(bookId: number): void {
  emit('keep', bookId)
}
</script>

<template>
  <div ref="root" class="duplicate-bench flex flex-col gap-3">
    <!-- Column per copy: the card sits on top of the values it describes. -->
    <table v-if="!stacked" class="w-full max-w-[1180px] table-fixed border-collapse text-[12.5px]">
      <caption class="sr-only">
        {{
          t('tools.bookDuplicates.compareCaption', { count: books.length })
        }}
      </caption>
      <thead>
        <tr>
          <th class="w-[104px]" scope="col">
            <span class="sr-only">{{ t('tools.bookDuplicates.fieldColumn') }}</span>
          </th>
          <th v-for="(book, index) in books" :key="book.id" class="p-1 pb-2.5 text-start align-top" scope="col">
            <DuplicateCopyCard
              :book="book"
              :group-id="group.id"
              :index="index"
              :keeper="book.id === keeperId"
              :recommended="book.id === recommendedId"
              @keep="handleKeep"
            />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="field in differing" :key="field">
          <th
            class="border-t border-border/65 py-1.5 pe-2 text-start align-middle text-[10.5px] font-bold tracking-wide uppercase text-muted-foreground"
            scope="row"
          >
            {{ fieldLabel(field) }}
          </th>
          <td
            v-for="book in books"
            :key="book.id"
            class="border-t border-border/65 px-2 py-1.5 align-middle"
            :class="book.id === keeperId ? 'bg-primary/5' : ''"
          >
            <DuplicateFieldValue :book="book" :field="field" :winner="isWinner(book.id, field)" />
          </td>
        </tr>
        <tr>
          <th
            class="border-t border-border/65 py-1.5 pe-2 text-start align-top text-[10.5px] font-bold tracking-wide uppercase text-muted-foreground"
            scope="row"
          >
            {{ t('tools.bookDuplicates.fields.folder') }}
          </th>
          <td
            v-for="(book, index) in books"
            :key="book.id"
            class="border-t border-border/65 px-2 py-1.5 align-top"
            :class="book.id === keeperId ? 'bg-primary/5' : ''"
          >
            <DuplicatePathDiff :path="paths[index] ?? ''" :others="paths" />
            <span v-if="book.files.length > 1" class="mt-0.5 block text-[11px] text-muted-foreground">
              {{ t('tools.bookDuplicates.moreFilesCount', { count: book.files.length - 1 }, book.files.length - 1) }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Narrow: one card per copy, each stating its own differing values. -->
    <div v-else class="flex flex-col gap-2.5">
      <DuplicateCopyCard
        v-for="(book, index) in books"
        :key="book.id"
        :book="book"
        :group-id="group.id"
        :index="index"
        :keeper="book.id === keeperId"
        :recommended="book.id === recommendedId"
        @keep="handleKeep"
      >
        <dl class="mt-0.5 grid gap-0">
          <div v-for="field in differing" :key="field" class="flex items-center justify-between gap-3 border-t border-border/60 py-1">
            <dt class="shrink-0 text-[10.5px] font-bold tracking-wide uppercase text-muted-foreground">{{ fieldLabel(field) }}</dt>
            <dd class="min-w-0 text-end text-[12px]">
              <DuplicateFieldValue :book="book" :field="field" :winner="isWinner(book.id, field)" />
            </dd>
          </div>
          <div class="border-t border-border/60 py-1">
            <dt class="text-[10.5px] font-bold tracking-wide uppercase text-muted-foreground">{{ t('tools.bookDuplicates.fields.folder') }}</dt>
            <dd class="mt-0.5"><DuplicatePathDiff :path="paths[index] ?? ''" :others="paths" /></dd>
          </div>
        </dl>
      </DuplicateCopyCard>
    </div>

    <p
      v-if="shared.length > 0"
      class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-secondary px-3 py-2 text-[12px] text-muted-foreground"
    >
      <Check class="size-3.5 text-[var(--pill-success)]" aria-hidden="true" />
      <span class="font-semibold text-foreground">{{ t('tools.bookDuplicates.identicalAcross', { count: books.length }, books.length) }}</span>
      <span v-for="field in shared" :key="field" class="inline-flex items-center gap-1">
        <span>{{ fieldLabel(field).toLocaleLowerCase() }}</span>
        <DuplicateFieldValue :book="books[0]!" :field="field" />
      </span>
    </p>

    <section v-if="pairs.length > 0">
      <h3 class="mb-1.5 text-[10.5px] font-bold tracking-wide uppercase text-muted-foreground">{{ t('tools.bookDuplicates.pairDetails') }}</h3>
      <ul class="grid gap-1">
        <li
          v-for="pair in pairs"
          :key="`${pair.bookIdA}-${pair.bookIdB}`"
          class="flex flex-wrap items-center gap-2 rounded-lg bg-secondary px-2.5 py-1.5 text-[12px]"
        >
          <span class="min-w-0 text-foreground">
            {{ t('tools.bookDuplicates.pairLabel', { first: pairLabel(pair.bookIdA), second: pairLabel(pair.bookIdB) }) }}
          </span>
          <span class="ms-auto flex flex-wrap gap-1.5">
            <DuplicateConfidenceChip
              v-for="reason in rankedReasons(pair.reasons)"
              :key="reason"
              :reason="reason"
              :similarity="pair.titleSimilarity"
              quiet
            />
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
