<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, CircleAlert, RefreshCw, TriangleAlert } from '@lucide/vue'
import type { LibraryLastScan, ScanProgressEvent } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { relativeTimestamp } from '@/lib/relative-time'

const props = defineProps<{ lastScan: LibraryLastScan | null; progress: ScanProgressEvent | undefined; pending: boolean }>()

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

const timeLabel = computed(() => (props.lastScan ? relativeTimestamp(props.lastScan.startedAt) : ''))

/** "Manual - +3 added, 1 missing", or an explicit "no change" so a finished scan never reads as blank. */
const outcomeLabel = computed(() => {
  const scan = props.lastScan
  if (!scan) return ''
  const trigger = t(`settings.admin.libraries.trigger.${scan.triggeredBy}`)
  const parts: string[] = []
  if (scan.addedCount > 0) parts.push(t('settings.admin.libraries.scanAdded', { count: scan.addedCount }))
  if (scan.updatedCount > 0) parts.push(t('settings.admin.libraries.scanUpdated', { count: scan.updatedCount }))
  if (scan.missingCount > 0) parts.push(t('settings.admin.libraries.scanMissing', { count: scan.missingCount }))
  const outcome = parts.length > 0 ? parts.join(t('settings.admin.libraries.outcomeSeparator')) : t('settings.admin.libraries.scanNoChange')
  return t('settings.admin.libraries.scanOutcome', { trigger, outcome })
})

const progressLabel = computed(() => {
  const event = running.value
  if (!event) return ''
  if (event.total <= 0) return t('settings.admin.libraries.scanCounting')
  return t('settings.admin.libraries.scanCounts', { processed: formatNumber(event.processed), total: formatNumber(event.total) })
})
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

    <template v-else-if="state === 'failed'">
      <p class="flex items-center gap-1.5 text-sm font-medium text-destructive">
        <CircleAlert :size="13" class="shrink-0" aria-hidden="true" />
        <span class="truncate">{{ t('settings.admin.libraries.scanFailedAt', { time: timeLabel }) }}</span>
      </p>
      <p v-if="lastScan?.errorMessage" class="mt-0.5 truncate font-mono text-xs text-destructive" :title="lastScan.errorMessage">
        {{ lastScan.errorMessage }}
      </p>
      <p v-else class="mt-0.5 truncate text-xs text-muted-foreground">{{ outcomeLabel }}</p>
    </template>

    <template v-else>
      <p class="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Check :size="13" class="shrink-0 text-[var(--pill-success)]" aria-hidden="true" />
        <span class="truncate">{{ t('settings.admin.libraries.scannedAt', { time: timeLabel }) }}</span>
      </p>
      <p class="mt-0.5 truncate text-xs text-muted-foreground" :title="outcomeLabel">{{ outcomeLabel }}</p>
    </template>
  </div>
</template>
