<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { BREAKDOWN_OPTIONS, type BreakdownDimension } from '../lib/breakdown'

const { t } = useI18n()
const model = defineModel<BreakdownDimension>({ required: true })
</script>

<template>
  <select
    v-model="model"
    class="border-border bg-background text-foreground rounded-md border px-2 py-1 text-xs"
    :aria-label="t('statistics.breakdown.ariaLabel')"
  >
    <option v-for="option in BREAKDOWN_OPTIONS" :key="option.value" :value="option.value">{{ option.label }}</option>
  </select>
</template>
