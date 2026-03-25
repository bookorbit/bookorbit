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
  saving?: boolean
}>()

const emit = defineEmits<{
  change: [field: MetadataField, pref: FieldPreference]
  revert: [field: MetadataField]
}>()

const open = ref(true)
</script>

<template>
  <div class="border-b border-border/60 last:border-0">
    <button
      class="w-full flex items-center gap-2.5 px-6 py-2.5 text-[10px] font-bold text-muted-foreground/80 uppercase tracking-[0.1em] hover:bg-muted/30 hover:text-muted-foreground transition-all group"
      @click="open = !open"
    >
      <component :is="open ? ChevronDown : ChevronRight" :size="12" class="transition-transform duration-200 group-hover:scale-110" />
      {{ label }}
    </button>

    <div v-if="open" class="divide-y divide-border/60 animate-in fade-in slide-in-from-top-1 duration-200">
      <FieldRow
        v-for="field in fields"
        :key="field"
        :field="field"
        :preference="preferences[field]"
        :statuses="statuses"
        :inherited="overriddenFields !== undefined ? !overriddenFields.has(field) : undefined"
        :saving="saving"
        @change="(f, p) => emit('change', f, p)"
        @revert="(f) => emit('revert', f)"
      />
    </div>
  </div>
</template>
