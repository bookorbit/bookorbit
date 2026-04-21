<script setup lang="ts">
import type { MergeStrategy } from '@bookorbit/types'

defineProps<{ modelValue: MergeStrategy; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [value: MergeStrategy] }>()

const options: { value: MergeStrategy; label: string; description: string }[] = [
  { value: 'fillMissing', label: 'Fill missing', description: 'Only write if field is currently empty' },
  { value: 'overwriteIfProvided', label: 'Overwrite if provided', description: 'Write if provider returned a value' },
  { value: 'overwrite', label: 'Always overwrite', description: 'Always replace existing value' },
]
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
