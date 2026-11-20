<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { FileText, Loader2, Search } from '@lucide/vue'
import type { BookCard, BookDockFile } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { formatBytes } from '@/lib/formatting'
import { useFulfilmentPicker, type FulfilmentSource } from '../composables/useFulfilmentPicker'

const props = defineProps<{
  open: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  fulfil: [payload: { matchedBookId?: number; bookDockFileId?: number }]
  cancel: []
}>()

const { t } = useI18n()
const picker = useFulfilmentPicker()

const results = computed(() => (picker.source.value === 'book' ? picker.books.value : picker.dockFiles.value))
const hasSearched = computed(() => picker.query.value.trim() !== '')

/** Every opening starts from nothing: a choice made for one request must not close another. */
watch(
  () => props.open,
  (open) => {
    if (open) picker.reset()
  },
)

function handleOpenChange(open: boolean) {
  if (!open && !props.busy) emit('cancel')
}

function handleCancel() {
  if (!props.busy) emit('cancel')
}

function handleConfirm() {
  const payload = picker.toPayload()
  if (payload) emit('fulfil', payload)
}

function handleQuery(event: Event) {
  picker.search((event.target as HTMLInputElement).value)
}

function selectBookSource() {
  picker.setSource('book' satisfies FulfilmentSource)
}

function selectDockSource() {
  picker.setSource('dockFile' satisfies FulfilmentSource)
}

function selectBook(book: BookCard) {
  picker.select({ source: 'book', id: book.id })
}

function selectDockFile(file: BookDockFile) {
  picker.select({ source: 'dockFile', id: file.id })
}

function dockFileMeta(file: BookDockFile): string {
  return [file.format?.toUpperCase(), file.fileSize === null ? null : formatBytes(file.fileSize)].filter(Boolean).join(' · ')
}
</script>

<template>
  <DialogRoot :open="open" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed top-1/2 left-1/2 z-[70] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-card p-5 shadow-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <DialogTitle class="text-[17px] font-semibold text-foreground">{{ t('bookRequests.detail.fulfilTitle') }}</DialogTitle>
        <DialogDescription class="mt-1.5 text-sm text-muted-foreground">{{ t('bookRequests.detail.fulfilHint') }}</DialogDescription>

        <div
          class="mt-4 inline-flex gap-0.5 self-start rounded-lg border border-border bg-muted p-0.5"
          role="group"
          :aria-label="t('bookRequests.detail.fulfilSourceLabel')"
        >
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
            :class="picker.source.value === 'book' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="picker.source.value === 'book'"
            @click="selectBookSource"
          >
            {{ t('bookRequests.detail.fulfilFromLibrary') }}
          </button>
          <button
            type="button"
            class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
            :class="picker.source.value === 'dockFile' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
            :aria-pressed="picker.source.value === 'dockFile'"
            @click="selectDockSource"
          >
            {{ t('bookRequests.detail.fulfilFromDock') }}
          </button>
        </div>

        <div class="relative mt-3">
          <Search :size="15" class="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <label for="fulfil-search" class="sr-only">{{ t('bookRequests.detail.fulfilSearchLabel') }}</label>
          <input
            id="fulfil-search"
            type="search"
            :value="picker.query.value"
            class="h-9 w-full rounded-md border border-input bg-background ps-9 pe-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            :placeholder="picker.source.value === 'book' ? t('bookRequests.detail.fulfilSearchBooks') : t('bookRequests.detail.fulfilSearchDock')"
            @input="handleQuery"
          />
        </div>

        <div class="mt-3 min-h-0 flex-1 overflow-y-auto">
          <p v-if="picker.searching.value" role="status" class="text-sm text-muted-foreground">{{ t('bookRequests.detail.fulfilSearching') }}</p>

          <p v-else-if="hasSearched && results.length === 0" role="status" class="text-sm text-muted-foreground">
            {{ t('bookRequests.detail.fulfilNoResults') }}
          </p>

          <ul v-else-if="picker.source.value === 'book' && picker.books.value.length" class="grid gap-1.5">
            <li v-for="book in picker.books.value" :key="book.id">
              <button
                type="button"
                class="flex w-full items-center gap-2.5 rounded-md border p-2 text-start transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                :class="
                  picker.isSelected({ source: 'book', id: book.id }) ? 'border-primary bg-primary/8' : 'border-border bg-card hover:border-ring/50'
                "
                :aria-pressed="picker.isSelected({ source: 'book', id: book.id })"
                @click="selectBook(book)"
              >
                <BookCoverImage
                  :book-id="book.id"
                  type="thumbnail"
                  :version="book.updatedAt"
                  class="h-[42px] w-7 shrink-0 rounded-xs bg-muted object-cover"
                  :alt="''"
                />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium [overflow-wrap:anywhere] text-foreground">{{ book.title }}</span>
                  <span class="block text-xs text-muted-foreground">{{ book.authors.join(', ') }}</span>
                </span>
              </button>
            </li>
          </ul>

          <ul v-else-if="picker.source.value === 'dockFile' && picker.dockFiles.value.length" class="grid gap-1.5">
            <li v-for="file in picker.dockFiles.value" :key="file.id">
              <button
                type="button"
                class="flex w-full items-center gap-2.5 rounded-md border p-2 text-start transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                :class="
                  picker.isSelected({ source: 'dockFile', id: file.id })
                    ? 'border-primary bg-primary/8'
                    : 'border-border bg-card hover:border-ring/50'
                "
                :aria-pressed="picker.isSelected({ source: 'dockFile', id: file.id })"
                @click="selectDockFile(file)"
              >
                <FileText :size="16" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-medium [overflow-wrap:anywhere] text-foreground">{{ file.fileName }}</span>
                  <span class="block text-xs text-muted-foreground">{{ dockFileMeta(file) }}</span>
                </span>
              </button>
            </li>
          </ul>
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <Button variant="outline" :disabled="busy" @click="handleCancel">{{ t('common.cancel') }}</Button>
          <Button :disabled="busy || picker.selected.value === null" @click="handleConfirm">
            <Loader2 v-if="busy" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ t('bookRequests.actions.markFulfilled') }}
          </Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
