<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Minus, Plus } from '@lucide/vue'

const STEP = 5

const props = defineProps<{
  modelValue: number
  /** Marks a value a library set for itself, as the Score page marks a changed weight. */
  changed?: boolean
  disabled?: boolean
  labelledBy?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const { t } = useI18n()

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function decrease() {
  emit('update:modelValue', clamp(Math.ceil(props.modelValue / STEP) * STEP - STEP))
}

function increase() {
  emit('update:modelValue', clamp(Math.floor(props.modelValue / STEP) * STEP + STEP))
}

function handleChange(event: Event) {
  const value = Number.parseInt((event.target as HTMLInputElement).value, 10)
  emit('update:modelValue', Number.isFinite(value) ? clamp(value) : props.modelValue)
}
</script>

<template>
  <div
    class="inline-flex h-8 items-center overflow-hidden rounded-md border bg-background transition-colors focus-within:ring-1 focus-within:ring-ring"
    :class="changed ? 'border-primary/60 bg-primary/5' : 'border-input'"
  >
    <button
      type="button"
      class="flex h-full w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      :disabled="disabled || modelValue <= 0"
      :aria-label="t('settings.metadata.autoFetch.columns.lowerThreshold')"
      @click="decrease"
    >
      <Minus :size="12" aria-hidden="true" />
    </button>
    <input
      type="number"
      inputmode="numeric"
      min="0"
      max="100"
      step="1"
      :value="modelValue"
      :disabled="disabled"
      :aria-labelledby="labelledBy"
      class="h-full w-9 border-0 bg-transparent text-center text-sm font-semibold tabular-nums text-foreground outline-none [appearance:textfield] disabled:opacity-60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      data-testid="auto-fetch-threshold-input"
      @change="handleChange"
    />
    <button
      type="button"
      class="flex h-full w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      :disabled="disabled || modelValue >= 100"
      :aria-label="t('settings.metadata.autoFetch.columns.raiseThreshold')"
      @click="increase"
    >
      <Plus :size="12" aria-hidden="true" />
    </button>
  </div>
</template>
