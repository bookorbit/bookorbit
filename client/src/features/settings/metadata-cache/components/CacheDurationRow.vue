<script setup lang="ts">
import { computed, useId } from 'vue'
import CacheDurationInput from './CacheDurationInput.vue'
import type { DurationDraft } from '../lib/cache-settings'

const props = defineProps<{
  label: string
  hint: string
  unitLabel: string
  modelValue: DurationDraft
  error?: string | null
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [DurationDraft] }>()

const id = useId()
const hintId = computed(() => `${id}-hint`)
const errorId = computed(() => `${id}-error`)
const describedBy = computed(() => (props.error ? `${hintId.value} ${errorId.value}` : hintId.value))

function handleUpdate(value: DurationDraft) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="settings-row">
    <div class="min-w-0 settings-prose">
      <label :for="`${id}-amount`" class="settings-label block">{{ label }}</label>
      <p :id="hintId" class="settings-hint">{{ hint }}</p>
    </div>
    <div class="flex shrink-0 flex-col gap-1 md:items-end">
      <CacheDurationInput
        :id="`${id}-amount`"
        :model-value="modelValue"
        :unit-label="unitLabel"
        :invalid="!!error"
        :described-by="describedBy"
        :disabled="disabled"
        @update:model-value="handleUpdate"
      />
      <p v-if="error" :id="errorId" role="alert" class="text-xs text-destructive">{{ error }}</p>
    </div>
  </div>
</template>
