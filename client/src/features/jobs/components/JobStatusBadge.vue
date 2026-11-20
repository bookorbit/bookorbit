<script setup lang="ts">
import { computed } from 'vue'
import { Ban, Check, Pause, ScanEye, TriangleAlert } from '@lucide/vue'
import type { JobStatus } from '@bookorbit/types'

import { jobStatusLabel } from '../lib/job-copy'

const props = defineProps<{ status: JobStatus }>()

/** The status is always spelled out beside its colour, and the settled ones carry an icon too. */
const TONES: Record<JobStatus, string> = {
  running: 'border-primary/40 bg-primary/10 text-primary',
  queued: 'border-border bg-muted text-foreground',
  paused: 'border-warning/40 bg-warning/10 text-warning',
  'needs-you': 'border-info/40 bg-info/10 text-info',
  failed: 'border-destructive/40 bg-destructive/10 text-destructive',
  completed: 'border-success/40 bg-success/10 text-success',
  cancelled: 'border-border bg-muted text-muted-foreground',
}

const tone = computed(() => TONES[props.status] ?? TONES.queued)
const label = computed(() => jobStatusLabel(props.status))
</script>

<template>
  <span
    class="inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium whitespace-nowrap"
    :class="tone"
    data-testid="job-status"
  >
    <Check v-if="status === 'completed'" :size="12" :stroke-width="2.5" aria-hidden="true" />
    <TriangleAlert v-else-if="status === 'failed'" :size="12" aria-hidden="true" />
    <Pause v-else-if="status === 'paused'" :size="12" aria-hidden="true" />
    <Ban v-else-if="status === 'cancelled'" :size="12" aria-hidden="true" />
    <ScanEye v-else-if="status === 'needs-you'" :size="12" aria-hidden="true" />
    <span v-else class="relative flex size-1.5" aria-hidden="true">
      <span v-if="status === 'running'" class="absolute inline-flex size-full rounded-full bg-current opacity-60 motion-safe:animate-ping" />
      <span class="relative inline-flex size-1.5 rounded-full bg-current" />
    </span>
    {{ label }}
  </span>
</template>
