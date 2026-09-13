<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Minus, Plus } from '@lucide/vue'
import { MAX_FIELD_WEIGHT } from '../lib/score-weights'

const { t } = useI18n()

const props = defineProps<{
  weight: number
  /** Field name, used for the control's accessible name since the visible label sits in the row. */
  label: string
  labelledBy: string
  changed?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ change: [value: number]; adjust: [delta: number] }>()

const scoring = computed(() => props.weight > 0)
const canDecrease = computed(() => !props.disabled && props.weight > 0)
const canIncrease = computed(() => !props.disabled && props.weight < MAX_FIELD_WEIGHT)

function decrease() {
  emit('adjust', -1)
}

function increase() {
  emit('adjust', 1)
}

function onInput(event: Event) {
  emit('change', Number((event.target as HTMLInputElement).value))
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
      :disabled="!canDecrease"
      :aria-label="t('settings.admin.scoreWeights.decreaseWeight', { field: label })"
      @click="decrease"
    >
      <Minus :size="12" aria-hidden="true" />
    </button>
    <input
      type="number"
      inputmode="numeric"
      min="0"
      :max="MAX_FIELD_WEIGHT"
      step="1"
      :value="weight"
      :disabled="disabled"
      :aria-labelledby="labelledBy"
      class="h-full w-9 border-0 bg-transparent text-center text-sm font-semibold tabular-nums text-foreground outline-none [appearance:textfield] disabled:opacity-60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      :class="scoring ? '' : 'text-muted-foreground'"
      @input="onInput"
    />
    <button
      type="button"
      class="flex h-full w-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      :disabled="!canIncrease"
      :aria-label="t('settings.admin.scoreWeights.increaseWeight', { field: label })"
      @click="increase"
    >
      <Plus :size="12" aria-hidden="true" />
    </button>
  </div>
</template>
