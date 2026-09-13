<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from '@lucide/vue'
import type { BookDetail } from '@bookorbit/types'
import { formatRelativeFromNow } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { resolveWriteBackFields } from '@/features/book/lib/write-back-fields'

/** Enough field names to make the sentence concrete without turning it back into a table. */
const NAMED_FIELD_LIMIT = 5

const props = defineProps<{ book: BookDetail; canEdit: boolean }>()
const emit = defineEmits<{ editMetadata: [] }>()

const { t } = useI18n()

const status = computed(() => props.book.fileWriteStatus)
const writableFormats = computed(() => status.value?.writableFormats ?? [])
const fields = computed(() => resolveWriteBackFields(props.book, status.value?.writableFields ?? []))
const filled = computed(() => fields.value.filter((entry) => entry.value != null))
const fillFraction = computed(() => (fields.value.length === 0 ? 0 : filled.value.length / fields.value.length))

const targetFormat = computed(() => (writableFormats.value[0] ?? '').toUpperCase())

/**
 * The old panel printed twenty-eight rows of book metadata on a tab about files. The question it
 * was really answering is "what would a write put in there", which one sentence answers.
 */
const summary = computed(() => {
  if (!status.value?.enabled) return t('book.detail.files.writeBackOff')
  if (filled.value.length === 0) return t('book.detail.files.writtenNothing', { total: fields.value.length })
  const named = filled.value.slice(0, NAMED_FIELD_LIMIT).map((entry) => entry.label)
  const rest = filled.value.length - named.length
  const list = named.join(', ')
  if (rest <= 0) return t('book.detail.files.writtenSummaryAll', { fields: list, format: targetFormat.value })
  return t('book.detail.files.writtenSummary', { fields: list, count: rest, format: targetFormat.value })
})

const runLabel = computed(() =>
  props.book.lastWrittenAt
    ? t('book.detail.files.lastRun', { time: formatRelativeFromNow(new Date(props.book.lastWrittenAt)) })
    : t('book.detail.files.neverRun'),
)

function handleEditMetadata() {
  emit('editMetadata')
}
</script>

<template>
  <section class="flex shrink-0 flex-col rounded-xl border border-border bg-card">
    <div class="flex h-[38px] shrink-0 items-center gap-2.5 border-b border-border px-3.5">
      <h3 class="text-[10.5px] font-bold uppercase leading-none tracking-[0.09em] text-muted-foreground">
        {{ t('book.detail.files.writeBackShort') }}
      </h3>
      <span class="ml-auto truncate text-[11.5px] leading-none text-muted-foreground">{{ runLabel }}</span>
    </div>

    <div class="flex flex-col gap-2.5 px-3.5 py-3.5">
      <div class="flex items-center gap-1.5">
        <span
          class="inline-flex h-[18px] items-center rounded px-1.5 text-[9.5px] font-bold uppercase tracking-wider"
          :class="status?.enabled ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'"
        >
          {{ status?.enabled ? t('book.detail.files.enabled') : t('book.detail.files.disabled') }}
        </span>
        <span
          v-for="format in writableFormats"
          :key="format"
          class="inline-flex h-[18px] items-center rounded px-1.5 text-[9.5px] font-bold uppercase tracking-wider"
          :style="{
            color: formatColorVar(format),
            backgroundColor: `color-mix(in oklch, ${formatColorVar(format)} 16%, transparent)`,
          }"
        >
          {{ format }}
        </span>
        <span class="ml-auto shrink-0 text-[12.5px] leading-none text-muted-foreground tabular-nums">
          {{ t('book.detail.files.fieldsSet', { filled: filled.length, total: fields.length }) }}
        </span>
      </div>

      <div class="h-1.5 overflow-hidden rounded-full bg-muted">
        <span class="block h-full rounded-full bg-primary transition-[width]" :style="{ width: `${Math.round(fillFraction * 100)}%` }" />
      </div>

      <p class="text-[12.5px] leading-relaxed text-muted-foreground">{{ summary }}</p>

      <button
        v-if="canEdit"
        class="-mx-1 inline-flex min-h-7 items-center gap-1 self-start rounded px-1 text-[12.5px] font-medium text-primary transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleEditMetadata"
      >
        {{ t('book.detail.files.editMetadata') }}
        <ChevronRight class="size-3.5" aria-hidden="true" />
      </button>
    </div>
  </section>
</template>
