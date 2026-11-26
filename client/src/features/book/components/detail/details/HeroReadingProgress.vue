<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { progressPercentLabel } from '@/features/book/lib/progress-percent'

const props = defineProps<{
  percentage: number
}>()

const { t } = useI18n()

const label = computed(() => progressPercentLabel(props.percentage, t))
const width = computed(() => `${Math.max(2, Math.min(100, props.percentage))}%`)
</script>

<template>
  <span class="inline-flex items-center gap-1.5 text-xs font-medium tabular-nums text-muted-foreground" data-test="hero-progress">
    <span class="block h-1 w-12 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <span class="block h-full rounded-full bg-primary" :style="{ width }" />
    </span>
    <span aria-hidden="true">{{ label }}</span>
    <span class="sr-only">{{ t('book.detail.details.heroProgress', { percent: label }) }}</span>
  </span>
</template>
