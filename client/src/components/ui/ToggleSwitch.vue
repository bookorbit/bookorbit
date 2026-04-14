<script setup lang="ts">
defineProps<{ modelValue: boolean; disabled?: boolean }>()
defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
    :class="modelValue ? 'bg-primary' : 'bg-muted'"
    :disabled="disabled"
    @click="$emit('update:modelValue', !modelValue)"
  >
    <span
      class="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
      :class="modelValue ? 'translate-x-4' : 'translate-x-0'"
      style="transition-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1)"
    />
  </button>
</template>
