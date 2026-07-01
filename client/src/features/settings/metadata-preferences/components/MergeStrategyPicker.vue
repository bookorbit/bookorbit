<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MergeStrategy } from '@bookorbit/types'

const { t } = useI18n()

defineProps<{ modelValue: MergeStrategy; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [value: MergeStrategy] }>()

const options = computed<{ value: MergeStrategy; label: string; description: string }[]>(() => [
  {
    value: 'fillMissing',
    label: t('settings.metadata.mergeStrategy.fillMissing.label'),
    description: t('settings.metadata.mergeStrategy.fillMissing.description'),
  },
  {
    value: 'overwriteIfProvided',
    label: t('settings.metadata.mergeStrategy.overwriteIfProvided.label'),
    description: t('settings.metadata.mergeStrategy.overwriteIfProvided.description'),
  },
  {
    value: 'overwrite',
    label: t('settings.metadata.mergeStrategy.overwrite.label'),
    description: t('settings.metadata.mergeStrategy.overwrite.description'),
  },
])
</script>

<template>
  <select
    :value="modelValue"
    :disabled="disabled"
    class="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40 cursor-pointer"
    :title="options.find((o) => o.value === modelValue)?.description"
    @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value as MergeStrategy)"
  >
    <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
  </select>
</template>
