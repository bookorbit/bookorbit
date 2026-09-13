<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { SearchX } from '@lucide/vue'
import type { FieldPreference, MetadataField, ProviderStatus } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import FieldRuleRow from './FieldRuleRow.vue'
import { FIELD_GROUPS } from '../lib/field-rules'

const { t } = useI18n()

const props = defineProps<{
  fields: Record<MetadataField, FieldPreference>
  statuses: ProviderStatus[]
  visibleFields: Set<MetadataField>
  overriddenFields: Set<MetadataField>
  unsavedFields: Set<MetadataField>
  isGlobalScope: boolean
  scopeName: string
  saving?: boolean
}>()

const emit = defineEmits<{
  change: [field: MetadataField, pref: FieldPreference]
  revert: [field: MetadataField]
  clearFilters: []
}>()

/** One row open at a time: two open editors on one screen make the priority orders easy to confuse. */
const expandedField = ref<MetadataField | null>(null)

// A row hidden by a filter must not stay open behind it.
watch(
  () => props.visibleFields,
  (visible) => {
    if (expandedField.value && !visible.has(expandedField.value)) expandedField.value = null
  },
)

const groups = computed(() =>
  FIELD_GROUPS.map((group) => {
    const fields = group.fields.filter((field) => props.visibleFields.has(field))
    return {
      id: group.id,
      label: t(`settings.metadata.fieldRules.groups.${group.id}`),
      fields,
      enabled: fields.filter((field) => props.fields[field]?.enabled).length,
    }
  }).filter((group) => group.fields.length > 0),
)

const isEmpty = computed(() => groups.value.length === 0)

function setExpanded(field: MetadataField, expanded: boolean) {
  expandedField.value = expanded ? field : null
}

function onChange(field: MetadataField, pref: FieldPreference) {
  emit('change', field, pref)
}

function onRevert(field: MetadataField) {
  emit('revert', field)
}

function clearFilters() {
  emit('clearFilters')
}
</script>

<template>
  <div>
    <!-- Column header. Hidden on mobile, where the row is a card rather than a table line.
         The last two tracks are fixed rather than auto so the labels stay over their columns:
         the header's text is narrower than the merge control and status badge below it.
         FieldRuleRow repeats this template and the two must stay in step. -->
    <div
      class="hidden items-center gap-4 border-b border-border bg-muted/25 px-6 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground md:grid md:grid-cols-[minmax(160px,200px)_minmax(0,1fr)_272px_116px]"
      aria-hidden="true"
    >
      <div>{{ t('settings.metadata.fieldRules.table.field') }}</div>
      <div>{{ t('settings.metadata.fieldRules.table.activeProviders') }}</div>
      <div>{{ t('settings.metadata.fieldRules.table.mergeStrategy') }}</div>
      <!-- Global rules are never overrides, so the column carries only the expander there. -->
      <div class="text-right">{{ isGlobalScope ? '' : t('settings.metadata.fieldRules.table.status') }}</div>
    </div>

    <div v-if="isEmpty" class="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <SearchX :size="22" class="text-muted-foreground" aria-hidden="true" />
      <p class="text-sm text-muted-foreground">{{ t('settings.metadata.fieldRules.table.noMatches') }}</p>
      <Button variant="outline" size="sm" type="button" @click="clearFilters">
        {{ t('settings.metadata.fieldRules.toolbar.clearFilters') }}
      </Button>
    </div>

    <template v-else>
      <section v-for="group in groups" :key="group.id">
        <h3
          class="flex items-center gap-2 border-b border-border/60 bg-muted/25 px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground md:px-6"
        >
          {{ group.label }}
          <span class="ml-auto text-[10px] font-medium normal-case tracking-normal tabular-nums">
            {{ t('settings.metadata.fieldRules.groupSummary.enabledOf', { fields: group.fields.length, enabled: group.enabled }) }}
          </span>
        </h3>
        <FieldRuleRow
          v-for="field in group.fields"
          :key="field"
          :field="field"
          :preference="fields[field]"
          :statuses="statuses"
          :expanded="expandedField === field"
          :saving="saving"
          :unsaved="unsavedFields.has(field)"
          :inherited="isGlobalScope ? undefined : !overriddenFields.has(field)"
          :scope-name="scopeName"
          @change="onChange"
          @revert="onRevert"
          @update:expanded="(value: boolean) => setExpanded(field, value)"
        />
      </section>
    </template>
  </div>
</template>
