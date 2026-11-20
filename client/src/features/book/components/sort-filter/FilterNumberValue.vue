<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  COMMUNITY_RATING_PROVIDER_KEYS,
  isBuiltInMetadataProviderKey,
  type CommunityRatingProvider,
  type Rule,
  type StaticRuleField,
} from '@bookorbit/types'
import { useMetadataProviderLabels } from '@/features/book/composables/useMetadataProviderLabels'
import { fieldLabel } from '@/features/book/lib/filter-labels'
import { BYTES_PER_MIB, NUMBER_PRESETS, isCommunityRatingField, matchesPreset, type NumberPreset } from '@/features/book/lib/filter-fields'
import { providerShortLabel } from '@/lib/provider-colors'
import { handleRadioGroupKeydown } from '@/lib/roving-index'
import { choiceChip, fieldInput, unitText } from './filter-styles'

/**
 * A number filter: quick picks where a field has them (page counts, metadata score), the rating
 * provider as chips for community ratings, then the value itself, with a second box for "between".
 * File sizes are typed in megabytes and stored in bytes.
 */
const props = defineProps<{
  rule: Rule
}>()

const emit = defineEmits<{
  'update:rule': [rule: Rule]
}>()

const { t } = useI18n()
const { labels: providerLabels } = useMetadataProviderLabels()

const label = computed(() => fieldLabel(props.rule.field))
const presets = computed<readonly NumberPreset[]>(() => NUMBER_PRESETS[props.rule.field as StaticRuleField] ?? [])
const isFileSize = computed(() => props.rule.field === 'fileSize')
const between = computed(() => props.rule.operator === 'between')
const provider = computed<CommunityRatingProvider | null>(() =>
  props.rule.field === 'communityRating' || props.rule.field === 'communityRatingCount' ? (props.rule.provider ?? 'any') : null,
)

// External providers' ratings can be filtered on too; they join the built-in list once known.
const providerOptions = computed<{ value: CommunityRatingProvider; label: string }[]>(() => {
  const external = Object.keys(providerLabels.value).filter((key) => !isBuiltInMetadataProviderKey(key))
  return [
    { value: 'any', label: t('book.filter.anyProvider') },
    ...[...COMMUNITY_RATING_PROVIDER_KEYS, ...external].map((key) => ({ value: key, label: providerShortLabel(key, providerLabels.value[key]) })),
  ]
})

const limits = computed(() => {
  switch (props.rule.field) {
    case 'fileSize':
      return { min: '0', step: '0.1', max: undefined }
    case 'communityRating':
      return { min: '0', step: '0.1', max: '5' }
    case 'communityRatingCount':
      return { min: '0', step: '1', max: undefined }
    case 'metadataScore':
      return { min: '0', step: '1', max: '100' }
    default:
      return { min: undefined, step: 'any', max: undefined }
  }
})

function shown(value: Rule['value'] | Rule['valueTo']): string {
  if (value === undefined || value === null || value === '') return ''
  if (isFileSize.value && typeof value === 'number') return String(Math.round((value / BYTES_PER_MIB) * 100) / 100)
  return String(value)
}

function parsed(raw: string | number): number | undefined {
  const text = String(raw)
  if (text.trim() === '') return undefined
  const n = Number(text)
  if (!Number.isFinite(n)) return undefined
  return isFileSize.value ? Math.round(n * BYTES_PER_MIB) : n
}

// The boxes keep what was typed, so "1." survives until the next digit; the rule only follows.
const valueText = ref<string | number>(shown(props.rule.value))
const valueToText = ref<string | number>(shown(props.rule.valueTo))

watch(
  () => props.rule.value,
  (value) => {
    if (parsed(valueText.value) !== value) valueText.value = shown(value)
  },
)
watch(
  () => props.rule.valueTo,
  (value) => {
    if (parsed(valueToText.value) !== value) valueToText.value = shown(value)
  },
)

function handleValue() {
  emit('update:rule', { ...props.rule, value: parsed(valueText.value) } as Rule)
}

function handleValueTo() {
  emit('update:rule', { ...props.rule, valueTo: parsed(valueToText.value) } as Rule)
}

function pickPreset(preset: NumberPreset) {
  const next = { ...props.rule, operator: preset.operator, value: preset.value } as Rule
  if (preset.valueTo === undefined) delete next.valueTo
  else next.valueTo = preset.valueTo
  emit('update:rule', next)
}

function pickProvider(value: CommunityRatingProvider) {
  if (!isCommunityRatingField(props.rule.field)) return
  emit('update:rule', { ...props.rule, provider: value } as Rule)
}

function presetLabel(preset: NumberPreset) {
  return props.rule.field === 'metadataScore' ? t(`book.filter.scorePreset.${preset.key}`) : t(`book.filter.pagePreset.${preset.key}`)
}
</script>

<template>
  <div class="grid gap-2">
    <div v-if="provider" class="flex flex-wrap gap-1.5" role="radiogroup" :aria-label="t('book.filter.provider')" @keydown="handleRadioGroupKeydown">
      <button
        v-for="option in providerOptions"
        :key="option.value"
        type="button"
        role="radio"
        :aria-checked="provider === option.value"
        :aria-pressed="provider === option.value"
        :class="choiceChip"
        @click="pickProvider(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
    <div v-if="presets.length > 0" class="flex flex-wrap gap-1.5" role="group" :aria-label="t('book.filter.quickPicks')">
      <button
        v-for="preset in presets"
        :key="preset.key"
        type="button"
        :aria-pressed="matchesPreset(rule, preset)"
        :class="choiceChip"
        @click="pickPreset(preset)"
      >
        {{ presetLabel(preset) }}
      </button>
    </div>
    <div class="flex items-center gap-2">
      <input
        v-model="valueText"
        type="number"
        inputmode="decimal"
        :min="limits.min"
        :max="limits.max"
        :step="limits.step"
        :placeholder="between ? t('book.filter.min') : t('book.filter.typeValue')"
        :aria-label="between ? t('book.filter.minimumLabel', { field: label }) : t('book.filter.valueLabel', { field: label })"
        :class="fieldInput"
        class="w-full"
        @input="handleValue"
      />
      <template v-if="between">
        <span :class="unitText">{{ t('book.filter.to') }}</span>
        <input
          v-model="valueToText"
          type="number"
          inputmode="decimal"
          :min="limits.min"
          :max="limits.max"
          :step="limits.step"
          :placeholder="t('book.filter.max')"
          :aria-label="t('book.filter.maximumLabel', { field: label })"
          :class="fieldInput"
          class="w-full"
          @input="handleValueTo"
        />
      </template>
      <span v-if="isFileSize" :class="unitText">{{ t('book.filter.unit.megabytes') }}</span>
    </div>
  </div>
</template>
