<script setup lang="ts">
import type { FieldPreference, MetadataFetchPreferences, MetadataField, ProviderStatus } from '@projectx/types'
import FieldGroupSection from './FieldGroupSection.vue'

defineProps<{
  preferences: MetadataFetchPreferences
  statuses: ProviderStatus[]
  overriddenFields?: Set<MetadataField>
  savingField?: string | null
  libraryId?: number
}>()

const emit = defineEmits<{
  change: [field: MetadataField, pref: FieldPreference]
  revert: [field: MetadataField]
}>()

const GROUPS: { label: string; fields: MetadataField[] }[] = [
  { label: 'Core', fields: ['title', 'subtitle', 'description', 'cover'] },
  { label: 'Contributors', fields: ['authors'] },
  { label: 'Publication', fields: ['publisher', 'publishedYear', 'language', 'pageCount'] },
  { label: 'Series', fields: ['seriesName', 'seriesIndex'] },
  { label: 'Classification', fields: ['genres'] },
]
</script>

<template>
  <div class="divide-y divide-border/60">
    <FieldGroupSection
      v-for="group in GROUPS"
      :key="group.label"
      :label="group.label"
      :fields="group.fields"
      :preferences="preferences.fields"
      :statuses="statuses"
      :overridden-fields="overriddenFields"
      :saving-field="savingField"
      :library-id="libraryId"
      @change="(f, p) => emit('change', f, p)"
      @revert="(f) => emit('revert', f)"
    />
  </div>
</template>
