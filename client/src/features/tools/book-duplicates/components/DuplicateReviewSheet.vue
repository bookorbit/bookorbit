<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, BookOpen, Check, Loader2, Trash2, X } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { BookDuplicateGroup } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { formatBytes } from '@/lib/formatting'
import { formatNumber, formatPercent } from '@/i18n/formatters'
import { copyBytes, copyFolderLabel, isProtectedCopy, reclaimableBytes } from '../utils/duplicate-keeper'

const props = defineProps<{
  open: boolean
  groups: BookDuplicateGroup[]
  keeperFor: (group: BookDuplicateGroup) => number
  deleting: boolean
}>()

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()

const copyCount = computed(() => props.groups.reduce((count, group) => count + group.books.length - 1, 0))
const freed = computed(() => props.groups.reduce((bytes, group) => bytes + reclaimableBytes(group, props.keeperFor(group)), 0))
const riskCount = computed(
  () => props.groups.filter((group) => group.books.some((book) => book.id !== props.keeperFor(group) && isProtectedCopy(book))).length,
)

function handleOpenChange(open: boolean): void {
  if (!open && !props.deleting) emit('cancel')
}

function handleCancel(): void {
  if (!props.deleting) emit('cancel')
}

function handleConfirm(): void {
  emit('confirm')
}

function label(book: { title: string | null; files: { path: string | null }[]; folderPath: string }): string {
  return copyFolderLabel(book as never) || book.title || t('book.untitled')
}
</script>

<template>
  <Sheet :open="open" @update:open="handleOpenChange">
    <SheetContent side="right" class="w-full gap-0 sm:max-w-xl" hide-close>
      <SheetHeader class="border-b border-border px-5 py-4">
        <SheetTitle class="text-base">{{ t('tools.bookDuplicates.review.title', { count: copyCount }, copyCount) }}</SheetTitle>
        <SheetDescription class="text-[13px]">
          {{ t('tools.bookDuplicates.review.description', { groups: formatNumber(groups.length), size: formatBytes(freed) }) }}
        </SheetDescription>
      </SheetHeader>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p
          v-if="riskCount > 0"
          class="mb-3 flex items-start gap-2 rounded-lg border border-[color-mix(in_oklch,var(--pill-warning)_40%,transparent)] bg-[color-mix(in_oklch,var(--pill-warning)_12%,transparent)] px-3 py-2 text-[12.5px] text-[var(--pill-warning)]"
        >
          <AlertTriangle class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{{ t('tools.bookDuplicates.review.riskWarning', { count: riskCount }, riskCount) }}</span>
        </p>

        <ul class="grid gap-3">
          <li v-for="group in groups" :key="group.id" class="rounded-lg border border-border">
            <p class="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
              <span class="truncate text-[13px] font-semibold text-foreground">{{ group.books[0]?.title || t('book.untitled') }}</span>
              <span class="shrink-0 text-[12px] tabular-nums text-muted-foreground">{{ group.books[0]?.libraryName }}</span>
            </p>
            <ul class="grid gap-1 px-3 py-2">
              <li v-for="book in group.books" :key="book.id" class="flex items-center gap-2 text-[12.5px]">
                <Check v-if="book.id === keeperFor(group)" class="size-3.5 shrink-0 text-[var(--pill-success)]" aria-hidden="true" />
                <X v-else class="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
                <span
                  class="min-w-0 flex-1 truncate"
                  :class="book.id === keeperFor(group) ? 'text-foreground' : 'text-muted-foreground line-through'"
                >
                  {{ label(book) }}
                </span>
                <span
                  v-if="book.readingProgress !== null && book.readingProgress > 0"
                  class="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-[var(--pill-warning)]"
                >
                  <BookOpen class="size-3" aria-hidden="true" />
                  {{ formatPercent(book.readingProgress) }}
                </span>
                <span class="shrink-0 tabular-nums text-muted-foreground">{{ formatBytes(copyBytes(book)) }}</span>
              </li>
            </ul>
          </li>
        </ul>

        <p class="mt-4 text-[12.5px] text-muted-foreground">{{ t('tools.bookDuplicates.deleteDialog.warning') }}</p>
      </div>

      <SheetFooter class="flex-row items-center gap-2 border-t border-border px-5 py-3">
        <span class="text-[12.5px] text-muted-foreground">
          {{ t('tools.bookDuplicates.review.footer', { size: formatBytes(freed) }) }}
        </span>
        <Button class="ms-auto" variant="outline" :disabled="deleting" @click="handleCancel">{{ t('common.cancel') }}</Button>
        <Button variant="destructive" :disabled="deleting || copyCount === 0" @click="handleConfirm">
          <Loader2 v-if="deleting" class="animate-spin" aria-hidden="true" />
          <Trash2 v-else aria-hidden="true" />
          {{ t('tools.bookDuplicates.deleteDialog.confirm', { count: copyCount }, copyCount) }}
        </Button>
      </SheetFooter>
    </SheetContent>
  </Sheet>
</template>
