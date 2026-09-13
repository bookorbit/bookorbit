<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function handleToggle() {
  emit('update:modelValue', !props.modelValue)
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer overflow-hidden rounded-full border-2 border-transparent p-0 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
    :class="modelValue ? 'bg-primary' : 'bg-muted'"
    :disabled="disabled"
    @click="handleToggle"
  >
    <span
      class="pointer-events-none absolute top-0 inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-[inset-inline-start]"
      :class="modelValue ? 'start-4' : 'start-0'"
      style="transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1)"
    />
  </button>
</template>
