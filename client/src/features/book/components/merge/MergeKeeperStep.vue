<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, FolderOpen } from '@lucide/vue'
import type { BookMergeBookSummary, BookMergePreviewResponse } from '@bookorbit/types'
import { formatDate, formatList } from '@/i18n/formatters'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { filledFieldCount, mergeDestinationLibraryId, mergeSpansLibraries } from '@/features/book/lib/book-merge'

const props = defineProps<{
  preview: BookMergePreviewResponse
  keeperId: number
  bookLabels: Map<number, string>
  libraryNames: Map<number, string>
}>()

const emit = defineEmits<{
  'select-keeper': [bookId: number]
  'select-destination': [bookId: number]
}>()

const { t } = useI18n()
const groupName = `merge-keeper-${useId()}`
const destinationGroupName = `merge-destination-${useId()}`
const destinationOpen = ref(false)
const brokenCovers = ref(new Set<number>())

const keeper = computed(() => props.preview.books.find((book) => book.id === props.keeperId) ?? null)
const destinationBook = computed(() => props.preview.books.find((book) => book.id === props.preview.destinationBookId) ?? null)
const destinationChoices = computed(() => props.preview.books.filter((book) => props.preview.destinationCandidates.includes(book.id)))
/** A root-level kept book cannot hold the files, so where they go has to be shown and choosable (A9). */
const keeperRootLevel = computed(() => keeper.value !== null && !keeper.value.canBeDestination)
/** A10: every book is a root-level file, so the server wraps the kept book into a new folder. */
const newFolderRelPath = computed(() => props.preview.newFolderRelPath ?? null)
const showDestinationChooser = computed(() => destinationChoices.value.length > 1 && (keeperRootLevel.value || destinationOpen.value))

/**
 * Across libraries the destination decides which library holds the merged book, so it is always
 * on screen as its own choice, apart from which book's details are kept (section 3.2).
 */
const spansLibraries = computed(() => mergeSpansLibraries(props.preview))
const libraryDestination = computed(() => spansLibraries.value && newFolderRelPath.value === null)
const libraryCards = computed(() => {
  if (destinationChoices.value.length > 0) return destinationChoices.value
  return destinationBook.value ? [destinationBook.value] : []
})
/** One place only: said as a statement, not offered as a lone radio button. */
const singleLibraryCard = computed(() => libraryCards.value.length === 1)
const accessLoss = computed(() => new Map((props.preview.destinationAccessLoss ?? []).map((entry) => [entry.bookId, entry])))
const newFolderLibrary = computed(() => {
  if (!spansLibraries.value || newFolderRelPath.value === null) return null
  const id = mergeDestinationLibraryId(props.preview)
  return id !== null ? libraryName(id) : null
})

function libraryName(libraryId: number): string {
  return props.libraryNames.get(libraryId) ?? t('book.merge.crossLibrary.unknownLibrary')
}

/** The other libraries the books are in now: the ones that stop showing the book with this choice. */
function otherLibraryNames(book: BookMergeBookSummary): string[] {
  const ids = [...new Set(props.preview.books.map((entry) => entry.libraryId))].filter((id) => id !== book.libraryId)
  return ids.map(libraryName)
}

function formatsHere(book: BookMergeBookSummary): string | null {
  if (book.formats.length === 0) return null
  return t('book.merge.crossLibrary.destination.formatsHere', { formats: formatList(book.formats.map((format) => format.toUpperCase())) })
}

function consequence(book: BookMergeBookSummary): string | null {
  const others = otherLibraryNames(book)
  if (others.length === 0) return null
  return t('book.merge.crossLibrary.destination.leaves', { count: others.length, libraries: formatList(others) })
}

function accessBadge(book: BookMergeBookSummary): string | null {
  const entry = accessLoss.value.get(book.id)
  if (!entry?.losesAccess) return null
  const library = libraryName(entry.libraryId)
  if (entry.count === null) return t('book.merge.crossLibrary.destination.accessSome', { library })
  return t('book.merge.crossLibrary.destination.accessCount', { count: entry.count, from: formatList(otherLibraryNames(book)), library })
}

function folderLabel(book: BookMergeBookSummary): string {
  return book.folderRelPath ?? t('book.merge.keeper.folderRoot')
}

function activityLabels(book: BookMergeBookSummary): string[] {
  const activity = book.activity
  if (!activity) return []
  const labels: string[] = []
  if (activity.readers !== null && activity.readers > 0) labels.push(t('book.merge.keeper.activity.readers', { count: activity.readers }))
  else if (activity.hasProgress) labels.push(t('book.merge.keeper.activity.yourProgress'))
  if (activity.highlights > 0) labels.push(t('book.merge.keeper.activity.highlights', { count: activity.highlights }))
  if (activity.shelves > 0) labels.push(t('book.merge.keeper.activity.shelves', { count: activity.shelves }))
  return labels
}

