<script setup lang="ts">
import { ref } from 'vue'
import { ChevronDown, ChevronRight } from 'lucide-vue-next'
import type { FieldPreference, MetadataField, ProviderStatus } from '@projectx/types'
import FieldRow from './FieldRow.vue'

defineProps<{
  label: string
  fields: MetadataField[]
  preferences: Record<MetadataField, FieldPreference>
  statuses: ProviderStatus[]
  overriddenFields?: Set<MetadataField>
  savingField?: string | null
  libraryId?: number
}>()

const emit = defineEmits<{
  change: [field: MetadataField, pref: FieldPreference]
  revert: [field: MetadataField]
}>()

const open = ref(true)
</script>

<template>
  <div>
    <button
      class="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:bg-muted/40 transition-colors"
      @click="open = !open"
    >
      <component :is="open ? ChevronDown : ChevronRight" :size="12" />
      {{ label }}
    </button>

    <div v-if="open" class="divide-y divide-border/60">
      <FieldRow
        v-for="field in fields"
        :key="field"
        :field="field"
        :preference="preferences[field]"
        :statuses="statuses"
        :inherited="overriddenFields !== undefined ? !overriddenFields.has(field) : undefined"
        :saving="savingField === `${libraryId}:${field}`"
        @change="(f, p) => emit('change', f, p)"
        @revert="(f) => emit('revert', f)"
      />
    </div>
  </div>
</template>
