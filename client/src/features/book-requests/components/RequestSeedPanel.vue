<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookRequestItem } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { formatNumber } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { useRequestSeedStatus } from '../composables/useRequestSeedStatus'

const props = defineProps<{
  request: BookRequestItem
  busy: boolean
  /**
   * Moderating the queue. Decides both which endpoint serves the readout and whether the
   * destructive control is offered: stopping a seed is a decision about shared infrastructure,
   * where reading its state is not.
   */
  canManage: boolean
}>()

const emit = defineEmits<{
  remove: [payload: { request: BookRequestItem; downloadId: number; deleteFiles: boolean }]
  /** Whether the client still seeds this download, once read; null while unknown. */
  seeding: [value: boolean | null]
}>()

const { t } = useI18n()
const { status, loading, failed, fetchStatus, reset } = useRequestSeedStatus(() => props.canManage)

const confirming = ref(false)
const deleteFiles = ref(false)
const removalInFlight = ref(false)

const download = computed(() => props.request.download)
const isTorrentDownload = computed(() => download.value?.source === 'magnet' || download.value?.source === 'torrent_file')

/** A cloud client cannot hand a torrent back, so its removal copy is fixed and the file choice is not offered. */
const alwaysDeletesRemote = computed(() => status.value?.alwaysDeletesRemote ?? false)

const confirmDescription = computed(() => {
  if (alwaysDeletesRemote.value) return t('bookRequests.seed.confirm.descriptionRemoteDelete')
  return t(deleteFiles.value ? 'bookRequests.seed.confirm.descriptionWithFiles' : 'bookRequests.seed.confirm.description')
})

/** Whether it is still seeding is the whole question, so it leads, as a word and not only a dot. */
const clientActivity = computed(() => {
  if (!status.value) return null
  if (status.value.seeding) return { label: t('bookRequests.seed.seeding'), on: true }
  return { label: t('bookRequests.seed.stopped'), on: false }
})

/** A transfer still running is the card's to show; the seed is what is left once it finishes. */
const transferActive = computed(() => download.value?.status === 'queued' || download.value?.status === 'downloading')

watch(
  () => (status.value ? status.value.seeding : null),
  (value) => emit('seeding', value),
  { immediate: true },
)

/**
 * Ratio and seeding time are the two goals the client stops on, so each is stated against the
 * target the client reported for it. A goal the client did not state leaves the figure alone.
 */
interface SeedStat {
  key: 'ratio' | 'time' | 'uploaded'
  label: string
  value: string
}

