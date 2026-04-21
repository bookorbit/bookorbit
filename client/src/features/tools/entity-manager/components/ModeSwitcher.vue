<script setup lang="ts">
type Mode = 'duplicates' | 'browse'

defineProps<{ modelValue: Mode }>()
const emit = defineEmits<{ 'update:modelValue': [value: Mode] }>()

const modes: { value: Mode; label: string }[] = [
  { value: 'browse', label: 'Browse & Manage' },
  { value: 'duplicates', label: 'Find Duplicates' },
]

function handleSelect(value: Mode): void {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="flex gap-1 rounded-lg border border-border p-0.5">
    <button
      v-for="m in modes"
      :key="m.value"
      class="px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
      :class="modelValue === m.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'"
      @click="handleSelect(m.value)"
    >
      {{ m.label }}
    </button>
  </div>
</template>
