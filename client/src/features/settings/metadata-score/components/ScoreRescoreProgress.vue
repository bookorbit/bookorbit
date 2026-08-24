<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, RefreshCw, X } from '@lucide/vue'
import type { MetadataScoreRecalculationStatus } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'

const { t } = useI18n()

const props = defineProps<{
  status: MetadataScoreRecalculationStatus
  /** Library size, so a run can show progress rather than only a rising count. */
  totalBooks: number
}>()

const emit = defineEmits<{ dismiss: [] }>()

const running = computed(() => props.status.state === 'running')
const failed = computed(() => props.status.state === 'failed')

const percent = computed(() => {
  if (props.totalBooks <= 0) return null
  return Math.min(100, Math.round((props.status.processed / props.totalBooks) * 100))
})

function dismiss() {
  emit('dismiss')
}
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5 md:px-6"
    :class="failed ? 'border-destructive/30 bg-destructive/10' : 'border-primary/20 bg-primary/5'"
    role="status"
    aria-live="polite"
  >
    <component
      :is="failed ? AlertTriangle : RefreshCw"
      :size="14"
      class="shrink-0"
      :class="[failed ? 'text-destructive' : 'text-primary', running ? 'animate-spin' : '']"
      aria-hidden="true"
    />
    <p class="text-sm font-medium" :class="failed ? 'text-destructive' : 'text-foreground'">
      {{ failed ? t('settings.admin.scoreWeights.progress.failed') : t('settings.admin.scoreWeights.progress.running') }}
    </p>

    <p class="text-xs tabular-nums text-muted-foreground">
      <template v-if="totalBooks > 0">
        {{ t('settings.admin.scoreWeights.progress.countOf', { processed: formatNumber(status.processed), total: formatNumber(totalBooks) }) }}
      </template>
      <template v-else>
        {{ t('settings.admin.scoreWeights.progress.count', { processed: formatNumber(status.processed) }) }}
      </template>
      <template v-if="status.failed > 0"> {{ ' ' }}{{ t('settings.admin.scoreWeights.progress.failedCount', { count: status.failed }) }} </template>
    </p>

    <div v-if="running && percent !== null" class="order-last min-w-40 flex-1 basis-full md:order-none md:basis-auto">
      <div
        class="h-1.5 overflow-hidden rounded-full bg-foreground/10"
        role="progressbar"
        :aria-valuenow="percent"
        aria-valuemin="0"
        aria-valuemax="100"
        :aria-label="t('settings.admin.scoreWeights.progress.running')"
      >
        <div class="h-full rounded-full bg-primary transition-[width] duration-500" :style="{ width: `${percent}%` }" />
      </div>
    </div>

    <p v-if="failed && status.error" class="basis-full text-xs text-destructive md:basis-auto">{{ status.error }}</p>

    <button
      v-if="failed"
      type="button"
      class="ml-auto flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      :aria-label="t('settings.admin.scoreWeights.progress.dismiss')"
      @click="dismiss"
    >
      <X :size="14" aria-hidden="true" />
    </button>
    <p v-else class="ml-auto text-xs text-muted-foreground">{{ t('settings.admin.scoreWeights.progress.safeToLeave') }}</p>
  </div>
</template>
