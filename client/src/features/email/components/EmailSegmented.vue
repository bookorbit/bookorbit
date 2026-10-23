<script setup lang="ts">
import type { Component } from 'vue'

export interface SegmentOption {
  value: string | null
  label: string
  icon?: Component
  disabled?: boolean
}

const props = defineProps<{
  modelValue: string | null
  options: SegmentOption[]
  /** Read as the group's accessible name. */
  label: string
  disabled?: boolean
  /** Chips for a short list of presets; the default is a joined control. */
  variant?: 'segmented' | 'chips'
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>()

/** The checked option takes the tab stop; with none checked, the first that can be chosen does. */
function tabStop(option: SegmentOption): number {
  if (option.value === props.modelValue) return 0
  const anyChecked = props.options.some((candidate) => candidate.value === props.modelValue)
  return !anyChecked && option === props.options.find((candidate) => !candidate.disabled) ? 0 : -1
}

function select(value: string | null) {
  emit('update:modelValue', value)
}

/** A radio group moves with the arrow keys, skipping options that cannot be chosen. */
function handleKeydown(event: KeyboardEvent) {
  const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown'
  const backward = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
  if (!forward && !backward) return
  event.preventDefault()
  const enabled = props.options.filter((option) => !option.disabled)
  if (enabled.length === 0) return
  const current = enabled.findIndex((option) => option.value === props.modelValue)
  const step = (forward ? 1 : -1) * (document.dir === 'rtl' && (event.key === 'ArrowRight' || event.key === 'ArrowLeft') ? -1 : 1)
  const next = enabled[(current + step + enabled.length) % enabled.length]
  if (!next) return
  select(next.value)
  const group = event.currentTarget as HTMLElement
  requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
}
</script>

<template>
  <div
    role="radiogroup"
    :aria-label="label"
    class="max-w-full flex-wrap self-start"
    :class="[
      variant === 'chips' ? 'flex gap-1.5' : 'inline-flex items-center gap-0.5 rounded-[9px] border border-border bg-background/55 p-[3px]',
      disabled ? 'opacity-50' : '',
    ]"
    @keydown="handleKeydown"
  >
    <button
      v-for="option in options"
      :key="option.value ?? 'none'"
      type="button"
      role="radio"
      :aria-checked="modelValue === option.value"
      :tabindex="tabStop(option)"
      :disabled="disabled || option.disabled"
      class="inline-flex items-center gap-1.5 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
      :class="[
        variant === 'chips' ? 'h-[30px] rounded-full border px-[11px] text-[13px]' : 'h-7 rounded-[6px] px-[11px] text-[13.5px]',
        modelValue === option.value
          ? variant === 'chips'
            ? 'border-primary/55 bg-primary/10 text-foreground'
            : 'bg-sidebar-accent text-foreground shadow-xs'
          : variant === 'chips'
            ? 'border-border text-muted-foreground hover:text-foreground'
            : 'text-muted-foreground hover:text-foreground',
      ]"
      @click="select(option.value)"
    >
      <component :is="option.icon" v-if="option.icon" :size="14" class="shrink-0" aria-hidden="true" />
      {{ option.label }}
    </button>
  </div>
</template>
