<script setup lang="ts">
import type { FieldPreference, MetadataFetchPreferences, MetadataField, ProviderStatus } from '@projectx/types'
import FieldGroupSection from './FieldGroupSection.vue'
import ProviderReservoir from './ProviderReservoir.vue'

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
  <div>
    <ProviderReservoir :statuses="statuses" />

    <!-- Column headers (desktop only) -->
    <div class="hidden sm:flex items-center gap-2 px-4 py-2 border-b border-border/60 bg-muted/10">
      <span class="w-36 shrink-0 text-xs text-muted-foreground">Field</span>
      <span class="flex-1 text-xs text-muted-foreground">Providers</span>
      <span class="shrink-0 text-xs text-muted-foreground pr-2">Strategy</span>
    </div>

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
  </div>
</template>
