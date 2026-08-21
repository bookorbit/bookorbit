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

async function handleMerge(): Promise<void> {
  if (!selectedBookIds.value.length) {
    toast.error(t('book.merge.errors.not2books'))
    return
  }
  if (targetBookId.value == null) {
    toast.error(t('book.merge.errors.notarget'))
    return
  }

  try {
    const result = await merge.mergeBooks(selectedBookIds.value, targetBookId.value)
    toast.success(
      t('book.merge.toast.success', {
        count: result?.merged ?? selectedBookIds.value.length,
        target: result?.targetTitle ?? targetBookId.value,
      }),
    )
    emit('merged')
    emit('update:open', false)
  } catch (error) {
    const message = error instanceof Error ? error.message : t('book.merge.errors.common')
    toast.error(t(message))
  }
}

function handleClose(): void {
  emit('update:open', false)
}

const targetBookId = ref<number | null>(null)

const selectedBookIds = computed(() => {
  if ('bookIds' in props.selectionPayload && props.selectionPayload.bookIds) {
    return props.selectionPayload.bookIds
  }
  return []
})

type BookMeta = {
  id: number
  title: string
  formats: string[]
}

const bookArray = ref<BookMeta[]>([])

async function loadBookMeta(bookId: number): Promise<BookMeta> {
  const bookState = useBookDetail()
  await bookState.fetch(bookId)

  const formats = [...new Set((bookState.detail.value?.files ?? []).map((file) => file.format).filter((format): format is string => Boolean(format)))]
  return {
    id: bookId,
    title: bookState.detail.value?.title ?? 'Untitled',
    formats,
  }
}

watch(
  selectedBookIds,
  async (ids) => {
    if (!ids.length) {
      bookArray.value = []
      return
    }
    bookArray.value = await Promise.all(ids.map(loadBookMeta))
  },
  { immediate: true },
)
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
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
        <div class="flex items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" @click="handleClose">{{ t('common.cancel') }}</Button>
          <Button @click="handleMerge">
            {{ t('book.merge.mergeBtn') }}
          </Button>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
