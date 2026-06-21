<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Globe, Loader2, MonitorSmartphone, RefreshCw, Tablet } from '@lucide/vue'
import type { AnnotationPositionFormat } from '@bookorbit/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAnnotationSyncDetail } from '../composables/useAnnotationSyncDetail'

const props = defineProps<{ annotationId: number }>()

const { detail, loading, retrying, error, load, retry } = useAnnotationSyncDetail()

const FORMAT_LABELS: Record<AnnotationPositionFormat, string> = {
  cfi: 'Web reader',
  xpointer: 'KOReader',
  pdf: 'PDF',
  kobo_span: 'Kobo',
}

const STATUS_LABELS: Record<string, string> = {
  exact: 'Exact',
  repaired: 'Repaired',
  failed: 'Failed',
  pending: 'Pending',
}

const positions = computed(() => detail.value?.positions ?? [])
const devices = computed(() => detail.value?.devices ?? [])

function formatLabel(format: AnnotationPositionFormat): string {
  return FORMAT_LABELS[format] ?? format
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

function statusClass(status: string): string {
  if (status === 'exact' || status === 'repaired') return 'border-primary/30 bg-primary/10 text-primary'
  if (status === 'failed') return 'border-destructive/30 bg-destructive/10 text-destructive'
  return 'border-border bg-muted text-muted-foreground'
}

function deviceLabel(device: { source: string; deviceId: string; deviceName: string | null }): string {
  if (device.deviceName) return device.deviceName
  if (device.source === 'koreader') return `KOReader ${device.deviceId.slice(0, 8)}`
  return `Kobo ${device.deviceId}`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function handleRetry(format: AnnotationPositionFormat) {
  void retry(props.annotationId, format)
}

onMounted(() => {
  void load(props.annotationId)
})
</script>

<template>
  <div class="mt-2 rounded-md border border-border bg-background p-2.5 text-xs">
    <div v-if="loading" class="flex items-center gap-2 text-muted-foreground">
      <Loader2 :size="13" class="animate-spin" />
      Loading sync detail
    </div>

    <div v-else-if="error" class="text-destructive">{{ error }}</div>

    <template v-else-if="detail">
      <p class="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Positions</p>
      <ul class="flex flex-col gap-1">
        <li v-for="position in positions" :key="position.format" class="flex flex-wrap items-center gap-2">
          <span class="w-24 shrink-0 text-muted-foreground">{{ formatLabel(position.format) }}</span>
          <span class="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium" :class="statusClass(position.status)">
            {{ statusLabel(position.status) }}
          </span>
          <span v-if="position.reason" class="truncate text-muted-foreground">{{ position.reason }}</span>
          <Tooltip v-if="position.status === 'failed' || position.status === 'pending'">
            <TooltipTrigger as-child>
              <button
                type="button"
                class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                :disabled="retrying === position.format"
                @click="() => handleRetry(position.format)"
              >
                <Loader2 v-if="retrying === position.format" :size="12" class="animate-spin" />
                <RefreshCw v-else :size="12" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Retry conversion</TooltipContent>
          </Tooltip>
        </li>
        <li v-if="positions.length === 0" class="text-muted-foreground">No stored positions.</li>
      </ul>

      <p class="mb-1.5 mt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Devices</p>
      <ul class="flex flex-col gap-1">
        <li v-for="device in devices" :key="`${device.source}-${device.deviceId}`" class="flex flex-wrap items-center gap-2">
          <span class="inline-flex w-40 shrink-0 items-center gap-1.5 truncate text-foreground">
            <Tablet v-if="device.source === 'kobo'" :size="12" class="shrink-0 text-muted-foreground" />
            <MonitorSmartphone v-else :size="12" class="shrink-0 text-muted-foreground" />
            {{ deviceLabel(device) }}
          </span>
          <span
            class="inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium"
            :class="device.upToDate ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground'"
          >
            {{ device.upToDate ? 'Up to date' : `Pending v${detail.version}` }}
          </span>
          <span class="text-muted-foreground">synced {{ formatDate(device.lastSyncedAt) }}</span>
        </li>
        <li v-if="devices.length === 0" class="flex items-center gap-1.5 text-muted-foreground">
          <Globe :size="12" />
          Not synced to any device yet.
        </li>
      </ul>
    </template>
  </div>
</template>
