<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, BookPlus, Layers } from '@lucide/vue'
import type { BookDockFinalizePreviewItem, BookDockJoinBook } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { joinErrorMessageKey, type BookDockJoinChoice } from '../composables/useBookDockJoinChoices'
import BookDockJoinBookPicker from './BookDockJoinBookPicker.vue'

const props = defineProps<{
  item: BookDockFinalizePreviewItem
  /** The book this file was asked to join, until the person files it as a new book again. */
  choice?: BookDockJoinChoice
  pickerOpen: boolean
}>()

const emit = defineEmits<{
  choose: [book: BookDockJoinChoice]
  clear: []
  openPicker: []
  closePicker: []
}>()

const { t } = useI18n()
const actions = ref<HTMLElement | null>(null)

const displayName = computed(() => props.item.newName ?? props.item.fileName)
/** Set once the preview confirmed the join; until then the choice itself is shown. */
const joined = computed(() => props.item.joinsBook ?? null)
const refusal = computed(() => (props.choice && props.item.errorCode ? props.item.errorCode : null))
const suggestion = computed(() => (!props.choice && props.item.canJoinBook ? (props.item.suggestedJoinBook ?? null) : null))
const canPick = computed(() => !props.choice && props.item.canJoinBook === true && props.item.libraryId !== undefined)
const choiceTitle = computed(() => joined.value?.title || props.choice?.title || t('book.untitled'))
const suggestionReason = computed(() => {
  const reason = suggestion.value?.reason
  if (reason === 'isbn') return t('bookDock.finalizeDialog.join.reason.isbn')
  if (reason === 'work_id') return t('bookDock.finalizeDialog.join.reason.workId')
  if (reason === 'title_author') return t('bookDock.finalizeDialog.join.reason.titleAuthor')
  return null
})

function titleOf(book: BookDockJoinBook): string {
  return book.title || t('book.untitled')
}

/** Keeps keyboard focus in the row when its actions are swapped out from under it. */
function focusActions(): void {
  void nextTick(() => actions.value?.querySelector<HTMLButtonElement>('button')?.focus())
}

function handleAccept(): void {
  const book = suggestion.value
  if (!book) return
  emit('choose', { bookId: book.bookId, title: book.title })
  focusActions()
}

function handlePick(book: BookDockJoinChoice): void {
  emit('choose', book)
  focusActions()
}

function handleClear(): void {
  emit('clear')
  focusActions()
}

function handleOpenPicker(): void {
  emit('openPicker')
}

function handleClosePicker(): void {
  emit('closePicker')
  focusActions()
}
</script>

<template>
  <div class="space-y-1.5 px-3 py-1.5 text-xs" data-testid="book-dock-finalize-row">
    <span class="block break-all font-mono font-medium text-foreground">{{ displayName }}</span>

    <div v-if="choice || suggestion || canPick" ref="actions" class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <template v-if="refusal">
        <span class="inline-flex min-w-0 items-start gap-1 text-destructive" role="alert">
          <AlertCircle class="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>{{ t(joinErrorMessageKey(refusal), { title: choiceTitle }) }}</span>
        </span>
      </template>
      <template v-else-if="choice">
        <span class="inline-flex min-w-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-primary">
          <Layers class="size-3 shrink-0" aria-hidden="true" />
          <span class="truncate">{{ t('bookDock.finalizeDialog.join.joins', { title: choiceTitle }) }}</span>
        </span>
        <span v-if="joined && joined.authors.length > 0" class="truncate text-muted-foreground">{{ formatList(joined.authors) }}</span>
      </template>
      <template v-else-if="suggestion">
        <span class="inline-flex min-w-0 items-center gap-1 text-muted-foreground">
          <Layers class="size-3 shrink-0" aria-hidden="true" />
          <span>{{ t('bookDock.finalizeDialog.join.suggested', { title: titleOf(suggestion) }) }}</span>
        </span>
        <span v-if="suggestionReason" class="text-muted-foreground">{{ suggestionReason }}</span>
      </template>

      <button
        v-if="choice"
        type="button"
        class="rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('bookDock.finalizeDialog.join.fileAsNewLabel', { file: item.fileName })"
        @click="handleClear"
      >
        {{ t('bookDock.finalizeDialog.join.fileAsNew') }}
      </button>
      <button
        v-if="suggestion"
        type="button"
        class="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('bookDock.finalizeDialog.join.acceptLabel', { file: item.fileName, title: titleOf(suggestion) })"
        @click="handleAccept"
      >
        {{ t('bookDock.finalizeDialog.join.accept') }}
      </button>
      <button
        v-if="canPick && !pickerOpen"
        type="button"
        class="inline-flex items-center gap-1 rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="t('bookDock.finalizeDialog.join.chooseLabel', { file: item.fileName })"
        @click="handleOpenPicker"
      >
        <BookPlus class="size-3 shrink-0" aria-hidden="true" />
        {{ suggestion ? t('bookDock.finalizeDialog.join.chooseAnother') : t('bookDock.finalizeDialog.join.choose') }}
      </button>
    </div>

    <BookDockJoinBookPicker
      v-if="pickerOpen && canPick && item.libraryId !== undefined"
      :library-id="item.libraryId"
      :file-name="item.fileName"
      @pick="handlePick"
      @cancel="handleClosePicker"
    />
  </div>
</template>
