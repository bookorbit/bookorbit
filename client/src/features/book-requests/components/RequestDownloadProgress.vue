<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw } from '@lucide/vue'
import type { BookRequestDownloadItem, BookRequestProgressEvent } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatPercent } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { currentRequestProgress } from '../requestPipeline'
import { protocolChipClass, sourceChipClass } from '../sourceColors'

const props = withDefaults(
  defineProps<{
    download: BookRequestDownloadItem
    /** A live tick, when one has arrived since the list was last fetched. */
    live: BookRequestProgressEvent | null
    /** Off when something else on the page already explains this failure at greater length. */
    showError?: boolean
    /** Recovery stays permission-gated by the request detail that owns the release picker. */
    canRetry?: boolean
  }>(),
  { showError: true, canRetry: false },
)

const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()

const currentLive = computed(() => currentRequestProgress({ status: 'grabbed', download: props.download }, props.live))
const status = computed(() => currentLive.value?.status ?? props.download.status)
const percent = computed(() => Math.max(0, Math.min(100, currentLive.value?.progressPercent ?? props.download.progressPercent)))
/** Locale-formatted: where the percent sign goes, and whether it takes a space, is not universal. */
const percentLabel = computed(() => formatPercent(percent.value / 100))
const downloadedBytes = computed(() => currentLive.value?.downloadedBytes ?? props.download.downloadedBytes)
const totalBytes = computed(() => currentLive.value?.totalBytes ?? props.download.totalBytes)

/** Only a live transfer has a meaningful bar; everything else is a state, not a proportion. */
const showBar = computed(() => status.value === 'queued' || status.value === 'downloading')
const showRetry = computed(() => status.value === 'failed' && props.canRetry)

/**
 * Which source this came from, and how. A finished transfer says only that the book arrived, and
 * the one thing an approver asks about it afterwards is where it came from - not least because
 * the release that worked is often not the one the request started with.
 */
const isTorrent = computed(() => props.download.source !== 'direct_url')
const sourceName = computed(() => props.download.indexerName ?? t('bookRequests.download.source.pasted'))
const protocolName = computed(() => t(isTorrent.value ? 'bookRequests.releases.protocol.torrent' : 'bookRequests.releases.protocol.direct'))
const selectionName = computed(() => t(props.download.automated ? 'bookRequests.download.source.automatic' : 'bookRequests.download.source.manual'))

const sizeLine = computed(() => {
  if (totalBytes.value) {
    return t('bookRequests.download.transferred', {
      done: formatBytes(downloadedBytes.value),
      total: formatBytes(totalBytes.value),
    })
  }
  return downloadedBytes.value > 0 ? t('bookRequests.download.transferredUnknown', { done: formatBytes(downloadedBytes.value) }) : null
})

function handleRetry() {
  emit('retry')
}
</script>

<template>
  <div class="mt-3 rounded-md border border-border bg-muted/40 p-2">
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span class="text-foreground">{{ t(`bookRequests.download.status.${status}`) }}</span>
      <span v-if="showBar" class="text-muted-foreground tabular-nums">{{ percentLabel }}</span>
    </div>

    <div
      v-if="showBar"
      class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border"
      role="progressbar"
      :aria-valuenow="percent"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="t('bookRequests.download.progressLabel', { title: download.releaseTitle })"
    >
      <div class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none" :style="{ width: `${percent}%` }" />
    </div>

    <p v-if="showBar && sizeLine" class="settings-hint tabular-nums">{{ sizeLine }}</p>
    <p v-if="props.showError && download.errorMessage" class="settings-hint">{{ download.errorMessage }}</p>
    <p class="settings-hint break-all">{{ download.releaseTitle }}</p>
    <Button v-if="showRetry" variant="outline" size="sm" class="mt-2" @click="handleRetry">
      <RefreshCw :size="14" aria-hidden="true" />
      {{ t('bookRequests.actions.retryRelease') }}
    </Button>
    <div class="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      <span class="rounded-full border px-1.5 py-px font-medium" :class="sourceChipClass(download.indexerColor)">
        {{ sourceName }}
      </span>
      <span class="rounded-full border px-1.5 py-px font-medium" :class="protocolChipClass(isTorrent)">
        {{ protocolName }}
      </span>
      <span
        v-if="download.downloadClientName"
        class="rounded-full border px-1.5 py-px font-medium"
        :class="sourceChipClass(download.downloadClientColor)"
      >
        {{ download.downloadClientName }}
      </span>
      <span class="text-muted-foreground">{{ selectionName }}</span>
    </div>
  </div>
</template>
