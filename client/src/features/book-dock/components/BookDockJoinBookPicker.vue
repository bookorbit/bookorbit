<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Search } from '@lucide/vue'
import type { BookCard } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { Input } from '@/components/ui/input'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { useMergeBookPicker } from '@/features/book/composables/useMergeBookPicker'
import type { BookDockJoinChoice } from '../composables/useBookDockJoinChoices'

const props = defineProps<{
  /** The library the file is filed into; a join never crosses libraries. */
  libraryId: number
  fileName: string
}>()

const emit = defineEmits<{
  pick: [book: BookDockJoinChoice]
  cancel: []
}>()

const { t } = useI18n()
const picker = useMergeBookPicker()
const inputId = `book-dock-join-picker-${useId()}`
const hintId = `${inputId}-hint`
const searchField = ref<HTMLElement | null>(null)

const showEmpty = computed(
  () => picker.query.value.trim().length > 0 && !picker.searching.value && !picker.failed.value && picker.results.value.length === 0,
)
const showPrompt = computed(() => picker.query.value.trim().length === 0)

onMounted(() => {
  searchField.value?.querySelector('input')?.focus()
})

function handleInput(value: string | number): void {
  picker.search(props.libraryId, String(value))
}

function bookTitle(book: BookCard): string {
  return book.title || t('book.untitled')
}

function bookFormats(book: BookCard): string {
  return formatList([...new Set(book.files.map((file) => file.format?.toUpperCase()).filter((format): format is string => !!format))])
}

function pick(book: BookCard): void {
  emit('pick', { bookId: book.id, title: book.title })
}

function handleCancel(): void {
  emit('cancel')
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  emit('cancel')
}
</script>

<template>
  <div class="space-y-2.5 rounded-md border border-border bg-card p-2.5" data-testid="book-dock-join-picker" @keydown="handleKeydown">
    <p :id="hintId" class="text-xs text-muted-foreground">{{ t('bookDock.finalizeDialog.join.picker.hint', { file: fileName }) }}</p>

    <div class="space-y-1">
      <label :for="inputId" class="text-xs font-medium text-muted-foreground">{{ t('bookDock.finalizeDialog.join.picker.searchLabel') }}</label>
      <div ref="searchField" class="relative">
        <Search :size="14" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          :id="inputId"
          :model-value="picker.query.value"
          type="search"
          class="h-8 ps-9"
          autocomplete="off"
          :placeholder="t('bookDock.finalizeDialog.join.picker.searchPlaceholder')"
          :aria-describedby="hintId"
          @update:model-value="handleInput"
        />
      </div>
    </div>

    <div aria-live="polite">
      <p v-if="picker.searching.value" class="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 :size="12" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ t('common.loading') }}
      </p>
      <p v-else-if="picker.failed.value" class="text-xs text-destructive" role="alert">{{ t('bookDock.finalizeDialog.join.picker.failed') }}</p>
      <p v-else-if="showEmpty" class="text-xs text-muted-foreground">{{ t('bookDock.finalizeDialog.join.picker.empty') }}</p>
      <p v-else-if="showPrompt" class="text-xs text-muted-foreground">{{ t('bookDock.finalizeDialog.join.picker.prompt') }}</p>
    </div>

    <ul v-if="picker.results.value.length > 0" class="max-h-56 space-y-1 overflow-y-auto" data-testid="book-dock-join-picker-results">
      <li v-for="book in picker.results.value" :key="book.id">
        <button
          type="button"
          class="flex w-full items-center gap-2.5 rounded-md border border-border px-2 py-1.5 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('bookDock.finalizeDialog.join.picker.pick', { title: bookTitle(book) })"
          @click="pick(book)"
        >
          <span class="relative h-10 w-7 shrink-0 overflow-hidden rounded-xs bg-muted">
            <BookCoverImage v-if="book.hasCover" :book-id="book.id" :version="book.coverVersion" class="size-full object-cover" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-medium text-foreground">{{ bookTitle(book) }}</span>
            <span v-if="book.authors.length > 0" class="block truncate text-xs text-muted-foreground">{{ formatList(book.authors) }}</span>
            <span v-if="bookFormats(book)" class="block text-[0.7rem] text-muted-foreground">{{ bookFormats(book) }}</span>
          </span>
        </button>
      </li>
    </ul>

    <div class="flex justify-end">
      <button
        type="button"
        class="h-7 rounded-md px-2.5 text-xs text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleCancel"
      >
        {{ t('common.cancel') }}
      </button>
    </div>
  </div>
</template>
