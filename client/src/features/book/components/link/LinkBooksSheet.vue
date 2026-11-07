<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Link2, Loader2 } from '@lucide/vue'
import { BOOK_LINK_MAX_MEMBERS, type BookCard, type BookLinkGroup } from '@bookorbit/types'
import { formatList } from '@/i18n/formatters'
import { bookFormatCodes } from '@/features/book/lib/book-formats'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useBookLinkActions } from '@/features/book/composables/useBookLinkActions'
import type { LinkSeedBook } from '@/features/book/lib/book-link'
import LinkBookPicker from './LinkBookPicker.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    /** The books to link, in order: the first becomes the main book of a new link. */
    bookIds: number[]
    /** Cards already loaded for those books, to name them. Books without one are counted only. */
    books?: BookCard[]
    /** Names for books without a card, such as those a blocked merge hands over. */
    seedBooks?: LinkSeedBook[]
    /** Searches every library for more books to add (the detail page entry point). */
    picker?: boolean
    /** Books the search never offers: the open book and those already linked with it. */
    excludeIds?: number[]
  }>(),
  { books: () => [], seedBooks: () => [], picker: false, excludeIds: () => [] },
)

const emit = defineEmits<{
  'update:open': [value: boolean]
  linked: [group: BookLinkGroup]
}>()

const { t } = useI18n()
const { libraries } = useLibraries()
const actions = useBookLinkActions()
const pickedIds = ref<number[]>([])

const requestIds = computed(() => [...new Set([...props.bookIds, ...pickedIds.value])])
const canConfirm = computed(() => requestIds.value.length >= 2 && requestIds.value.length <= BOOK_LINK_MAX_MEMBERS && !actions.pending.value)
// A count of one would name only the open book, so the label waits for a second one.
const confirmLabel = computed(() => {
  if (actions.pending.value) return t('book.link.linking')
  return requestIds.value.length >= 2 ? t('book.link.confirm', { count: requestIds.value.length }) : t('book.link.confirmEmpty')
})
const pickerExcluded = computed(() => [...new Set([...props.bookIds, ...props.excludeIds])])
const pickerMax = computed(() => Math.max(0, BOOK_LINK_MAX_MEMBERS - pickerExcluded.value.length))
const libraryNames = computed(() => new Map(libraries.value.map((library) => [library.id, library.name])))
interface ListedBook {
  id: number
  title: string | null
  libraryId: number | null
  formats: string
}

const listed = computed(() => {
  const cards = new Map(props.books.map((book) => [book.id, book]))
  const seeds = new Map(props.seedBooks.map((book) => [book.id, book]))
  return props.bookIds.flatMap((id): ListedBook[] => {
    const card = cards.get(id)
    if (card) return [{ id, title: card.title, libraryId: card.libraryId ?? null, formats: formatList(bookFormatCodes(card.files)) }]
    const seed = seeds.get(id)
    if (seed) return [{ id, title: seed.title, libraryId: seed.libraryId, formats: formatList(seed.formats.map((format) => format.toUpperCase())) }]
    return []
  })
})
const unlistedCount = computed(() => Math.max(0, props.bookIds.length - listed.value.length))

watch(
  () => props.open,
  (open) => {
    if (!open) return
    pickedIds.value = []
    actions.clearError()
  },
  { immediate: true },
)

function libraryName(book: ListedBook): string | null {
  return book.libraryId != null ? (libraryNames.value.get(book.libraryId) ?? null) : null
}

function handleOpenChange(open: boolean): void {
  emit('update:open', open)
}

function close(): void {
  emit('update:open', false)
}

function handlePickedChange(ids: number[]): void {
  pickedIds.value = ids
}

async function confirmLink(): Promise<void> {
  if (!canConfirm.value) return
  const group = await actions.link(requestIds.value)
  if (!group) return
  toast.success(t('book.link.toast.linked', { count: group.books.length }))
  emit('linked', group)
  close()
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent
      side="bottom"
      class="h-[100dvh] max-h-[100dvh] gap-0 p-0 sm:inset-x-0 sm:mx-auto sm:h-auto sm:max-h-[90dvh] sm:w-full sm:max-w-2xl sm:rounded-t-lg"
      data-testid="link-books-sheet"
    >
      <SheetHeader class="border-b border-border pe-12">
        <SheetTitle class="flex items-center gap-2">
          <Link2 :size="16" aria-hidden="true" />
          {{ t('book.link.title') }}
        </SheetTitle>
        <SheetDescription>{{ t('book.link.description') }}</SheetDescription>
      </SheetHeader>

      <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <LinkBookPicker
          v-if="picker"
          :exclude-ids="pickerExcluded"
          :model-value="pickedIds"
          :max="pickerMax"
          @update:model-value="handlePickedChange"
        />

        <template v-else>
          <p class="text-sm font-medium text-foreground">{{ t('book.link.selectedHeading', { count: bookIds.length }) }}</p>
          <ul v-if="listed.length > 0" class="space-y-1.5" data-testid="link-books-list">
            <li v-for="book in listed" :key="book.id" class="rounded-md border border-border px-2.5 py-2">
              <span class="block truncate text-sm font-medium text-foreground">{{ book.title || t('book.untitled') }}</span>
              <span class="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                <span v-if="libraryName(book)" dir="auto">{{ t('book.link.picker.library', { library: libraryName(book) }) }}</span>
                <span v-if="book.formats">{{ book.formats }}</span>
              </span>
            </li>
          </ul>
          <p v-if="unlistedCount > 0" class="text-xs text-muted-foreground">{{ t('book.link.notLoaded', { count: unlistedCount }) }}</p>
          <p class="text-xs text-muted-foreground">{{ t('book.link.mainHint') }}</p>
        </template>
      </div>

      <div class="space-y-2 border-t border-border bg-background px-4 py-3">
        <p v-if="actions.error.value" class="text-sm text-destructive" role="alert" data-testid="link-error">{{ actions.error.value }}</p>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" @click="close">{{ t('common.cancel') }}</Button>
          <Button :disabled="!canConfirm" data-testid="link-confirm" @click="confirmLink">
            <Loader2 v-if="actions.pending.value" :size="14" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ confirmLabel }}
          </Button>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
