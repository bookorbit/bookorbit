<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { DURATION_UNITS, type DurationDraft, type DurationUnit } from '../lib/cache-settings'

const props = defineProps<{
  id: string
  modelValue: DurationDraft
  /** Names the amount box when its visible label is not a `<label for>`. */
  amountLabel?: string
  unitLabel: string
  placeholder?: string
  invalid?: boolean
  describedBy?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [DurationDraft] }>()

const { t } = useI18n()

const UNIT_LABEL_KEYS: Record<DurationUnit, string> = {
  hours: 'settings.metadata.searchCache.units.hours',
  days: 'settings.metadata.searchCache.units.days',
}

function unitText(unit: DurationUnit): string {
  return t(UNIT_LABEL_KEYS[unit])
}

function isDurationUnit(value: string): value is DurationUnit {
  return (DURATION_UNITS as readonly string[]).includes(value)
}

function parseAmount(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function handleAmountInput(event: Event) {
  emit('update:modelValue', { ...props.modelValue, amount: parseAmount((event.target as HTMLInputElement).value) })
}

function handleUnitChange(event: Event) {
  const unit = (event.target as HTMLSelectElement).value
  if (isDurationUnit(unit)) emit('update:modelValue', { ...props.modelValue, unit })
}
</script>

<template>
  <div class="flex items-center gap-2">
    <input
      :id="id"
      type="number"
      inputmode="decimal"
      min="0"
      step="any"
      class="settings-control w-24 tabular-nums"
      :value="modelValue.amount ?? ''"
      :placeholder="placeholder"
      :aria-label="amountLabel"
      :aria-invalid="invalid ? 'true' : undefined"
      :aria-describedby="describedBy"
      :disabled="disabled"
      @input="handleAmountInput"
    />
    <select class="settings-control w-28" :value="modelValue.unit" :aria-label="unitLabel" :disabled="disabled" @change="handleUnitChange">
      <option v-for="unit in DURATION_UNITS" :key="unit" :value="unit">{{ unitText(unit) }}</option>
    </select>
  </div>
</template>
