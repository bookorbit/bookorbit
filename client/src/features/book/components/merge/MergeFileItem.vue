<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookMergeFilePlanEntry } from '@bookorbit/types'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'

const props = defineProps<{
  file: BookMergeFilePlanEntry
  bookLabel: string | null
}>()

const { t } = useI18n()

const fileName = computed(() => props.file.fromRelPath.split('/').filter(Boolean).at(-1) ?? props.file.fromRelPath)
const moves = computed(() => props.file.action === 'move' && props.file.toRelPath !== props.file.fromRelPath)

const placement = computed(() => {
  const file = props.file
  if (file.reason === 'missing') return t('book.merge.files.missing')
  // The destination's own files also "stay", but they are where every other file is going.
  if (file.reason === 'already_in_destination') return t('book.merge.files.inPlace')
  if (file.action === 'hide') return t('book.merge.files.hidden')
  if (file.action === 'stay') return t('book.merge.files.stays')
  return null
})
</script>

<template>
  <li class="rounded-md border border-border px-2.5 py-2" data-testid="merge-file">
    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
      <BookFormatChip v-if="file.format" :format-key="file.format" class="shrink-0 rounded-xs px-1.5 py-0.5 text-[10px] tracking-wider" />
      <span class="min-w-0 flex-1 truncate text-sm font-medium text-foreground" :title="file.fromRelPath">{{ fileName }}</span>
      <span v-if="file.renamed" class="rounded-full bg-muted px-1.5 py-px text-[0.68rem] font-medium text-foreground">{{
        t('book.merge.files.renamed')
      }}</span>
      <span v-if="file.identical" class="rounded-full bg-primary/10 px-1.5 py-px text-[0.68rem] font-medium text-primary">{{
        t('book.merge.files.identical')
      }}</span>
    </div>
    <p class="mt-0.5 text-xs text-muted-foreground">{{ bookLabel }}</p>
    <p class="mt-1 font-mono text-[0.7rem] break-all text-muted-foreground" dir="auto">
      {{ moves ? t('book.merge.files.from', { path: file.fromRelPath }) : file.fromRelPath }}
    </p>
    <p v-if="moves" class="font-mono text-[0.7rem] break-all text-foreground" dir="auto">
      {{ t('book.merge.files.to', { path: file.toRelPath }) }}
    </p>
    <p v-if="placement" class="mt-0.5 text-xs text-muted-foreground">{{ placement }}</p>
  </li>
</template>
