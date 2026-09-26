<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { BookDetail } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import { formatNumber, formatPercent } from '@/i18n/formatters'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { bookFormatEntries, formatKeyName, type BookFormatEntry } from '@/features/book/lib/book-formats'

export interface EditionProgress {
  /** The edition's format key, as `bookFormatEntries` gives it. */
  key: string
  percentage: number
  finished: boolean
  /** Present when this edition's progress can be reset. */
  resetFileId?: number | null
}

const props = withDefaults(
  defineProps<{
    book: BookDetail
    progress?: EditionProgress[]
    /** Rows shown before the rest collapse behind a count. */
    maxRows?: number
    resettingFileIds?: number[]
  }>(),
  { progress: () => [], maxRows: 4, resettingFileIds: () => [] },
)

const emit = defineEmits<{ resetProgress: [key: string] }>()

function handleReset(row: BookFormatEntry) {
  emit('resetProgress', row.key)
}

function isResetting(row: BookFormatEntry): boolean {
  const entry = progressFor(row)
  return entry?.resetFileId != null && props.resettingFileIds.includes(entry.resetFileId)
}

const { t } = useI18n()

const rows = computed(() => bookFormatEntries(props.book.files, props.book.formatPriority))

const visibleRows = computed(() => rows.value.slice(0, props.maxRows))
const hiddenCount = computed(() => Math.max(0, rows.value.length - visibleRows.value.length))
const totalBytes = computed(() => rows.value.reduce((total, row) => total + row.sizeBytes, 0))

function progressFor(row: BookFormatEntry): EditionProgress | null {
  return props.progress.find((entry) => entry.key === row.key) ?? null
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours > 0 ? t('book.detail.details.durationHm', { hours, minutes }) : t('book.detail.details.durationM', { minutes })
}

/** Mirrors the detail tab's rule: never round a live position down to 0% or up to 100%. */
function progressLabel(percentage: number): string {
  const clamped = Math.max(0, Math.min(100, percentage))
  if (clamped > 0 && clamped < 1) return t('book.detail.details.percentUnderOne')
  if (clamped > 99 && clamped < 100) return t('book.detail.details.percentOverNinetyNine')
  return formatPercent(Math.round(clamped) / 100)
}

function rowMeasure(row: BookFormatEntry): string {
  const durationSeconds = row.audio ? props.book.audioMetadata?.durationSeconds : null
  if (durationSeconds != null) return formatDuration(durationSeconds)
  return formatBytes(row.sizeBytes)
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card px-3.5 py-3" :aria-label="t('book.detail.details.editions')">
    <div class="flex items-baseline gap-2">
      <h3 class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {{ t('book.detail.details.editions') }}
      </h3>
      <p class="ml-auto text-[11px] tabular-nums text-muted-foreground">
        {{ t('book.detail.details.editionsSummary', { count: rows.length, size: formatBytes(totalBytes) }) }}
      </p>
    </div>

    <ul class="mt-2.5 flex flex-col gap-2">
      <li v-for="row in visibleRows" :key="row.key" class="flex items-center gap-2.5">
        <BookFormatChip
          :format-key="row.key"
          :primary="row.primary"
          class="h-5 min-w-13 shrink-0 justify-center rounded-md px-1.5 text-[10px] leading-none tracking-wider"
        />

        <template v-if="progressFor(row)">
          <span class="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              class="block h-full rounded-full"
              :class="progressFor(row)!.finished ? 'bg-emerald-500' : 'bg-primary'"
              :style="{ width: `${Math.min(100, progressFor(row)!.percentage)}%` }"
            />
          </span>
          <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {{ progressLabel(progressFor(row)!.percentage) }}
          </span>
        </template>
        <span v-else class="min-w-0 flex-1" />

        <span class="w-16 shrink-0 truncate text-right text-[11px] tabular-nums text-muted-foreground">
          {{ rowMeasure(row) }}
        </span>

        <button
          v-if="progressFor(row)?.resetFileId != null"
          type="button"
          class="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          :aria-label="t('book.detail.details.resetEditionProgress', { format: formatKeyName(row.key) })"
          :disabled="isResetting(row)"
          @click="handleReset(row)"
        >
          <RotateCcw class="size-3" />
        </button>
      </li>
    </ul>

    <p v-if="hiddenCount > 0" class="mt-2 text-[11px] text-muted-foreground">
      {{ t('book.detail.details.moreFormats', { count: hiddenCount }) }}
    </p>

    <div class="mt-2.5 flex items-baseline gap-2 border-t border-border pt-2">
      <p class="text-[11px] text-muted-foreground">{{ t('book.detail.details.filesOnDisk') }}</p>
      <p class="ml-auto text-[11px] font-semibold tabular-nums">{{ formatNumber(book.files.length) }}</p>
    </div>
  </section>
</template>
