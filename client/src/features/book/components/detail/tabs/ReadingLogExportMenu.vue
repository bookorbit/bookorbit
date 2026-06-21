<script setup lang="ts">
import { ref } from 'vue'
import { Download, FileJson, FileSpreadsheet, Loader2 } from '@lucide/vue'
import type { BookReadingSession } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const props = defineProps<{
  bookTitle: string
  total: number
  exportAll: () => Promise<BookReadingSession[]>
}>()

const open = ref(false)
const exporting = ref(false)

function safeName(): string {
  return props.bookTitle
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function pacePercentPerHour(session: BookReadingSession): string {
  if (session.progressDelta == null || session.durationSeconds === 0) return ''
  return ((session.progressDelta / session.durationSeconds) * 3600).toFixed(2)
}

async function exportCsv() {
  if (exporting.value) return
  exporting.value = true
  try {
    const items = await props.exportAll()
    const header = 'startedAt,endedAt,durationSeconds,progressDelta,endProgress,pacePercentPerHour,format,source'
    const rows = items.map((s) =>
      [
        s.startedAt,
        s.endedAt,
        String(s.durationSeconds),
        s.progressDelta != null ? String(s.progressDelta) : '',
        s.endProgress != null ? String(s.endProgress) : '',
        pacePercentPerHour(s),
        s.format ?? '',
        s.source ?? '',
      ]
        .map(csvEscape)
        .join(','),
    )
    downloadFile([header, ...rows].join('\n'), `${safeName()}-reading-log.csv`, 'text/csv')
    open.value = false
  } finally {
    exporting.value = false
  }
}

async function exportJson() {
  if (exporting.value) return
  exporting.value = true
  try {
    const items = await props.exportAll()
    const data = {
      bookTitle: props.bookTitle,
      exportedAt: new Date().toISOString(),
      totalSessions: items.length,
      sessions: items,
    }
    downloadFile(JSON.stringify(data, null, 2), `${safeName()}-reading-log.json`, 'application/json')
    open.value = false
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="total === 0 || exporting"
      >
        <Loader2 v-if="exporting" :size="14" class="animate-spin" />
        <Download v-else :size="14" />
        Export
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-44 p-1">
      <button
        class="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        :disabled="exporting"
        @click="exportCsv"
      >
        <FileSpreadsheet :size="14" class="text-muted-foreground" />
        CSV
      </button>
      <button
        class="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        :disabled="exporting"
        @click="exportJson"
      >
        <FileJson :size="14" class="text-muted-foreground" />
        JSON
      </button>
    </PopoverContent>
  </Popover>
</template>
