<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, ChevronDown, ChevronUp, RotateCcw, TriangleAlert, X } from '@lucide/vue'
import type { FieldPreference, MergeStrategy, MetadataProviderKey, ProviderStatus } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'
import ProviderAddMenu from './ProviderAddMenu.vue'
import { resolvedProviders, skippedProviders, skipReasonFor } from '../lib/field-rules'

const { t } = useI18n()

const props = defineProps<{
  fieldLabel: string
  preference: FieldPreference
  statuses: ProviderStatus[]
  saving?: boolean
  /** Undefined on the global scope, where "inherited" has no meaning. */
  inherited?: boolean
  scopeName: string
}>()

const emit = defineEmits<{
  change: [pref: FieldPreference]
  revert: []
  close: []
}>()

const MERGE_ORDER: MergeStrategy[] = ['fillMissing', 'overwriteIfProvided', 'overwrite']

const rows = computed(() =>
  props.preference.providers.map((key, index) => {
    const status = props.statuses.find((entry) => entry.key === key)
    return {
      key,
      index,
      label: status?.label ?? key,
      short: PROVIDER_SHORT_LABELS[key] ?? key,
      skipReason: skipReasonFor(status),
    }
  }),
)

const resolved = computed(() => resolvedProviders(props.preference.providers, props.statuses))
const skipped = computed(() => skippedProviders(props.preference.providers, props.statuses))
const providerLabel = (key: MetadataProviderKey) => props.statuses.find((entry) => entry.key === key)?.label ?? key

const mergeOptions = computed(() =>
  MERGE_ORDER.map((value) => ({
    value,
    label: t(`settings.metadata.mergeStrategy.${value}.label`),
    description: t(`settings.metadata.mergeStrategy.${value}.description`),
  })),
)

function update(patch: Partial<FieldPreference>) {
  emit('change', { ...props.preference, ...patch })
}

function move(index: number, delta: number) {
  const providers = [...props.preference.providers]
  const target = index + delta
  const moved = providers[index]
  const displaced = providers[target]
  if (moved === undefined || displaced === undefined) return
  providers[index] = displaced
  providers[target] = moved
  update({ providers })
}

function moveUp(index: number) {
  move(index, -1)
}

function moveDown(index: number) {
  move(index, 1)
}

function removeProvider(index: number) {
  update({ providers: props.preference.providers.filter((_, position) => position !== index) })
}

function addProvider(provider: MetadataProviderKey) {
  if (props.preference.providers.includes(provider)) return
  update({ providers: [...props.preference.providers, provider] })
}

function selectMerge(value: MergeStrategy) {
  update({ mergeStrategy: value })
}

function handleRevert() {
  emit('revert')
}

function handleClose() {
  emit('close')
}
</script>

