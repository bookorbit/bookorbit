<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, RefreshCw } from '@lucide/vue'
import type { DuplicateScanStatus } from '@bookorbit/types'
import { formatDateTime } from '@/i18n/formatters'

import DuplicateThresholdMenu from './DuplicateThresholdMenu.vue'

const props = defineProps<{
  total: number
  scanning: boolean
  scanStatus: DuplicateScanStatus | null
  minSimilarity: number
  isInline: boolean
}>()

const emit = defineEmits<{
  'update:minSimilarity': [value: number]
  recompute: []
}>()

const { t } = useI18n()

const isComputing = computed(() => props.scanStatus?.state === 'computing')
const computedAt = computed(() => {
  const status = props.scanStatus
  return status?.state === 'done' && status.computedAt ? formatDateTime(new Date(status.computedAt)) : null
})

function handleUpdateMinSimilarity(value: number): void {
  emit('update:minSimilarity', value)
}

function handleRecompute(): void {
  emit('recompute')
}
</script>

<template>
  <p class="text-sm font-semibold text-foreground">
    {{ t('tools.entityManager.duplicates.clustersFound', { count: total }) }}
  </p>

  <DuplicateThresholdMenu :min-similarity="minSimilarity" :disabled="scanning" @update:min-similarity="handleUpdateMinSimilarity" />

  <span v-if="scanning" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
    <Loader2 :size="13" class="animate-spin" aria-hidden="true" />
    {{ t('tools.entityManager.duplicates.scanning') }}
  </span>

  <template v-if="!isInline">
    <span v-if="isComputing" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 :size="13" class="animate-spin" aria-hidden="true" />
      {{ t('tools.entityManager.duplicates.computing') }}
      <template v-if="scanStatus?.progressPct !== null && scanStatus?.progressPct !== undefined">{{ scanStatus.progressPct }}%</template>
    </span>
    <template v-else>
      <span v-if="computedAt" class="hidden text-xs text-muted-foreground lg:inline">
        {{ t('tools.entityManager.duplicates.computedAt', { date: computedAt }) }}
      </span>
      <button
        type="button"
        class="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="handleRecompute"
      >
        <RefreshCw :size="13" class="text-muted-foreground" aria-hidden="true" />
        {{ scanStatus?.state === 'idle' ? t('tools.entityManager.duplicates.computeNow') : t('tools.entityManager.duplicates.recompute') }}
      </button>
    </template>
  </template>
</template>
