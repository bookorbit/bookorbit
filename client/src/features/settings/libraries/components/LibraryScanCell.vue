<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw, TriangleAlert } from '@lucide/vue'
import type { Library, LibraryLastScan, ScanProgressEvent } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatNumber } from '@/i18n/formatters'
import LibraryScanHistoryPopover from './LibraryScanHistoryPopover.vue'
import LibraryScanOutcome from './LibraryScanOutcome.vue'

const props = withDefaults(
  defineProps<{
    library: Library
    lastScan: LibraryLastScan | null
    progress: ScanProgressEvent | undefined
    pending: boolean
    /** The ledger opens the recent history from this cell; the mobile card leaves it plain. */
    withHistory?: boolean
    historyOpen?: boolean
  }>(),
  { withHistory: false, historyOpen: false },
)

const emit = defineEmits<{ 'update:historyOpen': [open: boolean]; scan: [library: Library] }>()

const { t } = useI18n()

const running = computed(() => (props.progress?.status === 'running' ? props.progress : null))
const percent = computed(() => {
  const event = running.value
  if (!event || event.total <= 0) return null
  return Math.min(100, Math.floor((event.processed / event.total) * 100))
})

const state = computed(() => {
  if (running.value) return 'running'
  if (props.pending) return 'pending'
  if (!props.lastScan) return 'never'
  if (props.lastScan.status === 'failed') return 'failed'
  return 'completed'
})

const progressLabel = computed(() => {
  const event = running.value
  if (!event) return ''
  if (event.total <= 0) return t('settings.admin.libraries.scanCounting')
  return t('settings.admin.libraries.scanCounts', { processed: formatNumber(event.processed), total: formatNumber(event.total) })
})

/** What the running scan has found so far; the socket event already carries the counts. */
const liveOutcome = computed(() => {
  const event = running.value
  if (!event || event.total <= 0) return ''
  const parts: string[] = []
  if (event.added > 0) parts.push(t('settings.admin.libraries.scanAdded', { count: event.added }))
  if (event.updated > 0) parts.push(t('settings.admin.libraries.scanUpdated', { count: event.updated }))
  if (event.missing > 0) parts.push(t('settings.admin.libraries.scanMissing', { count: event.missing }))
  return parts.length > 0 ? parts.join(t('settings.admin.libraries.outcomeSeparator')) : t('settings.admin.libraries.scanNothingNew')
})

/**
 * Time left from the rate since this cell first saw the job counting, so a page opened mid-scan does not
 * divide by the whole job's elapsed time. Hidden until two seconds of data exist.
 */
const rateStart = ref<{ jobId: number; at: number; processed: number } | null>(null)
watch(running, (event) => {
  if (!event || event.total <= 0) {
    if (!event) rateStart.value = null
    return
  }
  if (rateStart.value?.jobId !== event.jobId) rateStart.value = { jobId: event.jobId, at: Date.now(), processed: event.processed }
})
const timeLeft = computed(() => {
  const event = running.value
  const start = rateStart.value
  if (!event || !start || event.total <= 0 || start.jobId !== event.jobId) return ''
  const elapsedSeconds = (Date.now() - start.at) / 1000
  const done = event.processed - start.processed
  if (elapsedSeconds < 2 || done <= 0) return ''
  const seconds = Math.max(1, Math.round((event.total - event.processed) / (done / elapsedSeconds)))
  if (seconds < 60) return t('settings.admin.libraries.scanTimeLeftSeconds', { count: seconds })
  return t('settings.admin.libraries.scanTimeLeftMinutes', { count: Math.round(seconds / 60) })
})

const historyEnabled = computed(() => props.withHistory && Boolean(props.lastScan) && !running.value)

function setHistoryOpen(open: boolean) {
  emit('update:historyOpen', open)
}

function closeHistory() {
  emit('update:historyOpen', false)
}

function requestScan(library: Library) {
  emit('update:historyOpen', false)
  emit('scan', library)
}
</script>

<!-- Every state fills the same two lines, so a scan starting never changes the row height. -->
<template>
  <div class="min-h-9">
    <template v-if="state === 'running'">
      <p class="flex items-center gap-1.5 truncate text-sm font-medium text-primary" aria-live="polite">
        <RefreshCw :size="13" class="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ percent === null ? t('settings.admin.libraries.scanning') : t('settings.admin.libraries.scanningPercent', { pct: percent }) }}
      </p>
      <div class="mt-1.5 flex items-center gap-2">
        <div
          class="h-1 w-16 shrink-0 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          :aria-valuenow="percent ?? undefined"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
            :class="percent === null ? 'animate-pulse' : ''"
            :style="{ width: percent === null ? '100%' : `${percent}%` }"
          />
        </div>
        <span class="truncate text-xs tabular-nums text-muted-foreground">{{ progressLabel }}</span>
      </div>
      <p v-if="liveOutcome" data-testid="scan-live" class="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
        {{ liveOutcome }}<template v-if="timeLeft"> · {{ timeLeft }}</template>
      </p>
    </template>

    <template v-else-if="state === 'pending'">
      <p class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
    </template>

    <template v-else-if="state === 'never'">
      <p class="flex items-center gap-1.5 text-sm font-medium text-[var(--pill-warning)]">
        <TriangleAlert :size="13" class="shrink-0" aria-hidden="true" />
        {{ t('settings.admin.libraries.neverScanned') }}
      </p>
      <p class="mt-0.5 truncate text-xs text-muted-foreground">{{ t('settings.admin.libraries.neverScannedHint') }}</p>
    </template>

    <Popover v-else-if="historyEnabled && lastScan" :open="historyOpen" @update:open="setHistoryOpen">
      <PopoverTrigger as-child>
        <button
          type="button"
          data-testid="scan-status"
          class="-mx-1.5 -my-1 block w-[calc(100%+0.75rem)] rounded-md px-1.5 py-1 text-start transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LibraryScanOutcome :scan="lastScan" />
          <span class="sr-only">{{ t('settings.admin.libraries.historyFor', { name: library.name }) }}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" class="w-auto p-0">
        <LibraryScanHistoryPopover :library="library" :open="historyOpen" :scanning="false" @close="closeHistory" @scan="requestScan" />
      </PopoverContent>
    </Popover>
    <LibraryScanOutcome v-else-if="lastScan" :scan="lastScan" />
  </div>
</template>
