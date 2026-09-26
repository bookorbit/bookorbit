<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Download, LoaderCircle, X } from '@lucide/vue'
import type { PodcastDownloadBatchItemStatus } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { usePodcastDownloadBatches } from '../composables/usePodcastDownloadBatches'

const CLEARANCE_CSS_VAR = '--podcast-download-widget-clearance'
const MIN_CLEARANCE_GAP_PX = 12

const { t } = useI18n()
const downloads = usePodcastDownloadBatches()
const expanded = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const batches = downloads.batches

const totals = computed(() => {
  const result = { total: 0, queued: 0, downloading: 0, completed: 0, failed: 0, cancelled: 0 }
  for (const batch of batches.value) {
    result.total += batch.total
    result.queued += batch.queued
    result.downloading += batch.downloading
    result.completed += batch.completed
    result.failed += batch.failed
    result.cancelled += batch.cancelled
  }
  return result
})
const finished = computed(() => totals.value.completed + totals.value.failed + totals.value.cancelled)
const progressPercent = computed(() => (totals.value.total > 0 ? Math.round((finished.value / totals.value.total) * 100) : 0))
const hasActive = computed(() => totals.value.queued + totals.value.downloading > 0)
const hasFailures = computed(() => totals.value.failed > 0)
const summary = computed(() => {
  if (hasFailures.value) {
    return t('podcast.downloadWidget.progressWithFailures', {
      completed: formatNumber(totals.value.completed),
      total: formatNumber(totals.value.total),
      failed: formatNumber(totals.value.failed),
    })
  }
  if (totals.value.cancelled > 0) {
    return t('podcast.downloadWidget.progressWithCancelled', {
      completed: formatNumber(totals.value.completed),
      total: formatNumber(totals.value.total),
      cancelled: formatNumber(totals.value.cancelled),
    })
  }
  if (!hasActive.value) return t('podcast.downloadWidget.complete', { count: formatNumber(totals.value.completed) })
  return t('podcast.downloadWidget.progress', {
    completed: formatNumber(totals.value.completed),
    total: formatNumber(totals.value.total),
  })
})

let resizeObserver: ResizeObserver | null = null

function toggleExpanded(): void {
  expanded.value = !expanded.value
}

function dismissBatch(batchId: string): void {
  downloads.dismiss(batchId)
}

function statusLabel(status: PodcastDownloadBatchItemStatus): string {
  return t(`podcast.downloadWidget.status.${status}`)
}

function itemSize(receivedBytes: number, totalBytes: number | null): string {
  if (totalBytes === null) return receivedBytes > 0 ? formatBytes(receivedBytes) : ''
  return t('podcast.downloadWidget.bytes', { received: formatBytes(receivedBytes), total: formatBytes(totalBytes) })
}

function itemProgress(receivedBytes: number, totalBytes: number | null): number | null {
  if (totalBytes === null || totalBytes <= 0) return null
  return Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
}

function canDismiss(batch: (typeof batches.value)[number]): boolean {
  return batch.queued === 0 && batch.downloading === 0
}

function setClearance(pixels: number): void {
  if (typeof document === 'undefined') return
  const clamped = Number.isFinite(pixels) ? Math.max(0, Math.ceil(pixels)) : 0
  document.documentElement.style.setProperty(CLEARANCE_CSS_VAR, `${clamped}px`)
}

function updateClearance(): void {
  if (typeof window === 'undefined') return
  const root = rootRef.value
  if (!root || batches.value.length === 0) {
    setClearance(0)
    return
  }
  const rect = root.getBoundingClientRect()
  setClearance(rect.height > 0 && rect.width > 0 ? window.innerHeight - rect.top + MIN_CLEARANCE_GAP_PX : 0)
}

function attachResizeObserver(): void {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (typeof ResizeObserver === 'undefined' || !rootRef.value) return
  resizeObserver = new ResizeObserver(updateClearance)
  resizeObserver.observe(rootRef.value)
}

watch(
  () => batches.value.length,
  (count) => {
    if (count === 0) expanded.value = false
    void nextTick(updateClearance)
  },
)

onMounted(() => {
  downloads.start()
  window.addEventListener('resize', updateClearance)
  attachResizeObserver()
  void nextTick(updateClearance)
})

