<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import type { FieldCoverage } from '../lib/custom-field-coverage'

const props = withDefaults(defineProps<{ coverage: FieldCoverage; bar?: boolean }>(), { bar: true })

const { t } = useI18n()

/** A sliver stays visible for one value in hundreds, so "some" never reads as "none". */
const width = computed(() => {
  const { filled, books } = props.coverage
  if (!books || !filled) return '0%'
  return `${Math.max(4, Math.round((filled / books) * 100))}%`
})
const filled = computed(() => formatNumber(props.coverage.filled))
const total = computed(() => formatNumber(props.coverage.books))
</script>

<template>
  <span v-if="coverage.none" class="text-muted-foreground" aria-hidden="true">-</span>
  <span
    v-else
    class="inline-flex items-center gap-2.5 whitespace-nowrap tabular-nums"
    :aria-label="t('settings.metadata.customFields.coverageAria', { filled, total })"
  >
    <span v-if="bar" class="relative inline-block h-1 w-11 shrink-0 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
      <span class="absolute inset-y-0 start-0 rounded-full bg-primary" :style="{ width }" />
    </span>
    <i18n-t keypath="settings.metadata.customFields.coverage" tag="span" scope="global" class="text-muted-foreground" aria-hidden="true">
      <template #filled>
        <span :class="coverage.filled ? 'text-foreground' : 'text-muted-foreground'">{{ filled }}</span>
      </template>
      <template #total>{{ total }}</template>
    </i18n-t>
  </span>
</template>
