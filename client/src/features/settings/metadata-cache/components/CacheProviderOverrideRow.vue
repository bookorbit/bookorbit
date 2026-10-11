<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCcw } from '@lucide/vue'
import type { MetadataCacheProviderInfo } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import CacheDurationInput from './CacheDurationInput.vue'
import { formatNumber } from '@/i18n/formatters'
import {
  durationSeconds,
  providerOverrideIsSet,
  providerOverrideKey,
  UNIT_SECONDS,
  type DurationDraft,
  type DurationUnit,
  type ProviderOverrideDraft,
  type ProviderOverrideErrors,
} from '../lib/cache-settings'
import { durationErrorMessage } from '../lib/cache-settings-format'

const props = defineProps<{
  provider: MetadataCacheProviderInfo
  override: ProviderOverrideDraft
  errors?: ProviderOverrideErrors
  /** The global values a blank override falls back to. */
  inherited: { resultsTtl: DurationDraft; emptyTtl: DurationDraft }
}>()

const emit = defineEmits<{
  update: [ProviderOverrideDraft]
  reset: [key: string]
}>()

const { t } = useI18n()
const id = useId()

const locked = computed(() => !props.provider.cacheable)
const label = computed(() => props.provider.label)
const resultsError = computed(() => durationErrorMessage(t, props.errors?.resultsTtl))
const emptyError = computed(() => durationErrorMessage(t, props.errors?.emptyTtl))
const isOverridden = computed(() => providerOverrideIsSet(props.override))
const statusHint = computed(() => {
  if (locked.value) return t('settings.metadata.searchCache.providers.notCacheable')
  if (!props.provider.cachesEmptyResults) return t('settings.metadata.searchCache.providers.noEmptyCaching')
  return null
})

/** The global value in this row's unit, so a blank box shows what it falls back to. */
function inheritedPlaceholder(inheritedValue: DurationDraft, unit: DurationUnit): string | undefined {
  const seconds = durationSeconds(inheritedValue)
  if (seconds === null) return undefined
  return formatNumber(seconds / UNIT_SECONDS[unit], { maximumFractionDigits: 2, useGrouping: false })
}

function handleEnabledChange(enabled: boolean) {
  emit('update', { ...props.override, enabled })
}

function handleResultsTtlChange(value: DurationDraft) {
  emit('update', { ...props.override, resultsTtl: value })
}

function handleEmptyTtlChange(value: DurationDraft) {
  emit('update', { ...props.override, emptyTtl: value })
}

function handleReset() {
  emit('reset', providerOverrideKey(props.override))
}
</script>

<template>
  <!-- Fixed tracks keep the toggle and both durations in the same place on every row, whether or not a provider keeps empty answers. -->
  <li
    class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 bg-card px-4 py-3.5 md:px-5 xl:grid-cols-[minmax(9rem,1fr)_auto_13.5rem_13.5rem_2rem]"
    :data-testid="`cache-provider-${override.namespace}-${override.provider}`"
  >
    <div class="min-w-0 pt-1.5 xl:col-start-1 xl:row-start-1">
      <p class="settings-label">{{ label }}</p>
      <p v-if="statusHint" :id="`${id}-status`" class="settings-hint">{{ statusHint }}</p>
    </div>

    <div class="flex items-center gap-1 xl:contents">
      <div class="flex h-8 items-center gap-2 xl:col-start-2 xl:row-start-1">
        <ToggleSwitch
          :id="`${id}-enabled`"
          :model-value="override.enabled"
          :disabled="locked"
          :aria-label="t('settings.metadata.searchCache.providers.enabledLabel', { provider: label })"
          :aria-describedby="statusHint ? `${id}-status` : undefined"
          @update:model-value="handleEnabledChange"
        />
        <!-- Both words share one cell so the label is as wide as the longer one and the switch never shifts. -->
        <span class="grid text-xs text-muted-foreground" aria-hidden="true">
          <span class="col-start-1 row-start-1" :class="override.enabled ? '' : 'invisible'">{{
            t('settings.metadata.searchCache.providers.on')
          }}</span>
          <span class="col-start-1 row-start-1" :class="override.enabled ? 'invisible' : ''">{{
            t('settings.metadata.searchCache.providers.off')
          }}</span>
        </span>
      </div>
      <div class="flex size-8 items-center justify-center xl:col-start-5 xl:row-start-1">
        <Button
          v-if="isOverridden && !locked"
          variant="ghost"
          size="icon-sm"
          type="button"
          :aria-label="t('settings.metadata.searchCache.providers.reset', { provider: label })"
          :title="t('settings.metadata.searchCache.providers.reset', { provider: label })"
          @click="handleReset"
        >
          <RotateCcw class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>

    <div class="col-span-2 flex flex-wrap gap-x-4 gap-y-3 xl:contents">
      <div class="flex min-w-0 flex-col gap-1 xl:col-start-3 xl:row-start-1">
        <span class="text-xs text-muted-foreground" aria-hidden="true">{{ t('settings.metadata.searchCache.providers.resultsTtl') }}</span>
        <CacheDurationInput
          :id="`${id}-results`"
          :model-value="override.resultsTtl"
          :amount-label="t('settings.metadata.searchCache.providers.resultsTtlLabel', { provider: label })"
          :unit-label="t('settings.metadata.searchCache.providers.resultsTtlUnitLabel', { provider: label })"
          :placeholder="inheritedPlaceholder(inherited.resultsTtl, override.resultsTtl.unit)"
          :invalid="!!resultsError"
          :described-by="resultsError ? `${id}-results-error` : undefined"
          :disabled="locked"
          @update:model-value="handleResultsTtlChange"
        />
        <p v-if="resultsError" :id="`${id}-results-error`" role="alert" class="text-xs text-destructive">{{ resultsError }}</p>
      </div>

      <div v-if="provider.cachesEmptyResults" class="flex min-w-0 flex-col gap-1 xl:col-start-4 xl:row-start-1">
        <span class="text-xs text-muted-foreground" aria-hidden="true">{{ t('settings.metadata.searchCache.providers.emptyTtl') }}</span>
        <CacheDurationInput
          :id="`${id}-empty`"
          :model-value="override.emptyTtl"
          :amount-label="t('settings.metadata.searchCache.providers.emptyTtlLabel', { provider: label })"
          :unit-label="t('settings.metadata.searchCache.providers.emptyTtlUnitLabel', { provider: label })"
          :placeholder="inheritedPlaceholder(inherited.emptyTtl, override.emptyTtl.unit)"
          :invalid="!!emptyError"
          :described-by="emptyError ? `${id}-empty-error` : undefined"
          :disabled="locked"
          @update:model-value="handleEmptyTtlChange"
        />
        <p v-if="emptyError" :id="`${id}-empty-error`" role="alert" class="text-xs text-destructive">{{ emptyError }}</p>
      </div>
    </div>
  </li>
</template>
