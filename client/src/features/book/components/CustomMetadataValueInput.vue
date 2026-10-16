<script setup lang="ts">
import type { CustomMetadataFieldType, CustomMetadataPrimitiveValue } from '@bookorbit/types'

/**
 * One custom field cell as Edit Metadata draws it. Settings › Custom Fields previews fields with this
 * same component, so the preview cannot drift from the form.
 */
const props = defineProps<{
  label: string
  type: CustomMetadataFieldType
  modelValue: CustomMetadataPrimitiveValue
}>()

const emit = defineEmits<{ 'update:modelValue': [value: CustomMetadataPrimitiveValue] }>()

const INPUT_CLASS =
  'h-10 w-full rounded-lg border border-input bg-background px-3 text-sm transition-shadow outline-none focus:ring-1 focus:ring-ring sm:h-8'

function handleText(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function handleNumber(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  if (raw === '') {
    emit('update:modelValue', null)
    return
  }
  const n = Number(raw)
  emit('update:modelValue', Number.isFinite(n) ? n : null)
}

function handleDate(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).value || null)
}

function handleBoolean(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).checked)
}

function textValue(): string {
  return typeof props.modelValue === 'string' ? props.modelValue : ''
}

function numberValue(): number | string {
  return typeof props.modelValue === 'number' ? props.modelValue : ''
}
</script>

<template>
  <label class="space-y-1">
    <span class="text-[10px] font-bold tracking-[0.1em] text-muted-foreground uppercase">{{ label }}</span>
    <input
      v-if="type === 'text' || type === 'url'"
      :value="textValue()"
      :type="type === 'url' ? 'url' : 'text'"
      :class="INPUT_CLASS"
      @input="handleText"
    />
    <input v-else-if="type === 'number'" :value="numberValue()" type="number" :class="INPUT_CLASS" @input="handleNumber" />
    <input v-else-if="type === 'date'" :value="textValue()" type="date" :class="INPUT_CLASS" @input="handleDate" />
    <span v-else class="flex h-10 items-center rounded-lg border border-input bg-background px-3 sm:h-8">
      <input
        type="checkbox"
        class="size-4 rounded-xs border-input accent-primary"
        :checked="modelValue === true"
        :aria-label="label"
        @change="handleBoolean"
      />
    </span>
  </label>
</template>
