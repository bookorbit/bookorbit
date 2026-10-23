<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BookMetadataFetchBreakdown, BookMetadataFetchConditions, MetadataField } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { formatList, formatNumber } from '@/i18n/formatters'
import type { ConditionKey, OverrideKey } from '../lib/auto-fetch-rules'
import AutoFetchFieldChips from './AutoFetchFieldChips.vue'
import AutoFetchScoreHistogram from './AutoFetchScoreHistogram.vue'
import AutoFetchThresholdStepper from './AutoFetchThresholdStepper.vue'

const props = defineProps<{
  conditions: BookMetadataFetchConditions
  breakdown: BookMetadataFetchBreakdown | null
  /** Set on a library tab: each condition then says whether it follows the global rule. */
  globalConditions?: BookMetadataFetchConditions | null
  ownKeys?: OverrideKey[]
}>()
const emit = defineEmits<{
  set: [key: ConditionKey, value: BookMetadataFetchConditions[ConditionKey]]
  followGlobal: [key: ConditionKey]
}>()

const { t } = useI18n()
const ids = { neverFetched: useId(), scoreThreshold: useId(), missingFields: useId(), scoreBelow: useId() }

const isLibrary = computed(() => Boolean(props.globalConditions))
const total = computed(() => props.breakdown?.total ?? null)
const fetchedBefore = computed(() => (props.breakdown ? props.breakdown.total - props.breakdown.neverFetched : 0))
const neverShare = computed(() => (props.breakdown && props.breakdown.total > 0 ? (props.breakdown.neverFetched / props.breakdown.total) * 100 : 0))

function isOwn(key: ConditionKey): boolean {
  return Boolean(props.ownKeys?.includes(key))
}

function countText(value: number | undefined): string {
  return value === undefined ? '-' : formatNumber(value)
}

function globalValue(key: ConditionKey): string {
  const global = props.globalConditions
  if (!global) return ''
  const off = t('settings.metadata.autoFetch.columns.off')
  if (key === 'neverFetched') return global.neverFetched.enabled ? t('settings.metadata.autoFetch.columns.on') : off
  if (key === 'scoreThreshold')
    return global.scoreThreshold.enabled
      ? t('settings.metadata.autoFetch.columns.scoreBelowValue', { threshold: global.scoreThreshold.threshold })
      : off
  if (!global.missingFields.enabled || global.missingFields.fields.length === 0) return off
  return formatList(global.missingFields.fields.map((field) => t(`settings.metadata.fields.${field}`)))
}

const columns = computed(() => [
  {
    key: 'neverFetched' as const,
    titleId: ids.neverFetched,
    title: t('settings.metadata.autoFetch.conditions.neverFetched.label'),
    hint: t('settings.metadata.autoFetch.conditions.neverFetched.hint'),
    on: props.conditions.neverFetched.enabled,
    count: props.breakdown?.neverFetched,
  },
  {
    key: 'scoreThreshold' as const,
    titleId: ids.scoreThreshold,
    title: t('settings.metadata.autoFetch.columns.lowScoreLabel'),
    hint: t('settings.metadata.autoFetch.columns.lowScoreHint'),
    on: props.conditions.scoreThreshold.enabled,
    count: props.breakdown?.lowScore,
  },
  {
    key: 'missingFields' as const,
    titleId: ids.missingFields,
    title: t('settings.metadata.autoFetch.conditions.missingFields.label'),
    hint: t('settings.metadata.autoFetch.columns.missingHint'),
    on: props.conditions.missingFields.enabled && props.conditions.missingFields.fields.length > 0,
    count: props.breakdown?.missingAny,
  },
])

function handleToggle(key: ConditionKey) {
  const current = props.conditions[key]
  emit('set', key, { ...current, enabled: !current.enabled })
}

function toggleNeverFetched() {
  handleToggle('neverFetched')
}

function toggleScore() {
  handleToggle('scoreThreshold')
}

function toggleMissing() {
  const current = props.conditions.missingFields
  // Switching the condition on with nothing picked would match no book, so start from the global picks.
  const fields = !current.enabled && current.fields.length === 0 ? (props.globalConditions?.missingFields.fields ?? []) : current.fields
  emit('set', 'missingFields', { enabled: !current.enabled, fields: [...fields] })
}

const TOGGLES: Record<ConditionKey, () => void> = { neverFetched: toggleNeverFetched, scoreThreshold: toggleScore, missingFields: toggleMissing }

function setThreshold(threshold: number) {
  emit('set', 'scoreThreshold', { enabled: true, threshold })
}

function toggleField(field: MetadataField) {
  const current = props.conditions.missingFields
  const fields = current.fields.includes(field) ? current.fields.filter((item) => item !== field) : [...current.fields, field]
  emit('set', 'missingFields', { enabled: true, fields })
}

function handleFollowGlobal(event: MouseEvent) {
  const key = (event.currentTarget as HTMLElement).dataset.key as ConditionKey | undefined
  if (key) emit('followGlobal', key)
}
</script>

