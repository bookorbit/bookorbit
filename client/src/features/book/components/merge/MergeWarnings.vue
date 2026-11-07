<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle } from '@lucide/vue'
import type { BookMergeWarning } from '@bookorbit/types'
import { mergeWarningMessage } from '@/features/book/lib/book-merge'

const props = withDefaults(
  defineProps<{
    warnings: BookMergeWarning[]
    bookLabels: Map<number, string>
    libraryNames?: Map<number, string>
    /** The library the merged book lives in, for a warning that names none. */
    destinationLibraryId?: number | null
  }>(),
  { libraryNames: () => new Map(), destinationLibraryId: null },
)

const { t } = useI18n()

function libraryName(libraryId: number | null): string {
  const id = libraryId ?? props.destinationLibraryId
  return (id !== null ? props.libraryNames.get(id) : undefined) ?? t('book.merge.crossLibrary.unknownLibrary')
}

const items = computed(() =>
  props.warnings.map((warning, index) => ({
    key: `${warning.code}-${warning.bookId ?? 'all'}-${index}`,
    code: warning.code,
    text: mergeWarningMessage(warning, libraryName),
    book: warning.bookId != null ? (props.bookLabels.get(warning.bookId) ?? null) : null,
  })),
)
</script>

<template>
  <ul class="space-y-1.5">
    <li
      v-for="item in items"
      :key="item.key"
      class="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-sm text-foreground"
      :data-code="item.code"
      data-testid="merge-warning"
    >
      <AlertTriangle :size="14" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <span class="min-w-0 flex-1">
        <span class="block">{{ item.text }}</span>
        <span v-if="item.book" class="block text-xs text-muted-foreground">{{ item.book }}</span>
      </span>
    </li>
  </ul>
</template>