/** The books sit in more than one library folder, so name the one that receives the files. */
const destinationRootName = computed(() => {
  const roots = new Set(props.preview.books.map((book) => book.libraryFolderId).filter((id): id is number => id !== undefined))
  if (roots.size < 2) return null
  return destinationBook.value?.libraryFolderName ?? null
})

function filledLabel(book: BookMergeBookSummary): string {
  return t('book.merge.keeper.filled', { filled: filledFieldCount(props.preview.fields, book.id), total: props.preview.fields.length })
}

function addedLabel(book: BookMergeBookSummary): string | null {
  if (!book.addedAt) return null
  return t('book.merge.keeper.added', { date: formatDate(new Date(book.addedAt), { year: 'numeric', month: 'short', day: 'numeric' }) })
}

function selectKeeper(bookId: number): void {
  emit('select-keeper', bookId)
}

function selectDestination(bookId: number): void {
  emit('select-destination', bookId)
}

function openDestinationChooser(): void {
  destinationOpen.value = true
}

function markCoverBroken(bookId: number): void {
  brokenCovers.value = new Set(brokenCovers.value).add(bookId)
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-muted-foreground">{{ t('book.merge.keeper.hint') }}</p>

    <fieldset class="space-y-2">
      <legend class="sr-only">{{ t('book.merge.keeper.label') }}</legend>
      <label
        v-for="book in preview.books"
        :key="book.id"
        class="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
        :class="book.id === keeperId ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'"
        data-testid="merge-keeper-card"
      >
        <input
          type="radio"
          class="mt-1 shrink-0 accent-primary focus-visible:outline-none"
          :name="groupName"
          :value="book.id"
          :checked="book.id === keeperId"
          @change="selectKeeper(book.id)"
        />
        <span class="relative h-16 w-11 shrink-0 overflow-hidden rounded-xs bg-muted">
          <BookCoverImage v-if="!brokenCovers.has(book.id)" :book-id="book.id" class="size-full object-cover" @error="markCoverBroken(book.id)" />
        </span>
        <span class="min-w-0 flex-1 space-y-1">
          <span class="block text-sm font-semibold break-words text-foreground">{{ book.title || t('book.untitled') }}</span>
          <span v-if="book.authors.length > 0" class="block text-xs text-muted-foreground">{{ formatList(book.authors) }}</span>
          <span v-if="book.formats.length > 0 || book.status !== 'present'" class="flex flex-wrap items-center gap-1">
            <BookFormatChip
              v-for="format in book.formats"
              :key="format"
              :format-key="format"
              class="rounded-xs px-1.5 py-0.5 text-[10px] tracking-wider"
            />
            <span v-if="book.status === 'missing'" class="rounded-full bg-destructive/10 px-1.5 py-px text-[0.68rem] font-medium text-destructive">{{
              t('book.merge.keeper.missing')
            }}</span>
            <span v-else-if="book.status === 'processing'" class="rounded-full bg-muted px-1.5 py-px text-[0.68rem] font-medium text-foreground">{{
              t('book.merge.keeper.processing')
            }}</span>
          </span>
          <span class="flex min-w-0 items-start gap-1 text-xs text-muted-foreground">
            <FolderOpen :size="12" class="mt-px shrink-0" aria-hidden="true" />
            <span class="min-w-0 font-mono break-all" dir="auto">{{ folderLabel(book) }}</span>
          </span>
          <span class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{{ filledLabel(book) }}</span>
            <span>{{ t('book.merge.keeper.files', { count: book.fileCount }) }}</span>
            <span v-if="addedLabel(book)">{{ addedLabel(book) }}</span>
          </span>
          <span
            v-if="activityLabels(book).length > 0"
            class="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground"
            data-testid="merge-keeper-activity"
          >
            <span v-for="label in activityLabels(book)" :key="label">{{ label }}</span>
          </span>
        </span>
      </label>
    </fieldset>

    <section v-if="libraryDestination && libraryCards.length > 0" class="rounded-lg border border-border p-3" data-testid="merge-library-destination">
      <component :is="singleLibraryCard ? 'div' : 'fieldset'" class="space-y-2">
        <component :is="singleLibraryCard ? 'h4' : 'legend'" class="text-sm font-semibold text-foreground">
          {{ t('book.merge.crossLibrary.destination.legend') }}
        </component>
        <p class="text-xs text-muted-foreground">{{ t('book.merge.crossLibrary.destination.hint') }}</p>
        <component
          :is="singleLibraryCard ? 'div' : 'label'"
          v-for="book in libraryCards"
          :key="book.id"
          class="flex items-start gap-2.5 rounded-md border px-2.5 py-2"
          :class="[
            singleLibraryCard ? 'border-border' : 'cursor-pointer has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
            !singleLibraryCard && book.id === preview.destinationBookId ? 'border-primary bg-primary/5' : '',
            !singleLibraryCard && book.id !== preview.destinationBookId ? 'border-border hover:bg-muted' : '',
          ]"
          data-testid="merge-library-option"
        >
          <input
            v-if="!singleLibraryCard"
            type="radio"
            class="mt-0.5 shrink-0 accent-primary focus-visible:outline-none"
            :name="destinationGroupName"
            :value="book.id"
            :checked="book.id === preview.destinationBookId"
            @change="selectDestination(book.id)"
          />
          <span class="min-w-0 flex-1 space-y-0.5">
            <span class="block text-sm font-semibold break-words text-foreground" dir="auto">{{ libraryName(book.libraryId) }}</span>
            <span class="block font-mono text-[0.7rem] break-all text-muted-foreground" dir="auto">{{ folderLabel(book) }}</span>
            <span v-if="formatsHere(book)" class="block text-xs text-muted-foreground">{{ formatsHere(book) }}</span>
            <span v-if="consequence(book)" class="block text-xs text-foreground" data-testid="merge-library-consequence">{{
              consequence(book)
            }}</span>
            <span
              v-if="accessBadge(book)"
              class="mt-1 flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-xs text-foreground"
              data-testid="merge-library-access"
            >
              <AlertTriangle :size="12" class="mt-px shrink-0 text-warning" aria-hidden="true" />
              <span class="min-w-0">{{ accessBadge(book) }}</span>
            </span>
          </span>
        </component>
      </component>
    </section>

    <section v-else-if="destinationBook || keeperRootLevel" class="space-y-2 rounded-lg border border-border p-3">
      <h4 class="text-sm font-semibold text-foreground">{{ t('book.merge.keeper.destination.heading') }}</h4>
      <template v-if="newFolderRelPath">
        <p class="text-sm text-foreground" data-testid="merge-destination-new-folder">{{ t('book.merge.keeper.destination.newFolder') }}</p>
        <p class="font-mono text-[0.7rem] break-all text-muted-foreground" dir="auto">{{ newFolderRelPath }}</p>
        <p v-if="newFolderLibrary" class="text-sm text-foreground" data-testid="merge-destination-new-folder-library">
          {{ t('book.merge.crossLibrary.destination.only', { library: newFolderLibrary }) }}
        </p>
      </template>
      <p v-else-if="keeperRootLevel" class="text-xs text-muted-foreground">{{ t('book.merge.keeper.destination.rootLevel') }}</p>
      <p
        v-if="destinationBook && !newFolderRelPath && !showDestinationChooser"
        class="text-sm text-foreground"
        data-testid="merge-destination-summary"
      >
        {{ t('book.merge.keeper.destination.summary', { title: bookLabels.get(destinationBook.id) ?? '' }) }}
      </p>
      <p v-if="destinationRootName" class="text-xs text-muted-foreground" data-testid="merge-destination-root">
        {{ t('book.merge.keeper.destination.root', { root: destinationRootName }) }}
      </p>
      <button
        v-if="!showDestinationChooser && destinationChoices.length > 1"
        type="button"
        class="text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="openDestinationChooser"
      >
        {{ t('book.merge.keeper.destination.change') }}
      </button>
      <fieldset v-if="showDestinationChooser" class="space-y-1.5">
        <legend class="sr-only">{{ t('book.merge.keeper.destination.label') }}</legend>
        <label
          v-for="book in destinationChoices"
          :key="book.id"
          class="flex cursor-pointer items-start gap-2.5 rounded-md border px-2.5 py-2 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
          :class="book.id === preview.destinationBookId ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'"
        >
          <input
            type="radio"
            class="mt-0.5 shrink-0 accent-primary focus-visible:outline-none"
            :name="destinationGroupName"
            :value="book.id"
            :checked="book.id === preview.destinationBookId"
            @change="selectDestination(book.id)"
          />
          <span class="min-w-0 flex-1">
            <span class="block text-sm text-foreground">{{
              t('book.merge.keeper.destination.option', { title: bookLabels.get(book.id) ?? '' })
            }}</span>
            <span class="block font-mono text-[0.7rem] break-all text-muted-foreground" dir="auto">{{ folderLabel(book) }}</span>
          </span>
        </label>
      </fieldset>
    </section>
  </div>
</template>
