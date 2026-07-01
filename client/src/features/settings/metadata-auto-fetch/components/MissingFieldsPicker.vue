<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { MetadataField } from '@bookorbit/types'
import { ALL_METADATA_FIELDS } from '@bookorbit/types'

const { t } = useI18n()

const props = defineProps<{
  modelValue: MetadataField[]
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [MetadataField[]] }>()

function fieldLabel(field: MetadataField): string {
  return t(`settings.metadata.fields.${field}`)
}

function toggle(field: MetadataField) {
  if (props.disabled) return
  const current = new Set(props.modelValue)
  if (current.has(field)) {
    current.delete(field)
  } else {
    current.add(field)
  }
  emit('update:modelValue', [...current])
}
</script>

<template>
  <div class="flex flex-wrap gap-1.5">
    <button
      v-for="field in ALL_METADATA_FIELDS"
      :key="field"
      type="button"
      @click="toggle(field)"
      :disabled="props.disabled"
      :class="[
        'px-2 py-0.5 text-xs rounded-full border transition-colors',
        props.modelValue.includes(field)
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-transparent text-muted-foreground border-border hover:border-primary/50',
        props.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      ]"
    >
      {{ fieldLabel(field) }}
    </button>
  </div>
</template>
