<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  ownedCount: number
  expectedCount: number
}>()

const percentage = computed(() => {
  if (props.expectedCount <= 0) return 0
  return Math.min(100, Math.round((props.ownedCount / props.expectedCount) * 100))
})

const barColorClass = computed(() => (props.ownedCount >= props.expectedCount ? 'bg-green-500' : 'bg-primary'))

const caption = computed(() => t('series.ownership.ownedOfExpected', { owned: props.ownedCount, expected: props.expectedCount }))
</script>

<template>
  <div>
    <div
      class="h-1 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      :aria-label="t('series.ownership.label')"
      :aria-valuenow="ownedCount"
      :aria-valuemin="0"
      :aria-valuemax="expectedCount"
      :aria-valuetext="caption"
    >
      <div class="h-full rounded-full transition-all duration-300" :class="barColorClass" :style="{ width: `${percentage}%` }" />
    </div>
    <p class="mt-1 text-xs text-muted-foreground">{{ caption }}</p>
  </div>
</template>
