<script setup lang="ts">
import { ALL_ENTITY_TYPES, type EntityType } from '@bookorbit/types'

defineProps<{ modelValue: EntityType }>()
const emit = defineEmits<{ 'update:modelValue': [value: EntityType] }>()

const labels: Record<EntityType, string> = {
  author: 'Authors',
  genre: 'Genres',
  tag: 'Tags',
  narrator: 'Narrators',
  publisher: 'Publishers',
  language: 'Languages',
  series: 'Series',
}

function handleChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value as EntityType)
}
</script>

<template>
  <select
    :value="modelValue"
    class="h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
    @change="handleChange"
  >
    <option v-for="et in ALL_ENTITY_TYPES" :key="et" :value="et">
      {{ labels[et] }}
    </option>
  </select>
</template>
