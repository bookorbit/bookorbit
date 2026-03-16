<script setup lang="ts">
import type { FieldPreference, MetadataFetchPreferences, MetadataField, ProviderStatus } from '@projectx/types'
import FieldGroupSection from './FieldGroupSection.vue'
import ProviderReservoir from './ProviderReservoir.vue'
import { Info } from 'lucide-vue-next'

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
  <div class="space-y-0">
    <!-- Reservoir with context -->
    <div class="px-5 py-4 bg-muted/30 border-b border-border flex flex-col gap-3">
      <div class="flex items-center gap-2.5">
        <Info :size="14" class="text-primary shrink-0" />
        <p class="text-[11px] font-medium text-muted-foreground uppercase tracking-widest leading-none">
          Drag providers from here onto any field to add them
        </p>
      </div>
      <div class="flex items-center">
        <ProviderReservoir :statuses="statuses" />
      </div>
    </div>

    <!-- Table Header (desktop) -->
    <div class="hidden md:flex items-center gap-4 px-5 py-3 bg-muted/10 border-b border-border/60">
      <div class="w-48 shrink-0 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Field</div>
      <div class="flex-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Providers (ordered by priority)</div>
      <div class="w-44 shrink-0 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Merge Strategy</div>
      <div
        v-if="overriddenFields !== undefined"
        class="w-16 shrink-0 text-xs font-semibold text-muted-foreground uppercase tracking-wider text-center"
      >
        Status
      </div>
    </div>

    <!-- Content -->
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
