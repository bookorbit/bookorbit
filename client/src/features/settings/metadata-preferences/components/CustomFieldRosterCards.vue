<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { CustomMetadataFieldDefinition, Library } from '@bookorbit/types'
import { formatNumber, formatRelativeTimeFromNow } from '@/i18n/formatters'
import { fieldCoverage } from '../lib/custom-field-coverage'
import CustomFieldCoverage from './CustomFieldCoverage.vue'
import CustomFieldLibrarySummary from './CustomFieldLibrarySummary.vue'
import CustomFieldTypeChip from './CustomFieldTypeChip.vue'

/** The roster below `md`. Reordering on a phone goes through the sheet's menu, not drag. */
const props = defineProps<{
  fields: CustomMetadataFieldDefinition[]
  view: 'active' | 'archived'
  libraries: Library[]
}>()

const emit = defineEmits<{ open: [field: CustomMetadataFieldDefinition] }>()

const { t } = useI18n()

function openField(field: CustomMetadataFieldDefinition) {
  emit('open', field)
}

function coverageOf(field: CustomMetadataFieldDefinition) {
  return fieldCoverage(field, props.libraries)
}
</script>

<template>
  <ul class="space-y-2 md:hidden">
    <li v-for="field in fields" :key="field.id">
      <button
        type="button"
        class="block w-full rounded-lg border border-border bg-card px-3.5 py-3 text-start shadow-xs transition-colors hover:bg-foreground/4"
        :class="view === 'active' && field.enabledLibraryIds.length === 0 ? 'shadow-[inset_2px_0_0_var(--pill-warning)]' : ''"
        @click="openField(field)"
      >
        <span class="flex items-start gap-2">
          <span class="line-clamp-2 min-w-0 flex-1 font-semibold text-foreground">{{ field.label }}</span>
          <CustomFieldTypeChip :type="field.type" size="sm" />
        </span>
        <span v-if="view === 'active'" class="mt-1.5 flex items-center justify-between gap-3 text-[13px]">
          <span class="min-w-0 overflow-hidden"
            ><CustomFieldLibrarySummary :library-ids="field.enabledLibraryIds" :libraries="libraries" :max="1"
          /></span>
          <CustomFieldCoverage :coverage="coverageOf(field)" :bar="false" />
        </span>
        <span v-else class="mt-1.5 flex items-center justify-between gap-3 text-[13px] text-muted-foreground">
          <span>{{
            t('settings.metadata.customFields.archivedAt', { when: field.archivedAt ? formatRelativeTimeFromNow(field.archivedAt) : '' })
          }}</span>
          <span class="tabular-nums">{{ field.usageCount ? formatNumber(field.usageCount) : t('settings.metadata.customFields.noValues') }}</span>
        </span>
      </button>
    </li>
  </ul>
</template>
