<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Braces, Download, FileSpreadsheet, FileText, Loader2, X } from '@lucide/vue'
import { DialogClose, DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { toast } from 'vue-sonner'
import { READING_HISTORY_PAGE_SIZE_MAX, type ReadingHistoryItem } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import { fetchReadingHistoryPage, type ReadingHistoryListParams } from '../api/reading-history.api'
import { EXPORT_MIME, exportFileName, saveBlob, toCsv, toJson, toMarkdown, type ExportFormat } from '../lib/history-export'

const props = defineProps<{ params: ReadingHistoryListParams; periodLabel: string; total: number }>()
const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()

const PREVIEW_LINES = 40
/** A bound on one export, far beyond any reader's history, so a runaway loop cannot fetch forever. */
const EXPORT_MAX = 50_000

const format = ref<ExportFormat>('md')
const preview = ref<ReadingHistoryItem[]>([])
const previewError = ref(false)
const progress = ref<{ done: number; total: number } | null>(null)

const FORMATS: { value: ExportFormat; icon: typeof FileText }[] = [
  { value: 'md', icon: FileText },
  { value: 'csv', icon: FileSpreadsheet },
  { value: 'json', icon: Braces },
]

const heading = computed(() => t('readingHistory.export.fileHeading', { period: props.periodLabel }))
const fileName = computed(() => exportFileName(props.periodLabel, format.value))
const includesOthers = computed(() => props.params.outcomes.some((outcome) => outcome !== 'completed'))

const downloadLabel = computed(() =>
  progress.value
    ? t('readingHistory.export.preparing', { done: formatNumber(progress.value.done), total: formatNumber(progress.value.total) })
    : t('readingHistory.export.download'),
)

function build(items: ReadingHistoryItem[]): string {
  if (format.value === 'csv') return toCsv(items)
  if (format.value === 'json') return toJson(items)
  return toMarkdown(items, heading.value, t)
}

const previewLines = computed(() => {
  const lines = build(preview.value).trimEnd().split('\n')
  return { shown: lines.slice(0, PREVIEW_LINES).join('\n'), more: Math.max(0, lines.length - PREVIEW_LINES) }
})

watch(open, async (isOpen) => {
  if (!isOpen) return
  previewError.value = false
  progress.value = null
  try {
    preview.value = (await fetchReadingHistoryPage(props.params, 0, 40)).items
  } catch {
    previewError.value = true
  }
})

async function handleDownload() {
  if (progress.value) return
  const items: ReadingHistoryItem[] = []
  progress.value = { done: 0, total: props.total }
  try {
    for (let offset = 0; offset < Math.min(props.total, EXPORT_MAX); offset += READING_HISTORY_PAGE_SIZE_MAX) {
      const page = await fetchReadingHistoryPage(props.params, offset, READING_HISTORY_PAGE_SIZE_MAX)
      items.push(...page.items)
      progress.value = { done: items.length, total: page.total }
      if (page.items.length < READING_HISTORY_PAGE_SIZE_MAX) break
    }
    saveBlob(new Blob([build(items)], { type: `${EXPORT_MIME[format.value]};charset=utf-8` }), fileName.value)
    toast.success(t('readingHistory.export.saved', { count: items.length }))
    open.value = false
  } catch {
    toast.error(t('readingHistory.export.failed'))
  } finally {
    progress.value = null
  }
}

function handleFormat(value: ExportFormat) {
  format.value = value
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        aria-modal="true"
        class="fixed inset-x-0 bottom-0 z-[70] flex max-h-[92svh] flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-xl focus-visible:outline-none md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:max-h-[calc(100svh-3rem)] md:w-[min(calc(100%-2rem),920px)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg"
      >
        <header class="flex items-start gap-4 border-b border-border px-4 py-4 md:px-6 md:py-5">
          <span class="hidden size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary md:flex"
            ><Download class="size-[18px]" aria-hidden="true"
          /></span>
          <div class="min-w-0">
            <DialogTitle class="text-lg font-semibold text-foreground">{{ t('readingHistory.export.title', { period: periodLabel }) }}</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">{{
              t('readingHistory.export.description', { count: total })
            }}</DialogDescription>
          </div>
          <DialogClose
            class="-me-2 -mt-1 ms-auto grid size-8 shrink-0 place-items-center rounded-md text-foreground hover:bg-muted"
            :aria-label="t('readingHistory.export.close')"
          >
            <X class="size-4" aria-hidden="true" />
          </DialogClose>
        </header>

        <div class="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[300px_minmax(0,1fr)] md:overflow-hidden">
          <div class="flex flex-col gap-4 border-b border-border p-4 md:border-e md:border-b-0 md:p-6">
            <fieldset class="flex flex-col gap-1.5">
              <legend class="mb-1.5 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
                {{ t('readingHistory.export.format') }}
              </legend>
              <button
                v-for="option in FORMATS"
                :key="option.value"
                type="button"
                class="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5 gap-y-0.5 rounded-lg border px-2.5 py-2 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="format === option.value ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted/60'"
                :aria-pressed="format === option.value"
                @click="handleFormat(option.value)"
              >
                <component
                  :is="option.icon"
                  class="row-span-2 mt-px size-4"
                  :class="format === option.value ? 'text-primary' : 'text-muted-foreground'"
                  aria-hidden="true"
                />
                <span class="text-[13px] font-semibold text-foreground">{{ t(`readingHistory.export.formats.${option.value}.name`) }}</span>
                <span class="text-[11.5px] leading-4 text-muted-foreground">{{ t(`readingHistory.export.formats.${option.value}.hint`) }}</span>
              </button>
            </fieldset>
            <div>
              <p class="mb-1 text-[11px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{ t('readingHistory.export.includes') }}</p>
              <p class="text-xs leading-[18px] text-foreground">
                {{ includesOthers ? t('readingHistory.export.includesOthers') : t('readingHistory.export.finishedOnly') }}
              </p>
            </div>
          </div>
          <div class="min-h-[260px] min-w-0 md:min-h-[420px] md:overflow-auto">
            <p v-if="previewError" class="p-4 text-sm text-muted-foreground" role="alert">{{ t('readingHistory.export.previewFailed') }}</p>
            <pre
              v-else
              class="m-0 h-full overflow-auto bg-muted/40 px-4 py-3.5 font-mono text-xs leading-[1.65] whitespace-pre text-foreground"
              :aria-label="t('readingHistory.export.preview', { file: fileName })"
              tabindex="0">{{ previewLines.shown }}<template v-if="previewLines.more"><span class="text-muted-foreground">{{ '\n' }}{{ t('readingHistory.export.moreLines', { count: previewLines.more }) }}</span></template></pre>
          </div>
        </div>

        <footer class="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 md:px-6">
          <span class="truncate text-[11.5px] text-muted-foreground max-md:hidden">{{ fileName }}</span>
          <span class="flex-1" aria-hidden="true" />
          <DialogClose as-child>
            <Button variant="ghost" class="max-md:flex-1">{{ t('common.cancel') }}</Button>
          </DialogClose>
          <Button class="max-md:flex-1" :disabled="!!progress || total === 0" @click="handleDownload">
            <Loader2 v-if="progress" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <Download v-else aria-hidden="true" />
            {{ downloadLabel }}
          </Button>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
