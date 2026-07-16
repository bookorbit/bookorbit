<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  readCount: number
  totalCount: number
  compact?: boolean
  flush?: boolean
}>()

const percentage = computed(() => {
  if (props.totalCount === 0) return 0
  return Math.round((props.readCount / props.totalCount) * 100)
})

const barColorClass = computed(() => {
  if (percentage.value === 0) return 'bg-muted-foreground/30'
  if (percentage.value >= 100) return 'bg-green-500'
  return 'bg-primary'
})

const trackClass = computed(() => (props.flush ? 'h-1.5 rounded-none bg-muted/80' : 'h-1 rounded-full bg-muted'))
const fillClass = computed(() => (props.flush ? 'rounded-none' : 'rounded-full'))
</script>

<template>
  <div>
    <div class="w-full overflow-hidden" :class="trackClass">
      <div class="h-full transition-all duration-300" :class="[barColorClass, fillClass]" :style="{ width: `${percentage}%` }" />
    </div>
    <p v-if="!compact" class="mt-1 text-xs text-muted-foreground">
      {{ t('series.completion.readOfTotal', { read: readCount, total: totalCount, percentage }) }}
    </p>
  </div>
</template>
