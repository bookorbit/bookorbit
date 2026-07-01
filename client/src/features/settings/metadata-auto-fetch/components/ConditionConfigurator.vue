<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { BookMetadataFetchConditions, MetadataField } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import MissingFieldsPicker from './MissingFieldsPicker.vue'

const { t } = useI18n()

const props = defineProps<{
  modelValue: BookMetadataFetchConditions
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [BookMetadataFetchConditions] }>()

function updateScoreEnabled(enabled: boolean) {
  emit('update:modelValue', { ...props.modelValue, scoreThreshold: { ...props.modelValue.scoreThreshold, enabled } })
}

function updateScoreThreshold(value: string) {
  const num = Math.max(0, Math.min(100, parseInt(value, 10) || 0))
  emit('update:modelValue', { ...props.modelValue, scoreThreshold: { ...props.modelValue.scoreThreshold, threshold: num } })
}

function updateMissingEnabled(enabled: boolean) {
  emit('update:modelValue', { ...props.modelValue, missingFields: { ...props.modelValue.missingFields, enabled } })
}

function updateMissingFields(fields: MetadataField[]) {
  emit('update:modelValue', { ...props.modelValue, missingFields: { ...props.modelValue.missingFields, fields } })
}

function updateNeverFetched(enabled: boolean) {
  emit('update:modelValue', { ...props.modelValue, neverFetched: { enabled } })
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex items-start gap-3">
      <ToggleSwitch
        :model-value="modelValue.neverFetched.enabled"
        :disabled="props.disabled"
        @update:model-value="updateNeverFetched"
        class="mt-0.5 shrink-0"
      />
      <div>
        <p class="settings-label">{{ t('settings.metadata.autoFetch.conditions.neverFetched.label') }}</p>
        <p class="settings-hint">{{ t('settings.metadata.autoFetch.conditions.neverFetched.hint') }}</p>
      </div>
    </div>

    <div class="flex items-start gap-3">
      <ToggleSwitch
        :model-value="modelValue.scoreThreshold.enabled"
        :disabled="props.disabled"
        @update:model-value="updateScoreEnabled"
        class="mt-0.5 shrink-0"
      />
      <div class="flex-1">
        <p class="settings-label">{{ t('settings.metadata.autoFetch.conditions.scoreThreshold.label') }}</p>
        <p class="settings-hint">{{ t('settings.metadata.autoFetch.conditions.scoreThreshold.hint') }}</p>
        <div v-if="modelValue.scoreThreshold.enabled" class="flex items-center gap-2 mt-2">
          <span class="text-xs text-muted-foreground">{{ t('settings.metadata.autoFetch.conditions.scoreThreshold.scoreBelow') }}</span>
          <input
            type="number"
            min="0"
            max="100"
            :value="modelValue.scoreThreshold.threshold"
            :disabled="props.disabled"
            @input="updateScoreThreshold(($event.target as HTMLInputElement).value)"
            class="w-16 h-7 px-2 text-xs border border-border rounded-md bg-background text-foreground"
          />
          <span class="text-xs text-muted-foreground">/ 100</span>
        </div>
      </div>
    </div>

    <div class="flex items-start gap-3">
      <ToggleSwitch
        :model-value="modelValue.missingFields.enabled"
        :disabled="props.disabled"
        @update:model-value="updateMissingEnabled"
        class="mt-0.5 shrink-0"
      />
      <div class="flex-1">
        <p class="settings-label">{{ t('settings.metadata.autoFetch.conditions.missingFields.label') }}</p>
        <p class="settings-hint">{{ t('settings.metadata.autoFetch.conditions.missingFields.hint') }}</p>
        <MissingFieldsPicker
          v-if="modelValue.missingFields.enabled"
          :model-value="modelValue.missingFields.fields"
          :disabled="props.disabled"
          class="mt-2"
          @update:model-value="updateMissingFields"
        />
      </div>
    </div>
  </div>
</template>