const stats = computed<SeedStat[]>(() => {
  const current = status.value
  if (!current) return []

  const rows: SeedStat[] = []

  if (current.ratio !== null) {
    const ratio = formatNumber(current.ratio, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const goal = current.ratioGoal !== null && current.ratioGoal > 0 ? current.ratioGoal : null
    rows.push({
      key: 'ratio',
      label: t('bookRequests.seed.ratio'),
      value: goal === null ? ratio : t('bookRequests.seed.ofGoal', { value: ratio, goal: formatNumber(goal, { maximumFractionDigits: 2 }) }),
    })
  }

  if (current.seedingTimeSeconds !== null) {
    const hours = t('bookRequests.seed.hours', { value: formatNumber(current.seedingTimeSeconds / 3600, { maximumFractionDigits: 1 }) })
    const goalMinutes = current.seedingTimeGoalMinutes !== null && current.seedingTimeGoalMinutes > 0 ? current.seedingTimeGoalMinutes : null
    rows.push({
      key: 'time',
      label: t('bookRequests.seed.time'),
      value:
        goalMinutes === null
          ? hours
          : t('bookRequests.seed.ofGoal', {
              value: hours,
              goal: t('bookRequests.seed.hours', { value: formatNumber(goalMinutes / 60, { maximumFractionDigits: 1 }) }),
            }),
    })
  }

  if (current.uploadedBytes !== null) {
    rows.push({ key: 'uploaded', label: t('bookRequests.seed.uploaded'), value: formatBytes(current.uploadedBytes) })
  }

  return rows
})

// A fresh request means a fresh read, and an advancing attempt replaces any pre-seeding snapshot.
watch(
  () => ({
    requestId: props.request.id,
    downloadId: download.value?.id,
    source: download.value?.source,
    status: download.value?.status,
  }),
  (current, previous) => {
    const identityChanged =
      !previous || current.requestId !== previous.requestId || current.downloadId !== previous.downloadId || current.source !== previous.source

    if (identityChanged) {
      deleteFiles.value = false
      removalInFlight.value = false
      reset()
    }

    if (isTorrentDownload.value && (identityChanged || current.status !== previous.status)) {
      void fetchStatus(current.requestId)
    }
  },
  { immediate: true },
)

/**
 * The parent owns the removal call, so the only signal it finished is `busy` dropping again. A
 * removal that is not re-read leaves the panel offering to remove a torrent that is already gone.
 */
watch(
  () => props.busy,
  (busy, wasBusy) => {
    if (busy || !wasBusy || !removalInFlight.value) return
    removalInFlight.value = false
    if (download.value) void fetchStatus(props.request.id)
  },
)

function handleRemove() {
  confirming.value = true
}

function cancelRemove() {
  confirming.value = false
  deleteFiles.value = false
}

function confirmRemove() {
  if (download.value) {
    removalInFlight.value = true
    emit('remove', { request: props.request, downloadId: download.value.id, deleteFiles: alwaysDeletesRemote.value || deleteFiles.value })
  }
  confirming.value = false
  deleteFiles.value = false
}
</script>

<template>
  <div
    v-if="isTorrentDownload && !transferActive"
    class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-sm bg-muted py-1.5 ps-2.5 pe-1.5"
  >
    <p v-if="loading" role="status" class="text-xs text-muted-foreground">{{ t('bookRequests.seed.loading') }}</p>
    <p v-else-if="failed" role="status" class="text-xs text-muted-foreground">{{ t('bookRequests.seed.loadFailed') }}</p>
    <p v-else-if="!status" role="status" class="text-xs text-muted-foreground">{{ t('bookRequests.seed.notInClient') }}</p>

    <template v-else>
      <span class="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <span class="size-[7px] rounded-full" :class="clientActivity?.on ? 'bg-success' : 'bg-muted-foreground'" aria-hidden="true" />
        {{ clientActivity?.label }}
      </span>
      <span v-for="stat in stats" :key="stat.key" class="inline-flex items-baseline gap-[5px] text-xs text-muted-foreground">
        {{ stat.label }}
        <b class="font-semibold text-foreground tabular-nums">{{ stat.value }}</b>
      </span>
      <Button v-if="canManage" variant="ghost" size="sm" class="ms-auto h-7 gap-1 px-2 text-xs" :disabled="busy" @click="handleRemove">
        {{ t('bookRequests.seed.removeEllipsis') }}
      </Button>
    </template>

    <ConfirmDialog
      :open="confirming"
      :title="t('bookRequests.seed.confirm.title')"
      :description="confirmDescription"
      :confirm-label="t('bookRequests.seed.remove')"
      :cancel-label="t('bookRequests.seed.keepSeeding')"
      :busy="busy"
      @confirm="confirmRemove"
      @cancel="cancelRemove"
    >
      <label v-if="!alwaysDeletesRemote" class="mt-3.5 flex cursor-pointer items-center gap-2 text-sm text-foreground">
        <input v-model="deleteFiles" type="checkbox" class="size-3.5 shrink-0 accent-primary" />
        {{ t('bookRequests.seed.deleteFiles') }}
      </label>
      <p class="mt-2 text-xs text-muted-foreground">{{ t('bookRequests.seed.removeHint') }}</p>
    </ConfirmDialog>
  </div>
</template>