onUnmounted(() => {
  downloads.stop()
  resizeObserver?.disconnect()
  window.removeEventListener('resize', updateClearance)
  setClearance(0)
})
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
    enter-from-class="translate-y-3 opacity-0"
    leave-active-class="transition duration-150 ease-in motion-reduce:transition-none"
    leave-to-class="translate-y-3 opacity-0"
  >
    <section
      v-if="batches.length > 0"
      ref="rootRef"
      class="fixed inset-x-3 z-50 overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[var(--elevation-xl)] backdrop-blur md:inset-x-auto md:right-6 md:w-96"
      style="bottom: max(1.5rem, var(--podcast-mini-player-clearance, 0px), var(--tts-mini-player-clearance, 0px))"
      :aria-label="t('podcast.downloadWidget.title')"
      data-testid="podcast-download-widget"
    >
      <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ summary }}</p>
      <div class="flex items-center gap-3 px-3 py-2.5">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LoaderCircle v-if="hasActive" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <AlertCircle v-else-if="hasFailures" class="size-4 text-destructive" aria-hidden="true" />
          <CheckCircle2 v-else class="size-4" aria-hidden="true" />
        </div>
        <button
          type="button"
          class="min-w-0 flex-1 rounded-md text-start outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          :aria-expanded="expanded"
          :aria-label="expanded ? t('podcast.downloadWidget.collapse') : t('podcast.downloadWidget.expand')"
          @click="toggleExpanded"
        >
          <span class="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <Download class="size-3.5" aria-hidden="true" />
            {{ t('podcast.downloadWidget.title') }}
          </span>
          <span class="mt-0.5 block truncate text-xs text-muted-foreground">{{ summary }}</span>
        </button>
        <Button
          variant="ghost"
          size="icon"
          class="shrink-0 rounded-full text-muted-foreground"
          :aria-label="expanded ? t('podcast.downloadWidget.collapse') : t('podcast.downloadWidget.expand')"
          @click="toggleExpanded"
        >
          <ChevronDown v-if="expanded" class="size-4" />
          <ChevronUp v-else class="size-4" />
        </Button>
      </div>
      <div
        class="h-1 bg-muted"
        role="progressbar"
        :aria-label="t('podcast.downloadWidget.overallProgress')"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-valuenow="progressPercent"
        :aria-valuetext="summary"
      >
        <div class="h-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" :style="{ width: `${progressPercent}%` }" />
      </div>

      <div v-if="expanded" class="max-h-[min(60svh,32rem)] space-y-3 overflow-y-auto border-t border-border p-3" data-testid="download-batch-list">
        <article v-for="batch in batches" :key="batch.id" class="rounded-xl border border-border bg-background/60 p-2.5">
          <header class="flex items-start gap-2">
            <div class="min-w-0 flex-1">
              <h2 class="truncate text-sm font-semibold">{{ batch.podcastTitle ?? t('podcast.downloadWidget.unknownPodcast') }}</h2>
              <p class="text-xs text-muted-foreground">
                {{ t('podcast.downloadWidget.batchProgress', { completed: formatNumber(batch.completed), total: formatNumber(batch.total) }) }}
              </p>
            </div>
            <Button
              v-if="canDismiss(batch)"
              variant="ghost"
              size="icon-sm"
              class="shrink-0 rounded-full text-muted-foreground"
              :aria-label="t('podcast.downloadWidget.dismiss')"
              @click="dismissBatch(batch.id)"
            >
              <X class="size-3.5" />
            </Button>
          </header>
          <ul class="mt-2 space-y-1.5">
            <li v-for="(item, index) in batch.items" :key="item.episodeId ?? index" class="rounded-lg bg-muted/50 px-2.5 py-2">
              <div class="flex items-center gap-2 text-xs">
                <span class="min-w-0 flex-1 truncate font-medium text-foreground">{{
                  item.title ?? t('podcast.downloadWidget.unknownEpisode')
                }}</span>
                <span class="shrink-0 text-muted-foreground">{{ statusLabel(item.status) }}</span>
              </div>
              <div v-if="item.status === 'downloading'" class="mt-1.5">
                <div
                  class="h-1 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  :aria-label="t('podcast.downloadWidget.episodeProgress', { title: item.title ?? t('podcast.downloadWidget.unknownEpisode') })"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-valuenow="itemProgress(item.receivedBytes, item.totalBytes) ?? undefined"
                >
                  <div
                    class="h-full rounded-full bg-primary"
                    :class="itemProgress(item.receivedBytes, item.totalBytes) === null ? 'w-1/3 animate-pulse motion-reduce:animate-none' : ''"
                    :style="
                      itemProgress(item.receivedBytes, item.totalBytes) === null
                        ? undefined
                        : { width: `${itemProgress(item.receivedBytes, item.totalBytes)}%` }
                    "
                  />
                </div>
                <p v-if="itemSize(item.receivedBytes, item.totalBytes)" class="mt-1 text-end text-[11px] tabular-nums text-muted-foreground">
                  {{ itemSize(item.receivedBytes, item.totalBytes) }}
                </p>
              </div>
            </li>
          </ul>
        </article>
      </div>
    </section>
  </Transition>
</template>
