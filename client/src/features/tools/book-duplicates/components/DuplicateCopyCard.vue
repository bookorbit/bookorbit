<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, Check, Layers, Sparkles } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { BookDuplicateCandidate } from '@bookorbit/types'

import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import { formatBytes } from '@/lib/formatting'
import { formatPercent } from '@/i18n/formatters'
import { copyBytes, copyFolderLabel } from '../utils/duplicate-keeper'

const props = defineProps<{
  book: BookDuplicateCandidate
  groupId: number
  index: number
  keeper: boolean
  recommended: boolean
}>()

const emit = defineEmits<{ keep: [bookId: number] }>()

const { t } = useI18n()

const label = computed(() => copyFolderLabel(props.book) || props.book.title || t('book.untitled'))
const bytes = computed(() => formatBytes(copyBytes(props.book)))

function handleKeep(): void {
  emit('keep', props.book.id)
}
</script>

<template>
  <label
    class="relative flex h-full cursor-pointer flex-col gap-2 rounded-lg border p-2.5 transition-colors focus-within:ring-2 focus-within:ring-ring"
    :class="keeper ? 'border-primary/25 bg-primary/6' : 'border-border bg-background hover:bg-accent'"
  >
    <input
      type="radio"
      class="sr-only"
      :name="`duplicate-keeper-${groupId}`"
      :checked="keeper"
      :aria-label="t('tools.bookDuplicates.keepCopy', { name: label })"
      @change="handleKeep"
    />

    <span class="flex items-center justify-between gap-2">
      <span
        class="inline-flex items-center gap-1.5 text-[10.5px] font-bold tracking-wider uppercase"
        :class="keeper ? 'text-primary' : 'text-muted-foreground'"
      >
        <span
          class="grid size-[15px] place-items-center rounded-full border"
          :class="keeper ? 'border-primary bg-primary text-primary-foreground' : 'border-border'"
        >
          <Check v-if="keeper" class="size-2.5" aria-hidden="true" />
        </span>
        {{ keeper ? t('tools.bookDuplicates.keeping') : t('tools.bookDuplicates.willDelete') }}
      </span>
      <span class="rounded border border-border px-1 font-mono text-[10px] leading-[15px] text-muted-foreground" aria-hidden="true">{{
        index + 1
      }}</span>
    </span>

    <span class="flex gap-2.5">
      <span class="grid h-[74px] w-[52px] shrink-0 place-items-center overflow-hidden rounded border border-border bg-muted">
        <BookCoverImage v-if="book.hasCover" :book-id="book.id" class="h-full w-full object-cover" alt="" />
        <BookOpen v-else class="size-5 text-muted-foreground" aria-hidden="true" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-[12.5px] leading-snug font-semibold wrap-anywhere text-foreground">{{ label }}</span>
        <span class="mt-0.5 block text-[11.5px] text-muted-foreground">{{ book.libraryName }} &middot; {{ bytes }}</span>
        <span class="mt-1.5 flex flex-wrap gap-1">
          <span v-if="recommended" class="inline-flex h-5 items-center gap-1 rounded-full bg-primary/16 px-2 text-[10.5px] font-bold text-primary">
            <Sparkles class="size-3" aria-hidden="true" />
            {{ t('tools.bookDuplicates.recommended') }}
          </span>
          <span
            v-if="book.readingProgress !== null && book.readingProgress > 0"
            class="inline-flex h-5 items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--pill-warning)_15%,transparent)] px-2 text-[10.5px] font-semibold text-[var(--pill-warning)]"
          >
            <BookOpen class="size-3" aria-hidden="true" />
            {{ formatPercent(book.readingProgress) }}
          </span>
          <span
            v-if="book.collections.length > 0"
            class="inline-flex h-5 items-center gap-1 rounded-full bg-[color-mix(in_oklch,var(--pill-warning)_15%,transparent)] px-2 text-[10.5px] font-semibold text-[var(--pill-warning)]"
          >
            <Layers class="size-3" aria-hidden="true" />
            {{ book.collections.length }}
          </span>
        </span>
      </span>
    </span>

    <slot />
  </label>
</template>
