<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, TriangleAlert } from '@lucide/vue'
import type { FieldPreference, MergeStrategy, MetadataField, MetadataProviderKey, ProviderStatus } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'
import { Badge } from '@/components/ui/badge'
import ProviderChipList from './ProviderChipList.vue'
import ProviderAddMenu from './ProviderAddMenu.vue'
import MergeStrategySegmented from './MergeStrategySegmented.vue'
import FieldRuleDetail from './FieldRuleDetail.vue'
import { resolvedProviders, skippedProviders } from '../lib/field-rules'

const { t } = useI18n()

const props = defineProps<{
  field: MetadataField
  preference: FieldPreference
  statuses: ProviderStatus[]
  expanded: boolean
  saving?: boolean
  unsaved?: boolean
  /** Undefined on the global scope, where "inherited" has no meaning. */
  inherited?: boolean
  scopeName: string
}>()

const emit = defineEmits<{
  change: [field: MetadataField, pref: FieldPreference]
  revert: [field: MetadataField]
  'update:expanded': [value: boolean]
}>()

const label = computed(() => t(`settings.metadata.fields.${props.field}`))
const resolved = computed(() => resolvedProviders(props.preference.providers, props.statuses))
const skipped = computed(() => skippedProviders(props.preference.providers, props.statuses))
const hasNoUsableProvider = computed(() => props.preference.enabled && resolved.value.length === 0)

/** Mobile shows a fixed-width preview so every row is the same height. */
const MOBILE_PREVIEW_LIMIT = 2
const previewProviders = computed(() => resolved.value.slice(0, MOBILE_PREVIEW_LIMIT))
const hiddenPreviewCount = computed(() => Math.max(0, resolved.value.length - MOBILE_PREVIEW_LIMIT))
const detailId = computed(() => `field-rule-detail-${props.field}`)

const mergeSummary = computed(() => t(`settings.metadata.mergeStrategy.${props.preference.mergeStrategy}.label`))

function providerShortLabel(key: MetadataProviderKey): string {
  return PROVIDER_SHORT_LABELS[key] ?? key
}

function update(patch: Partial<FieldPreference>) {
  emit('change', props.field, { ...props.preference, ...patch })
}

function onProvidersChange(providers: MetadataProviderKey[]) {
  update({ providers })
}

function onMergeChange(mergeStrategy: MergeStrategy) {
  update({ mergeStrategy })
}

function onEnabledChange(enabled: boolean) {
  update({ enabled })
}

function addProvider(provider: MetadataProviderKey) {
  if (props.preference.providers.includes(provider)) return
  update({ providers: [...props.preference.providers, provider] })
}

function onDetailChange(pref: FieldPreference) {
  emit('change', props.field, pref)
}

function revertPreference() {
  emit('revert', props.field)
}

function toggleExpanded() {
  emit('update:expanded', !props.expanded)
}

function collapse() {
  emit('update:expanded', false)
}
</script>