<template>
  <div class="grid grid-cols-1 @min-[48rem]:grid-cols-2 @min-[64rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1.75fr)]">
    <section
      v-for="(column, index) in columns"
      :key="column.key"
      class="min-w-0 border-border px-4 py-4 md:px-6 md:pt-[18px] md:pb-[22px]"
      :class="[
        index === 0 ? '' : 'border-t',
        index === 1 ? '@min-[48rem]:border-t-0 @min-[48rem]:border-s' : '',
        index === 2 ? '@min-[48rem]:col-span-2 @min-[64rem]:col-span-1 @min-[64rem]:border-t-0 @min-[64rem]:border-s' : '',
        isOwn(column.key) ? 'shadow-[inset_0_2px_0_color-mix(in_oklch,var(--primary)_65%,transparent)]' : '',
      ]"
      :data-condition="column.key"
      :aria-labelledby="column.titleId"
    >
      <div class="flex min-h-[22px] items-center gap-2.5">
        <ToggleSwitch :model-value="column.on" :aria-labelledby="column.titleId" @update:model-value="TOGGLES[column.key]" />
        <h3 :id="column.titleId" class="min-w-0 flex-1 text-sm font-semibold tracking-[-0.005em] text-foreground">{{ column.title }}</h3>
        <span v-if="isLibrary && isOwn(column.key)" class="inline-flex shrink-0 items-center gap-2">
          <span class="settings-state-pill">{{ t('settings.metadata.autoFetch.columns.own') }}</span>
          <button
            type="button"
            class="rounded-xs text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :data-key="column.key"
            @click="handleFollowGlobal"
          >
            {{ t('settings.metadata.autoFetch.columns.useGlobal') }}
          </button>
        </span>
        <span v-else-if="isLibrary" class="shrink-0 text-xs text-muted-foreground">{{ t('settings.metadata.autoFetch.columns.global') }}</span>
      </div>

      <p v-if="column.on" class="mt-3.5 mb-1.5 flex items-baseline gap-1.5">
        <span class="text-[28px] leading-none font-[650] tracking-[-0.025em] text-foreground tabular-nums">{{ countText(column.count) }}</span>
        <span class="text-[13px] font-medium text-foreground">{{
          t('settings.metadata.autoFetch.columns.books', { count: column.count ?? 0 })
        }}</span>
        <span v-if="total !== null" class="text-[13px] text-muted-foreground">{{
          t('settings.metadata.autoFetch.columns.ofTotal', { total: formatNumber(total) })
        }}</span>
      </p>
      <p v-else class="mt-3.5 mb-1.5 text-xl leading-7 font-semibold text-muted-foreground">{{ t('settings.metadata.autoFetch.columns.off') }}</p>
      <p class="settings-hint">{{ column.hint }}</p>
      <p v-if="isLibrary && isOwn(column.key)" class="mt-1 text-xs text-muted-foreground">
        {{ t('settings.metadata.autoFetch.columns.globalValue', { value: globalValue(column.key) }) }}
      </p>

      <template v-if="column.key === 'neverFetched' && breakdown">
        <div class="mt-4 flex h-1.5 overflow-hidden rounded-full bg-foreground/12" aria-hidden="true">
          <span class="bg-primary" :style="{ width: `${neverShare}%` }" />
        </div>
        <p class="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
          <span class="inline-flex items-center gap-1.5"
            ><span class="size-2 rounded-[3px] bg-primary" aria-hidden="true" />{{
              t('settings.metadata.autoFetch.columns.neverFetchedSplit', { count: breakdown.neverFetched })
            }}</span
          >
          <span class="inline-flex items-center gap-1.5"
            ><span class="size-2 rounded-[3px] bg-foreground/12" aria-hidden="true" />{{
              t('settings.metadata.autoFetch.columns.fetchedBeforeSplit', { count: fetchedBefore })
            }}</span
          >
        </p>
      </template>

      <div v-if="column.key === 'scoreThreshold' && conditions.scoreThreshold.enabled" class="mt-3.5">
        <div class="mb-1 flex items-center gap-2">
          <span :id="ids.scoreBelow" class="text-xs text-muted-foreground">{{
            t('settings.metadata.autoFetch.conditions.scoreThreshold.scoreBelow')
          }}</span>
          <AutoFetchThresholdStepper
            :model-value="conditions.scoreThreshold.threshold"
            :changed="isOwn('scoreThreshold')"
            :labelled-by="ids.scoreBelow"
            @update:model-value="setThreshold"
          />
          <span class="text-xs text-muted-foreground">{{ t('settings.metadata.autoFetch.columns.outOf') }}</span>
        </div>
        <AutoFetchScoreHistogram
          v-if="breakdown"
          :bins="breakdown.scoreBins"
          :threshold="conditions.scoreThreshold.threshold"
          @update:threshold="setThreshold"
        />
      </div>

      <div v-if="column.key === 'missingFields' && conditions.missingFields.enabled" class="mt-3.5">
        <AutoFetchFieldChips
          :selected="conditions.missingFields.fields"
          :counts="breakdown?.missingByField ?? null"
          :with-audio="breakdown?.withAudio ?? null"
          @toggle="toggleField"
        />
      </div>
    </section>
  </div>
</template>
