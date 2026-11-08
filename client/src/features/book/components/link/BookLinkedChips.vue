<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'
import { TriangleAlert } from '@lucide/vue'
import type { LinkedBookSummary } from '@bookorbit/types'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { linkedMediumLabel } from '@/features/book/lib/book-link'

const props = defineProps<{
  /** The other books shown as this one; only those the viewer can see. */
  books: LinkedBookSummary[]
}>()

const { t } = useI18n()
const headingId = `linked-books-${useId()}`

const chips = computed(() =>
  props.books.map((book) => {
    const medium = linkedMediumLabel(book.mediaKind)
    const missing = book.status === 'missing'
    return {
      bookId: book.bookId,
      libraryName: book.libraryName,
      formatKey: book.formats[0] ?? null,
      missing,
      title: book.title ?? undefined,
      label: missing
        ? t('book.link.chips.labelMissing', { medium, library: book.libraryName })
        : t('book.link.chips.label', { medium, library: book.libraryName }),
    }
  }),
)
</script>

<template>
  <div v-if="chips.length > 0" class="flex flex-wrap items-center gap-x-2 gap-y-1.5" data-testid="linked-books">
    <span :id="headingId" class="text-xs text-muted-foreground">{{ t('book.link.chips.heading') }}</span>
    <ul class="flex flex-wrap items-center gap-1.5" :aria-labelledby="headingId">
      <li v-for="chip in chips" :key="chip.bookId">
        <RouterLink
          :to="{ name: 'book-detail', params: { bookId: chip.bookId } }"
          :aria-label="chip.label"
          :title="chip.title"
          class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background py-0.5 ps-1 pe-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="linked-book-chip"
        >
          <BookFormatChip
            v-if="chip.formatKey"
            :format-key="chip.formatKey"
            class="shrink-0 rounded-full px-1.5 py-px text-[9px] tracking-wider"
            aria-hidden="true"
          />
          <span class="min-w-0 truncate" dir="auto">{{ chip.libraryName }}</span>
          <span v-if="chip.missing" class="inline-flex shrink-0 items-center gap-0.5 text-muted-foreground" data-testid="linked-book-chip-missing">
            <TriangleAlert class="size-3" aria-hidden="true" />
            {{ t('book.link.chips.missing') }}
          </span>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>
