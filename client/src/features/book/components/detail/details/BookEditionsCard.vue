<script setup lang="ts">
import { computed } from 'vue'
import { RotateCcw } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { formatBytes } from '@/lib/formatting'
import { formatNumber, formatPercent } from '@/i18n/formatters'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { FORMAT_TO_GROUP } from '@bookorbit/types'
import type { BookDetail } from '@bookorbit/types'

export interface EditionProgress {
  /** Lower-cased format the bar belongs to. */
  format: string
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

const emit = defineEmits<{ resetProgress: [format: string] }>()

function handleReset(row: EditionRow) {
  emit('resetProgress', row.format)
}

function isResetting(row: EditionRow): boolean {
  const entry = progressFor(row)
  return entry?.resetFileId != null && props.resettingFileIds.includes(entry.resetFileId)
}

const { t } = useI18n()

interface EditionRow {
  key: string
  format: string
  sizeBytes: number
  durationSeconds: number | null
  trackCount: number
  isPrimary: boolean
  isAudio: boolean
}

/**
 * A multi-track audiobook is one edition, not thirty-eight. Collapsing it here matches how the
 * reader treats those files and keeps a 38-file book from printing 38 rows.
 */
const rows = computed<EditionRow[]>(() => {
  const files = props.book.files.filter((file) => file.format != null)
  const audio = files.filter((file) => FORMAT_TO_GROUP[file.format!] === 'audio')
  const rest = files.filter((file) => FORMAT_TO_GROUP[file.format!] !== 'audio')
  const result: EditionRow[] = []

  const firstAudio = audio[0]
  if (firstAudio?.format != null) {
    result.push({
      key: 'audio',
      format: firstAudio.format,
      sizeBytes: audio.reduce((total, file) => total + (file.sizeBytes ?? 0), 0),
      durationSeconds: props.book.audioMetadata?.durationSeconds ?? null,
      trackCount: audio.length,
      isPrimary: audio.some((file) => file.role === 'primary'),
      isAudio: true,
    })
  }

  const byFormat = new Map<string, EditionRow>()
  for (const file of rest) {
    const format = file.format!
    const existing = byFormat.get(format)
    if (existing) {
      existing.sizeBytes += file.sizeBytes ?? 0
      existing.trackCount += 1
      existing.isPrimary = existing.isPrimary || file.role === 'primary'
      continue
    }
    byFormat.set(format, {
      key: format,
      format,
      sizeBytes: file.sizeBytes ?? 0,
      durationSeconds: null,
      trackCount: 1,
      isPrimary: file.role === 'primary',
      isAudio: false,
    })
  }
  result.push(...byFormat.values())

  return result.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.format.localeCompare(b.format))
})

const visibleRows = computed(() => rows.value.slice(0, props.maxRows))
const hiddenCount = computed(() => Math.max(0, rows.value.length - visibleRows.value.length))
const totalBytes = computed(() => rows.value.reduce((total, row) => total + row.sizeBytes, 0))
const fileCount = computed(() => props.book.files.filter((file) => file.format != null).length)

const progressByFormat = computed(() => {
  const map = new Map<string, EditionProgress>()
  for (const entry of props.progress) map.set(entry.format.toLowerCase(), entry)
  return map
})

function progressFor(row: EditionRow): EditionProgress | null {
  return progressByFormat.value.get(row.format.toLowerCase()) ?? null
}

function formatBadgeStyle(format: string) {
  const color = formatColorVar(format)
  return {
    color,
    borderColor: `color-mix(in oklch, ${color} 45%, transparent)`,
    backgroundColor: `color-mix(in oklch, ${color} 12%, transparent)`,
  }
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

function rowMeasure(row: EditionRow): string {
  if (row.isAudio && row.durationSeconds != null) return formatDuration(row.durationSeconds)
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
        <span
          class="inline-flex h-5 w-13 shrink-0 items-center justify-center gap-1 rounded-md border text-[10px] font-bold uppercase leading-none tracking-wider"
          :style="formatBadgeStyle(row.format)"
        >
          <span v-if="row.isPrimary" class="size-1.5 shrink-0 rounded-full bg-current" />
          {{ row.format }}
        </span>

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
          :aria-label="t('book.detail.details.resetFileProgress')"
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
      <p class="ml-auto text-[11px] font-semibold tabular-nums">{{ formatNumber(fileCount) }}</p>
    </div>
  </section>
</template>
