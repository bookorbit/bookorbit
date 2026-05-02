<script setup lang="ts">
import { computed } from 'vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{ value: number | null }>()

const clamped = computed(() => (props.value == null ? null : Math.min(100, Math.max(0, props.value))))
const displayPct = computed(() => (clamped.value == null ? null : `${parseFloat(clamped.value.toFixed(2))}%`))
const barColor = computed(() => {
  if (clamped.value == null) return 'bg-primary'
  if (clamped.value >= 75) return 'bg-green-500'
  if (clamped.value >= 25) return 'bg-amber-400'
  return 'bg-primary'
})
</script>

<template>
  <Tooltip v-if="clamped !== null">
    <TooltipTrigger as-child>
      <div class="flex min-w-0 items-center gap-2" role="progressbar" :aria-valuenow="clamped ?? undefined" aria-valuemin="0" aria-valuemax="100">
        <div class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
          <div class="h-full rounded-full transition-all" :class="barColor" :style="{ width: `${clamped}%` }" />
        </div>
        <span class="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{{ displayPct }}</span>
      </div>
    </TooltipTrigger>
    <TooltipContent>{{ displayPct }} complete</TooltipContent>
  </Tooltip>
  <span v-else class="text-xs text-muted-foreground/40">-</span>
</template>
