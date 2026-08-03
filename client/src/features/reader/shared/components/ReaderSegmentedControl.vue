<script setup lang="ts">
import type { Component } from 'vue'

export interface ReaderSegmentedOption {
  value: string
  label: string
  icon?: Component
}

// aria-label falls through to the root group from the call site rather than being a prop,
// so it stays a plain attribute instead of shadowing the native one.
defineProps<{
  options: ReaderSegmentedOption[]
  modelValue: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function select(value: string) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="flex gap-1 rounded-lg bg-muted/60 p-1" role="group">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :aria-pressed="modelValue === option.value"
      class="flex h-8.5 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-offset-1 focus-visible:ring-offset-card"
      :class="
        modelValue === option.value
          ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
          : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
      "
      @click="select(option.value)"
    >
      <component :is="option.icon" v-if="option.icon" :size="14" class="shrink-0" />
      <span class="truncate">{{ option.label }}</span>
    </button>
  </div>
</template>