<template>
  <div class="border-t border-border bg-muted/20 px-4 py-4 md:px-6 md:py-5">
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <!-- Priority order -->
      <section>
        <div class="mb-2.5 flex items-center gap-2">
          <h4 class="settings-group-label mb-0!">{{ t('settings.metadata.fieldRules.detail.priority') }}</h4>
          <p class="settings-hint mt-0!">{{ t('settings.metadata.fieldRules.detail.priorityHint') }}</p>
        </div>

        <ul v-if="rows.length" class="space-y-1.5">
          <li
            v-for="row in rows"
            :key="row.key"
            class="flex items-center gap-2.5 rounded-md border bg-card px-2.5 py-1.5"
            :class="row.skipReason ? 'border-dashed border-border' : 'border-border'"
          >
            <span class="w-4 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">
              {{ row.skipReason ? '-' : resolved.indexOf(row.key) + 1 }}
            </span>
            <span
              class="inline-flex h-6 items-center rounded px-2 text-xs font-medium"
              :class="row.skipReason ? 'provider-chip-skipped' : 'provider-chip'"
              :style="row.skipReason ? undefined : providerChipStyle(row.key)"
            >
              {{ row.short }}
            </span>
            <span v-if="row.skipReason" class="truncate text-xs text-warning">
              {{ t(`settings.metadata.fieldRules.providerState.${row.skipReason}`) }}
            </span>
            <div class="ml-auto flex shrink-0 items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                :disabled="saving || row.index === 0"
                :aria-label="t('settings.metadata.fieldRules.detail.moveUp', { provider: row.label })"
                @click="moveUp(row.index)"
              >
                <ChevronUp :size="15" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                :disabled="saving || row.index === rows.length - 1"
                :aria-label="t('settings.metadata.fieldRules.detail.moveDown', { provider: row.label })"
                @click="moveDown(row.index)"
              >
                <ChevronDown :size="15" />
              </Button>
              <Button
                variant="destructive-ghost"
                size="icon-sm"
                type="button"
                :disabled="saving"
                :aria-label="t('settings.metadata.fieldRules.field.removeProvider', { provider: row.label })"
                @click="removeProvider(row.index)"
              >
                <X :size="14" />
              </Button>
            </div>
          </li>
        </ul>
        <p v-else class="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          {{ t('settings.metadata.fieldRules.field.noProvidersYet') }}
        </p>

        <div class="mt-3">
          <ProviderAddMenu :assigned="preference.providers" :statuses="statuses" :disabled="saving" :field-label="fieldLabel" @add="addProvider" />
        </div>
      </section>

      <!-- Merge strategy + result -->
      <div class="space-y-5">
        <section>
          <h4 class="settings-group-label">{{ t('settings.metadata.fieldRules.table.mergeStrategy') }}</h4>
          <div class="space-y-1.5" role="radiogroup" :aria-label="t('settings.metadata.fieldRules.table.mergeStrategy')">
            <button
              v-for="option in mergeOptions"
              :key="option.value"
              type="button"
              role="radio"
              :aria-checked="preference.mergeStrategy === option.value"
              :disabled="saving"
              class="flex w-full items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              :class="preference.mergeStrategy === option.value ? 'border-primary bg-primary/10' : 'border-border bg-card hover:border-primary/40'"
              @click="selectMerge(option.value)"
            >
              <span
                class="mt-0.5 size-4 shrink-0 rounded-full border-2"
                :class="preference.mergeStrategy === option.value ? 'border-[5px] border-primary' : 'border-input'"
                aria-hidden="true"
              />
              <span class="min-w-0">
                <span class="block text-sm font-semibold text-foreground">{{ option.label }}</span>
                <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{{ option.description }}</span>
              </span>
            </button>
          </div>
        </section>

        <section>
          <h4 class="settings-group-label">{{ t('settings.metadata.fieldRules.detail.result') }}</h4>
          <div class="rounded-md border border-border bg-card px-3.5 py-3">
            <p class="text-xs text-muted-foreground">{{ t('settings.metadata.fieldRules.detail.resultHint') }}</p>
            <div v-if="resolved.length" class="mt-2.5 flex flex-wrap items-center gap-1.5">
              <template v-for="(key, index) in resolved" :key="key">
                <ArrowRight v-if="index > 0" :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="provider-chip inline-flex h-6 items-center rounded px-2 text-xs font-medium" :style="providerChipStyle(key)">
                  {{ PROVIDER_SHORT_LABELS[key] ?? key }}
                </span>
              </template>
            </div>
            <p v-else class="mt-2.5 flex items-center gap-2 text-xs font-medium text-warning">
              <TriangleAlert :size="14" class="shrink-0" aria-hidden="true" />
              {{ t('settings.metadata.fieldRules.detail.noUsableProviders') }}
            </p>
            <p v-if="skipped.length" class="mt-2.5 flex items-start gap-2 text-xs leading-relaxed text-warning">
              <TriangleAlert :size="14" class="mt-px shrink-0" aria-hidden="true" />
              <span>
                {{
                  t('settings.metadata.fieldRules.detail.skippedSummary', {
                    providers: skipped.map((key) => providerLabel(key)).join(', '),
                    count: skipped.length,
                  })
                }}
              </span>
            </p>
            <p class="mt-2.5 text-xs leading-relaxed text-muted-foreground">
              {{ t('settings.metadata.fieldRules.detail.appliesTo', { scope: scopeName }) }}
            </p>
          </div>
        </section>
      </div>
    </div>

    <div class="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
      <Button v-if="inherited === false" variant="outline" size="sm" type="button" :disabled="saving" @click="handleRevert">
        <RotateCcw :size="13" />
        {{ t('settings.metadata.fieldRules.detail.inheritGlobal') }}
      </Button>
      <span v-else-if="inherited === true" class="settings-hint mt-0!">{{ t('settings.metadata.fieldRules.detail.inheritingGlobal') }}</span>
      <Button variant="ghost" size="sm" type="button" class="ml-auto" @click="handleClose">
        {{ t('settings.metadata.fieldRules.detail.collapse') }}
      </Button>
    </div>
  </div>
</template>
