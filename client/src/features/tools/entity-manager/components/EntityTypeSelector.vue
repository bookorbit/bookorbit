<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ALL_ENTITY_TYPES, type EntityType } from '@bookorbit/types'

defineProps<{ modelValue: EntityType }>()
const emit = defineEmits<{ 'update:modelValue': [value: EntityType] }>()

const { t } = useI18n()

const labels = computed<Record<EntityType, string>>(() => ({
  author: t('tools.entityTypes.authors'),
  genre: t('tools.entityTypes.genres'),
  tag: t('tools.entityTypes.tags'),
  narrator: t('tools.entityTypes.narrators'),
  publisher: t('tools.entityTypes.publishers'),
  language: t('tools.entityTypes.languages'),
  series: t('tools.entityTypes.series'),
}))

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
