<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, Layers } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { BookDuplicateCandidate } from '@bookorbit/types'

import { formatBytes } from '@/lib/formatting'
import { formatDate, formatNumber, formatPercent } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { copyBytes, copyFormats } from '../utils/duplicate-keeper'
import type { DuplicateField } from '../utils/duplicate-diff'

const props = withDefaults(defineProps<{ book: BookDuplicateCandidate; field: DuplicateField; winner?: boolean }>(), { winner: false })

const { t } = useI18n()

const formats = computed(() => copyFormats(props.book))
const isbn = computed(() => props.book.isbn13 ?? props.book.isbn10)
const bytes = computed(() => copyBytes(props.book))
const fileCount = computed(() => props.book.files.length)

/** A field the copy simply does not have reads as absent, not as an empty cell. */
const emptyLabel = computed(() => {
  if (props.field === 'isbn') return t('tools.bookDuplicates.fields.noIsbn')
  if (props.field === 'reading') return t('tools.bookDuplicates.fields.notStarted')
  if (props.field === 'collections') return t('tools.bookDuplicates.none')
  return t('tools.bookDuplicates.unknown')
})

function formatChipStyle(format: string): Record<string, string> {
  const color = formatColorVar(format)
  return { color, backgroundColor: `color-mix(in oklch, ${color} 13%, transparent)` }
}
</script>

<template>
  <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1" :class="winner ? 'font-semibold text-diff-ins' : 'text-foreground'">
    <template v-if="field === 'size'">
      <span class="tabular-nums">{{ formatBytes(bytes) }}</span>
      <span v-if="fileCount > 1" class="text-muted-foreground">{{
        t('tools.bookDuplicates.fields.fileCount', { count: fileCount }, fileCount)
      }}</span>
    </template>

    <template v-else-if="field === 'formats'">
      <span
        v-for="format in formats"
        :key="format"
        class="inline-flex h-[18px] items-center rounded-[5px] px-1.5 text-[10px] font-bold tracking-wide uppercase"
        :style="formatChipStyle(format)"
        >{{ format }}</span
      >
      <span v-if="formats.length === 0" class="text-muted-foreground">{{ emptyLabel }}</span>
    </template>

    <template v-else-if="field === 'isbn'">
      <span v-if="isbn" class="tabular-nums">{{ isbn }}</span>
      <span v-else class="text-muted-foreground">{{ emptyLabel }}</span>
    </template>

    <template v-else-if="field === 'metadata'">
      <template v-if="book.metadataScore !== null">
        <span class="tabular-nums">{{ formatNumber(book.metadataScore) }}</span>
        <span class="text-muted-foreground">{{ t('tools.bookDuplicates.fields.outOfHundred') }}</span>
      </template>
      <span v-else class="text-muted-foreground">{{ emptyLabel }}</span>
    </template>

    <template v-else-if="field === 'library'">{{ book.libraryName }}</template>

    <template v-else-if="field === 'reading'">
      <span
        v-if="book.readingProgress !== null && book.readingProgress > 0"
        class="inline-flex h-5 items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--pill-warning)_15%,transparent)] px-2 text-[10.5px] font-semibold text-[var(--pill-warning)]"
      >
        <BookOpen class="size-3" aria-hidden="true" />
        {{ t('tools.bookDuplicates.fields.percentRead', { percent: formatPercent(book.readingProgress) }) }}
      </span>
      <span v-else class="text-muted-foreground">{{ emptyLabel }}</span>
    </template>

    <template v-else-if="field === 'collections'">
      <span
        v-if="book.collections.length > 0"
        class="inline-flex h-5 items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--pill-warning)_15%,transparent)] px-2 text-[10.5px] font-semibold text-[var(--pill-warning)]"
      >
        <Layers class="size-3" aria-hidden="true" />
        {{ book.collections.map((collection) => collection.name).join(', ') }}
      </span>
      <span v-else class="text-muted-foreground">{{ emptyLabel }}</span>
    </template>

    <template v-else-if="field === 'added'">{{ formatDate(new Date(book.addedAt), { day: 'numeric', month: 'short', year: 'numeric' }) }}</template>
  </span>
</template>
