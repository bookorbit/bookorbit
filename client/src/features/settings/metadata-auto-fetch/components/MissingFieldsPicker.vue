<script setup lang="ts">
import type { MetadataField } from '@projectx/types'
import { ALL_METADATA_FIELDS } from '@projectx/types'

const props = defineProps<{
  modelValue: MetadataField[]
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [MetadataField[]] }>()

const FIELD_LABELS: Record<MetadataField, string> = {
  title: 'Title',
  subtitle: 'Subtitle',
  description: 'Description',
  cover: 'Cover',
  authors: 'Authors',
  publisher: 'Publisher',
  publishedYear: 'Published year',
  language: 'Language',
  pageCount: 'Page count',
  seriesName: 'Series name',
  seriesIndex: 'Series index',
  genres: 'Genres',
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
      {{ FIELD_LABELS[field] }}
    </button>
  </div>
</template>
