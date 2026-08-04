<script setup lang="ts">
import { computed, useId, type Component } from 'vue'

const props = defineProps<{
  modelValue: number
  min: number
  max: number
  step: number
  label: string
  /** Human-readable current value, shown beside the track and announced in place of the raw number. */
  displayValue: string
  minIcon?: Component
  maxIcon?: Component
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const inputId = `reader-range-${useId()}`

const fillPercent = computed(() => {
  const span = props.max - props.min
  if (span <= 0) return 0
  return ((props.modelValue - props.min) / span) * 100
})

function onInput(event: Event) {
  emit('update:modelValue', Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div>
    <label :for="inputId" class="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{{ label }}</label>
    <div class="flex items-center gap-2.5">
      <component :is="minIcon" v-if="minIcon" :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      <input
        :id="inputId"
        type="range"
        class="reader-range min-w-0 flex-1"
        :min="min"
        :max="max"
        :step="step"
        :value="modelValue"
        :aria-valuetext="displayValue"
        :style="{ '--reader-range-fill': `${fillPercent}%` }"
        @input="onInput"
      />
      <component :is="maxIcon" v-if="maxIcon" :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      <span class="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">{{ displayValue }}</span>
    </div>
  </div>
</template>

<style scoped>
.reader-range {
  appearance: none;
  height: 4px;
  border-radius: 999px;
  background: linear-gradient(to right, var(--primary) var(--reader-range-fill), var(--border) var(--reader-range-fill));
  cursor: pointer;
}

.reader-range:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 4px;
}

.reader-range::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border: 2px solid var(--card);
  border-radius: 999px;
  background: var(--primary);
  box-shadow: var(--elevation-sm);
}

.reader-range::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border: 2px solid var(--card);
  border-radius: 999px;
  background: var(--primary);
  box-shadow: var(--elevation-sm);
}
</style>
