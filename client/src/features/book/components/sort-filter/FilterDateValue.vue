<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Rule } from '@bookorbit/types'
import { fieldLabel } from '@/features/book/lib/filter-labels'
import { DATE_PRESETS, RELATIVE_DAY_OPERATORS, matchesPreset, type DatePreset } from '@/features/book/lib/filter-fields'
import { handleRadioGroupKeydown } from '@/lib/roving-index'
import { choiceRow, fieldInput, radioMark, unitText } from './filter-styles'

/**
 * A date filter as a short list of ranges, "Last 30 days" through "More than a year ago", with
 * Custom for exact dates or a day count. The header's operator menu still reaches every form.
 */
const props = defineProps<{
  rule: Rule
}>()

const emit = defineEmits<{
  'update:rule': [rule: Rule]
}>()

const { t } = useI18n()

const activePreset = computed(() => DATE_PRESETS.find((preset) => matchesPreset(props.rule, preset)) ?? null)
const relative = computed(() => RELATIVE_DAY_OPERATORS.includes(props.rule.operator))
const label = computed(() => fieldLabel(props.rule.field))

function pickPreset(preset: DatePreset) {
  const next = { ...props.rule, operator: preset.operator, value: preset.days } as Rule
  delete next.valueTo
  emit('update:rule', next)
}

function handleCustom() {
  if (!activePreset.value) return
  emit('update:rule', { ...props.rule, operator: 'between', value: '', valueTo: '' } as Rule)
}

function handleDays(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  emit('update:rule', { ...props.rule, value: raw === '' ? undefined : Number(raw) } as Rule)
}

function handleFrom(event: Event) {
  emit('update:rule', { ...props.rule, value: (event.target as HTMLInputElement).value } as Rule)
}

function handleTo(event: Event) {
  emit('update:rule', { ...props.rule, valueTo: (event.target as HTMLInputElement).value } as Rule)
}
</script>

<template>
  <div class="grid gap-2">
    <div role="radiogroup" :aria-label="label" @keydown="handleRadioGroupKeydown">
      <button
        v-for="preset in DATE_PRESETS"
        :key="preset.key"
        type="button"
        role="radio"
        :aria-checked="activePreset?.key === preset.key"
        :class="choiceRow"
        @click="pickPreset(preset)"
      >
        <span :class="radioMark" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ t(`book.filter.datePresets.${preset.key}`) }}</span>
      </button>
      <button type="button" role="radio" :aria-checked="!activePreset" :class="choiceRow" @click="handleCustom">
        <span :class="radioMark" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ t('book.filter.custom') }}</span>
      </button>
    </div>
    <div v-if="!activePreset" class="flex items-center gap-2">
      <template v-if="relative">
        <input
          :value="rule.value ?? ''"
          type="number"
          min="1"
          :class="fieldInput"
          class="w-24"
          :aria-label="t('book.filter.valueLabel', { field: label })"
          @input="handleDays"
        />
        <span :class="unitText">{{ rule.operator === 'moreThanAgo' ? t('book.filter.unit.daysAgo') : t('book.filter.unit.days') }}</span>
      </template>
      <template v-else>
        <input
          :value="rule.value ?? ''"
          type="date"
          :class="fieldInput"
          class="w-full"
          :aria-label="rule.operator === 'between' ? t('book.filter.dateFrom') : t('book.filter.dateValue')"
          @input="handleFrom"
        />
        <template v-if="rule.operator === 'between'">
          <span :class="unitText">{{ t('book.filter.to') }}</span>
          <input :value="rule.valueTo ?? ''" type="date" :class="fieldInput" class="w-full" :aria-label="t('book.filter.dateTo')" @input="handleTo" />
        </template>
      </template>
    </div>
  </div>
</template>
