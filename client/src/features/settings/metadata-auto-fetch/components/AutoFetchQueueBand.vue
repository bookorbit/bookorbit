<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { CirclePause, LoaderCircle, Pause, Play, RefreshCw, TriangleAlert } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'
import BookMetadataFetchReportModal from '@/features/book-metadata-fetch/components/BookMetadataFetchReportModal.vue'
import { useBookMetadataFetchActions } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchActions'
import { useBookMetadataFetchStatus } from '@/features/book-metadata-fetch/composables/useBookMetadataFetchStatus'

const { t } = useI18n()
const { status, subscribe } = useBookMetadataFetchStatus()
const { pause, resume, cancelPending, retryFailed } = useBookMetadataFetchActions()

const acting = ref(false)
const confirmingCancel = ref(false)
const showReport = ref(false)

onMounted(subscribe)

// Kept between items, like the floating widget, so the line does not flicker empty on every book.
const lastItemName = ref<string | null>(null)
watch(
  () => status.value.currentItemName,
  (name) => {
    if (name) lastItemName.value = name
  },
  { immediate: true },
)
watch(
  () => status.value.sessionTotal,
  (total) => {
    if (total === 0) lastItemName.value = null
  },
)

const remaining = computed(() => status.value.queued + status.value.processing)
const state = computed<'hidden' | 'running' | 'paused' | 'failed'>(() => {
  if (remaining.value > 0) return status.value.paused ? 'paused' : 'running'
  return status.value.failed > 0 ? 'failed' : 'hidden'
})
const progress = computed(() => (status.value.sessionTotal > 0 ? Math.min(100, (status.value.sessionDone / status.value.sessionTotal) * 100) : 0))

async function run(action: () => Promise<unknown>, failureKey: string) {
  if (acting.value) return
  acting.value = true
  try {
    await action()
  } catch {
    toast.error(t(failureKey))
  } finally {
    acting.value = false
  }
}

function handlePause() {
  return run(pause, 'bookMetadataFetch.toast.failedToPause')
}

function handleResume() {
  return run(resume, 'bookMetadataFetch.toast.failedToResume')
}

function askCancel() {
  confirmingCancel.value = true
}

function keepRunning() {
  confirmingCancel.value = false
}

function handleCancel() {
  confirmingCancel.value = false
  return run(cancelPending, 'bookMetadataFetch.toast.failedToCancel')
}

async function handleRetry() {
  await run(async () => {
    await retryFailed()
    toast.success(t('bookMetadataFetch.toast.failedItemsRequeued'))
  }, 'bookMetadataFetch.toast.failedToRetry')
}

function openReport() {
  showReport.value = true
}

function closeReport() {
  showReport.value = false
}
</script>

<template>
  <section
    v-if="state !== 'hidden'"
    class="flex flex-wrap items-center gap-x-3.5 gap-y-3 rounded-lg border border-border bg-card px-4 py-3 shadow-xs"
    role="status"
    aria-live="polite"
    data-testid="auto-fetch-queue"
  >
    <span
      class="grid size-[34px] shrink-0 place-items-center rounded-[9px]"
      :class="state === 'failed' ? 'bg-warning/16 text-warning' : state === 'paused' ? 'bg-muted text-foreground' : 'bg-primary/13 text-primary'"
      aria-hidden="true"
    >
      <TriangleAlert v-if="state === 'failed'" :size="16" />
      <CirclePause v-else-if="state === 'paused'" :size="16" />
      <LoaderCircle v-else :size="16" class="animate-spin motion-reduce:animate-none" />
    </span>

    <div class="min-w-0 flex-1 basis-[calc(100%-48px)] sm:basis-0">
      <template v-if="state === 'failed'">
        <p class="text-sm font-medium text-foreground">{{ t('settings.metadata.autoFetch.queue.failed', { count: status.failed }) }}</p>
      </template>
      <template v-else>
        <p class="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-foreground">
          {{ state === 'paused' ? t('bookMetadataFetch.label.paused') : t('bookMetadataFetch.card.fetchingMetadata') }}
          <span v-if="status.sessionTotal > 0" class="text-xs font-medium text-muted-foreground tabular-nums">
            {{
              t('settings.metadata.autoFetch.queue.progress', { done: formatNumber(status.sessionDone), total: formatNumber(status.sessionTotal) })
            }}
          </span>
        </p>
        <div class="mt-[7px] h-1 max-w-[40rem] overflow-hidden rounded-full bg-muted" aria-hidden="true">
          <span
            class="block h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
            :class="state === 'paused' ? 'bg-muted-foreground' : 'bg-primary'"
            :style="{ width: `${progress}%` }"
          />
        </div>
        <p class="mt-[5px] flex min-w-0 items-baseline gap-1.5 text-xs text-muted-foreground">
          <span class="shrink-0">{{ t('bookMetadataFetch.label.remaining', { count: formatNumber(remaining) }) }}</span>
          <template v-if="lastItemName && state === 'running'">
            <span aria-hidden="true">·</span>
            <span class="truncate text-foreground">{{ lastItemName }}</span>
          </template>
          <template v-if="status.failed > 0">
            <span aria-hidden="true">·</span>
            <button type="button" class="shrink-0 font-medium text-primary underline-offset-4 hover:underline" @click="openReport">
              {{ t('bookMetadataFetch.viewFailed', { count: status.failed }) }}
            </button>
          </template>
        </p>
      </template>
    </div>

    <div v-if="confirmingCancel" class="flex w-full flex-wrap items-center gap-2 ps-12 sm:w-auto sm:ps-0">
      <p class="text-xs text-muted-foreground">{{ t('bookMetadataFetch.cancel.processingWillFinish') }}</p>
      <Button size="sm" variant="destructive" :disabled="acting" @click="handleCancel">{{ t('bookMetadataFetch.cancel.confirm') }}</Button>
      <Button size="sm" variant="outline" :disabled="acting" @click="keepRunning">{{ t('bookMetadataFetch.cancel.keepRunning') }}</Button>
    </div>
    <div v-else class="flex w-full shrink-0 items-center gap-2 ps-12 sm:w-auto sm:ps-0">
      <template v-if="state === 'failed'">
        <Button size="sm" variant="ghost" @click="openReport">{{ t('bookMetadataFetch.viewFailed', { count: status.failed }) }}</Button>
        <Button size="sm" variant="outline" :disabled="acting" @click="handleRetry">
          <RefreshCw :size="13" aria-hidden="true" />
          {{ t('bookMetadataFetch.report.retryAllFailed') }}
        </Button>
      </template>
      <template v-else>
        <Button v-if="state === 'running'" size="sm" variant="outline" :disabled="acting" @click="handlePause">
          <Pause :size="13" aria-hidden="true" />
          {{ t('bookMetadataFetch.actions.pause') }}
        </Button>
        <Button v-else size="sm" variant="outline" :disabled="acting" @click="handleResume">
          <Play :size="13" aria-hidden="true" />
          {{ t('bookMetadataFetch.actions.resume') }}
        </Button>
        <Button v-if="status.queued > 0" size="sm" variant="ghost" :disabled="acting" @click="askCancel">{{
          t('bookMetadataFetch.actions.cancelQueued')
        }}</Button>
      </template>
    </div>
  </section>
  <BookMetadataFetchReportModal v-if="showReport" @close="closeReport" />
</template>
