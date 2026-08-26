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
}>()

const { t } = useI18n()
const { status, loading, failed, fetchStatus, reset } = useRequestSeedStatus(() => props.canManage)

const confirming = ref(false)
const deleteFiles = ref(false)
const removalInFlight = ref(false)

const download = computed(() => props.request.download)
const isTorrentDownload = computed(() => download.value?.source === 'magnet' || download.value?.source === 'torrent_file')

/**
 * Ratio and seeding time are not two more figures: they are the two goals the client stops on, so
 * whichever of them the client actually reported a target for is drawn as a fraction of it. A goal
 * the client did not state leaves the number to stand on its own, because there is nothing to be a
 * fraction of.
 */
interface SeedMeter {
  key: 'ratio' | 'time'
  label: string
  value: string
  percent: number | null
}

function meterPercent(current: number, goal: number): number {
  return Math.max(0, Math.min(100, (current / goal) * 100))
}

const meters = computed<SeedMeter[]>(() => {
  const current = status.value
  if (!current) return []

  const rows: SeedMeter[] = []

  if (current.ratio !== null) {
    const ratio = formatNumber(current.ratio, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const goal = current.ratioGoal !== null && current.ratioGoal > 0 ? current.ratioGoal : null
    rows.push({
      key: 'ratio',
      label: t('bookRequests.seed.ratio'),
      value: goal === null ? ratio : t('bookRequests.seed.ofGoal', { value: ratio, goal: formatNumber(goal, { maximumFractionDigits: 2 }) }),
      percent: goal === null ? null : meterPercent(current.ratio, goal),
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
      percent: goalMinutes === null ? null : meterPercent(current.seedingTimeSeconds / 60, goalMinutes),
    })
  }

  return rows
})

// A fresh request means a fresh read: a ratio from the request before this one is worse than none.
watch(
  [() => props.request.id, () => download.value?.id, () => download.value?.source],
  ([id]) => {
    deleteFiles.value = false
    removalInFlight.value = false
    reset()
    if (isTorrentDownload.value) void fetchStatus(id)
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
}

function confirmRemove() {
  if (download.value) {
    removalInFlight.value = true
    emit('remove', { request: props.request, downloadId: download.value.id, deleteFiles: deleteFiles.value })
  }
  confirming.value = false
}
</script>

<template>
  <section v-if="isTorrentDownload" class="space-y-3 rounded-lg border border-border bg-card p-4">
    <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('bookRequests.seed.title') }}</h3>

    <p v-if="download?.automated" class="text-sm text-muted-foreground">{{ t('bookRequests.seed.automated') }}</p>

    <p v-if="loading" role="status" class="text-sm text-muted-foreground">{{ t('bookRequests.seed.loading') }}</p>
    <p v-else-if="failed" role="status" class="text-sm text-muted-foreground">{{ t('bookRequests.seed.loadFailed') }}</p>
    <p v-else-if="!status" role="status" class="text-sm text-muted-foreground">{{ t('bookRequests.seed.notInClient') }}</p>

    <template v-else>
      <!-- Whether it is still seeding is the whole question, so it leads and never rides on colour alone. -->
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span
          class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium"
          :class="status.seeding ? 'border-success/40 bg-success/10 text-success' : 'border-border bg-muted text-muted-foreground'"
        >
          <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {{ status.seeding ? t('bookRequests.seed.seeding') : t('bookRequests.seed.stopped') }}
        </span>
        <span v-if="status.downloadClientName" class="truncate text-xs text-muted-foreground">{{ status.downloadClientName }}</span>
      </div>

      <dl class="space-y-2.5">
        <div v-for="meter in meters" :key="meter.key">
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-sm text-muted-foreground">{{ meter.label }}</dt>
            <dd class="text-end text-sm text-foreground tabular-nums">{{ meter.value }}</dd>
          </div>
          <!-- Redundant to the figures beside it, which is exactly why it is hidden rather than labelled. -->
          <div v-if="meter.percent !== null" data-testid="seed-meter" class="mt-1.5 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
              :style="{ width: `${meter.percent}%` }"
            />
          </div>
        </div>

        <div v-if="status.uploadedBytes !== null" class="flex items-baseline justify-between gap-4">
          <dt class="text-sm text-muted-foreground">{{ t('bookRequests.seed.uploaded') }}</dt>
          <dd class="text-end text-sm text-foreground tabular-nums">{{ formatBytes(status.uploadedBytes) }}</dd>
        </div>
      </dl>

      <!-- Separated, because a destructive control reading as one more row of the readout is how it gets clicked. -->
      <div v-if="canManage" class="space-y-2.5 border-t border-border pt-3.5">
        <p class="text-xs text-muted-foreground">{{ t('bookRequests.seed.removeHint') }}</p>

        <label class="flex items-center gap-2 text-sm text-foreground">
          <input v-model="deleteFiles" type="checkbox" class="h-3.5 w-3.5 rounded border-border accent-primary" />
          {{ t('bookRequests.seed.deleteFiles') }}
        </label>

        <Button variant="destructive-outline" size="sm" :disabled="busy" @click="handleRemove">
          {{ t('bookRequests.seed.remove') }}
        </Button>
      </div>
    </template>

    <ConfirmDialog
      :open="confirming"
      :title="t('bookRequests.seed.confirm.title')"
      :description="deleteFiles ? t('bookRequests.seed.confirm.descriptionWithFiles') : t('bookRequests.seed.confirm.description')"
      :confirm-label="t('bookRequests.seed.remove')"
      :busy="busy"
      @confirm="confirmRemove"
      @cancel="cancelRemove"
    />
  </section>
</template>