<template>
  <div class="border-b border-border/60 last:border-b-0" :class="expanded ? 'bg-muted/15' : ''">
    <!-- ── Desktop row ─────────────────────────────────────── -->
    <div
      class="hidden items-center gap-4 px-4 py-2 transition-colors md:grid md:px-6 md:grid-cols-[minmax(160px,200px)_minmax(0,1fr)_272px_116px]"
      :class="expanded ? '' : 'hover:bg-muted/25'"
    >
      <div class="flex min-w-0 items-center gap-3">
        <ToggleSwitch
          :model-value="preference.enabled"
          :disabled="saving"
          :aria-label="t('settings.metadata.fieldRules.field.toggle', { field: label })"
          @update:model-value="onEnabledChange"
        />
        <span class="settings-label truncate">{{ label }}</span>
      </div>

      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <ProviderChipList
          :providers="preference.providers"
          :statuses="statuses"
          :disabled="!preference.enabled || saving"
          @update:providers="onProvidersChange"
        />
        <ProviderAddMenu
          v-if="preference.enabled"
          :assigned="preference.providers"
          :statuses="statuses"
          :disabled="saving"
          :field-label="label"
          @add="addProvider"
        />
        <span v-if="skipped.length" class="inline-flex items-center gap-1 text-xs font-medium text-warning">
          <TriangleAlert :size="12" aria-hidden="true" />
          {{ t('settings.metadata.fieldRules.field.skippedCount', { count: skipped.length }) }}
        </span>
      </div>

      <MergeStrategySegmented :model-value="preference.mergeStrategy" :disabled="!preference.enabled || saving" @update:model-value="onMergeChange" />

      <div class="flex shrink-0 items-center justify-end gap-2">
        <Badge v-if="unsaved" variant="secondary" class="h-5 px-1.5 text-[10px] font-bold uppercase tracking-tight">
          {{ t('settings.metadata.fieldRules.field.unsaved') }}
        </Badge>
        <Badge
          v-else-if="inherited === false"
          variant="secondary"
          class="h-5 border-primary/40 bg-primary/10 px-1.5 text-[10px] font-bold uppercase tracking-tight text-primary"
        >
          {{ t('settings.metadata.fieldRules.field.override') }}
        </Badge>
        <span v-else-if="inherited === true" class="text-[10px] font-bold uppercase tracking-tight text-muted-foreground">
          {{ t('settings.metadata.fieldRules.field.inherited') }}
        </span>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :aria-expanded="expanded"
          :aria-controls="detailId"
          :aria-label="t('settings.metadata.fieldRules.field.configure', { field: label })"
          @click="toggleExpanded"
        >
          <component :is="expanded ? ChevronDown : ChevronRight" :size="16" aria-hidden="true" />
        </button>
      </div>
    </div>

    <!-- ── Mobile row ──────────────────────────────────────── -->
    <div class="flex items-start gap-3 px-4 py-3 md:hidden">
      <ToggleSwitch
        class="mt-0.5"
        :model-value="preference.enabled"
        :disabled="saving"
        :aria-label="t('settings.metadata.fieldRules.field.toggle', { field: label })"
        @update:model-value="onEnabledChange"
      />
      <button
        type="button"
        class="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        :aria-expanded="expanded"
        :aria-controls="detailId"
        @click="toggleExpanded"
      >
        <span class="flex items-center gap-2">
          <span class="settings-label truncate">{{ label }}</span>
          <Badge v-if="unsaved" variant="secondary" class="h-4 shrink-0 px-1 text-[9px] font-bold uppercase tracking-tight">
            {{ t('settings.metadata.fieldRules.field.unsaved') }}
          </Badge>
          <Badge
            v-else-if="inherited === false"
            variant="secondary"
            class="h-4 shrink-0 border-primary/40 bg-primary/10 px-1 text-[9px] font-bold uppercase tracking-tight text-primary"
          >
            {{ t('settings.metadata.fieldRules.field.override') }}
          </Badge>
        </span>
        <span class="mt-1.5 flex items-center gap-1.5 overflow-hidden">
          <span
            v-for="(key, index) in previewProviders"
            :key="key"
            class="provider-chip inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium"
            :style="providerChipStyle(key)"
          >
            <span class="tabular-nums opacity-70">{{ index + 1 }}</span>
            {{ providerShortLabel(key) }}
          </span>
          <span v-if="hiddenPreviewCount" class="shrink-0 text-[11px] font-medium text-muted-foreground">
            {{ t('settings.metadata.fieldRules.field.morePreview', { count: hiddenPreviewCount }) }}
          </span>
          <span v-if="!resolved.length" class="text-[11px] font-medium text-warning">
            {{ t('settings.metadata.fieldRules.detail.noUsableProviders') }}
          </span>
        </span>
        <span class="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {{ mergeSummary }}
          <template v-if="skipped.length">
            <span aria-hidden="true">·</span>
            <span class="text-warning">{{ t('settings.metadata.fieldRules.field.skippedCount', { count: skipped.length }) }}</span>
          </template>
        </span>
      </button>
      <component :is="expanded ? ChevronDown : ChevronRight" :size="16" class="mt-1 shrink-0 text-muted-foreground" aria-hidden="true" />
    </div>

    <div v-if="hasNoUsableProvider && !expanded" class="flex items-center gap-2 px-4 pb-2.5 text-xs text-warning md:px-6 md:pb-2">
      <TriangleAlert :size="13" class="shrink-0" aria-hidden="true" />
      {{ t('settings.metadata.fieldRules.field.noProviders') }}
    </div>

    <FieldRuleDetail
      v-if="expanded"
      :id="detailId"
      :field="field"
      :field-label="label"
      :preference="preference"
      :statuses="statuses"
      :saving="saving"
      :inherited="inherited"
      :scope-name="scopeName"
      @change="onDetailChange"
      @revert="revertPreference"
      @close="collapse"
    />
  </div>
</template>
