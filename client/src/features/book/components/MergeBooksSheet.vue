<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { FolderInput } from '@lucide/vue'

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import type { BookSelectionPayload } from '@bookorbit/types'

import { useMergeBooks } from '../composables/useMergeBooks'
import { useBookDetail } from '@/features/book/composables/useBookDetail'

const props = defineProps<{
  open: boolean
  selectionPayload: BookSelectionPayload
  selectedCount: number
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  merged: []
}>()

const { t } = useI18n()
const merge = useMergeBooks()
const merging = ref(false)

async function handleMerge(): Promise<void> {
  if (merging.value) return
  if (!selectedBookIds.value.length) {
    toast.error(t('book.merge.errors.not2books'))
    return
  }
  if (hasDifferentLibraries.value) {
    toast.error(t('book.merge.errors.differentLibraries'))
    return
  }
  if (targetBookId.value == null || !selectedBookIds.value.includes(targetBookId.value)) {
    toast.error(t('book.merge.errors.notarget'))
    return
  }

  merging.value = true
  try {
    const result = await merge.mergeBooks(selectedBookIds.value, targetBookId.value)
    toast.success(
      t('book.merge.toast.success', {
        count: result?.merged ?? selectedBookIds.value.length,
        target: targetBookId.value,
      }),
    )
    emit('merged')
    emit('update:open', false)
  } catch {
    toast.error(t('book.merge.errors.common'))
  } finally {
    merging.value = false
  }
}

function handleOpenChange(value: boolean): void {
  emit('update:open', value)
}

function handleClose(): void {
  emit('update:open', false)
}

const targetBookId = ref<number | null>(null)

const selectedBookIds = computed(() => {
  if ('query' in props.selectionPayload && props.selectionPayload.query) {
    return []
  }
  if ('bookIds' in props.selectionPayload && props.selectionPayload.bookIds) {
    return props.selectionPayload.bookIds
  }
  return []
})

const isQuerySelectionActive = computed(() => {
  return 'query' in props.selectionPayload && !!props.selectionPayload.query
})

type BookMeta = {
  id: number
  title: string
  formats: string[]
  libraryId: number
}

const bookArray = ref<BookMeta[]>([])
let bookArrayLoadId = 0

async function loadBookMeta(bookId: number): Promise<BookMeta> {
  const bookState = useBookDetail()
  await bookState.fetch(bookId)

  const formats = [...new Set((bookState.detail.value?.files ?? []).map((file) => file.format).filter((format): format is string => Boolean(format)))]
  return {
    id: bookId,
    title: bookState.detail.value?.title ?? t('book.merge.untitled'),
    formats,
    libraryId: bookState.detail.value?.libraryId ?? -1,
  }
}

const hasDifferentLibraries = computed(() => {
  const libraryIds = new Set(bookArray.value.map((book) => book.libraryId).filter((libraryId) => libraryId > 0))
  return libraryIds.size > 1
})

const canMerge = computed(() => {
  if (isQuerySelectionActive.value) return false

  return selectedBookIds.value.length >= 2 && bookArray.value.length === selectedBookIds.value.length && !hasDifferentLibraries.value
})

watch(
  [() => props.open, selectedBookIds],
  async ([isOpen, ids]) => {
    const loadId = ++bookArrayLoadId
    bookArray.value = []
    if (isOpen) {
      targetBookId.value = null
    }
    if (!isOpen || !ids.length) return

    const books = await Promise.all(ids.map(loadBookMeta))
    if (loadId === bookArrayLoadId) bookArray.value = books
  },
  { deep: true, immediate: false },
)
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent
      side="bottom"
      class="max-h-[85vh] overflow-y-auto sm:inset-x-auto sm:right-auto sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-lg sm:rounded-t-lg"
    >
      <SheetHeader>
        <SheetTitle class="flex items-center gap-2">
          <FolderInput :size="16" />
          {{ t('book.merge.title', { count: selectedCount }) }}
        </SheetTitle>
        <SheetDescription>
          {{ t('book.merge.description') }}
        </SheetDescription>
      </SheetHeader>
      <div class="px-4 pb-4 space-y-4">
        <div v-if="bookArray.length > 1" class="space-y-2">
          <p class="text-xs font-medium text-muted-foreground">{{ t('book.merge.subtitle') }}</p>
          <ul class="space-y-2">
            <li v-for="book in bookArray" :key="book.id" class="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
              <input
                :id="`book-${book.id}`"
                v-model="targetBookId"
                type="radio"
                :value="book.id"
                name="selected-book-id"
                class="h-4 w-4 accent-primary"
              />
              <label :for="`book-${book.id}`" class="text-sm text-foreground">
                {{ book.id }} - {{ book.title }}
                <span v-if="book.formats.length" class="text-xs text-muted-foreground"> ({{ book.formats.join(', ') }}) </span>
              </label>
            </li>
          </ul>
        </div>
        <p v-if="hasDifferentLibraries" class="text-sm text-destructive">
          {{ t('book.merge.errors.differentLibraries') }}
        </p>
        <p v-if="isQuerySelectionActive" class="text-sm text-yellow-600/90 mt-2">
          {{ t('book.merge.errors.querySelection') }}
        </p>
        <div class="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" @click="handleClose">{{ t('common.cancel') }}</Button>
          <Button :disabled="!canMerge || merging.value" @click="handleMerge">
            {{ t('book.merge.mergeBtn') }}
          </Button>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
