<script setup lang="ts">
import type { SortSpec } from '@bookorbit/types'

/** The two orders of one sort field as words, "A → Z" against "Z → A", in the app's segmented look. */
defineProps<{
  modelValue: SortSpec['dir']
  ascLabel: string
  descLabel: string
  label: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: SortSpec['dir']]
}>()

function handleAsc() {
  emit('update:modelValue', 'asc')
}

function handleDesc() {
  emit('update:modelValue', 'desc')
}

const segment =
  'inline-flex min-w-0 items-center justify-center rounded-[7px] px-2 text-[12.5px] font-medium whitespace-nowrap text-foreground transition-colors hover:bg-muted aria-pressed:bg-surface-4 aria-pressed:font-semibold aria-pressed:shadow-xs focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none max-sm:text-[14px]'
</script>

<template>
  <div
    role="group"
    :aria-label="label"
    class="grid h-8 auto-cols-fr grid-flow-col gap-0.5 rounded-[9px] border border-border bg-surface-2 p-0.5 max-sm:h-[38px]"
  >
    <button type="button" :class="segment" :aria-pressed="modelValue === 'asc'" @click="handleAsc">{{ ascLabel }}</button>
    <button type="button" :class="segment" :aria-pressed="modelValue === 'desc'" @click="handleDesc">{{ descLabel }}</button>
  </div>
</template>
