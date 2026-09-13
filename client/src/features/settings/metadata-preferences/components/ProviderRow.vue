<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Loader2, Plug, SlidersHorizontal, TriangleAlert } from '@lucide/vue'
import type { ProviderConnectionTestResult } from '@bookorbit/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'
import { getProviderColor } from '@/lib/provider-colors'
import type { ProviderChipView, ProviderDraftEntry, ProviderFieldDef, ProviderRowDef } from '../lib/provider-rows'
import ProviderBrandTile from './ProviderBrandTile.vue'

const { t } = useI18n()

const props = defineProps<{
  row: ProviderRowDef
  provider: ProviderDraftEntry
  chip: ProviderChipView | null
  expanded: boolean
  testable: boolean
  testing: boolean
  testResult: ProviderConnectionTestResult | null
  /** Set when the source cannot be switched on yet; the text explains what is missing. */
  blockedMessage: string | null
}>()

const emit = defineEmits<{
  toggle: []
  test: []
  'update:expanded': [value: boolean]
  'update:field': [payload: { key: string; value: string }]
}>()

const uid = useId()
const nameId = computed(() => `provider-name-${uid}`)
const panelId = computed(() => `provider-panel-${uid}`)

const hasFields = computed(() => props.row.fields.length > 0)
const brandColor = computed(() => getProviderColor(props.row.key))

const CHIP_CLASSES: Record<ProviderChipView['kind'], string> = {
  active: 'border-success/30 bg-success/10 text-success',
  ready: 'border-border text-muted-foreground',
  setup: 'border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  throttled: 'border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400',
}

const testResultClass = computed(() => {
  const status = props.testResult?.status
  if (status === 'success') return 'border-success/30 bg-success/10 text-success'
  if (status === 'warning') return 'border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400'
  return 'border-destructive/30 bg-destructive/10 text-destructive'
})

function fieldId(field: ProviderFieldDef): string {
  return `provider-${props.row.key}-${field.key}-${uid}`
}

function canEditField(field: ProviderFieldDef): boolean {
  return props.provider.enabled || field.alwaysEditable === true
}

function fieldValue(field: ProviderFieldDef): string {
  const value = props.provider[field.key]
  return typeof value === 'string' ? value : ''
}

function onFieldInput(field: ProviderFieldDef, event: Event) {
  emit('update:field', { key: field.key, value: (event.target as HTMLInputElement | HTMLSelectElement).value })
}

function handleToggle() {
  emit('toggle')
}

function handleTest() {
  emit('test')
}

function handleExpandToggle() {
  emit('update:expanded', !props.expanded)
}
</script>

<template>
  <div class="relative bg-card transition-colors hover:bg-muted/25">
    <span v-if="provider.enabled" class="absolute inset-y-0 left-0 w-[3px]" :style="{ backgroundColor: brandColor }" aria-hidden="true" />

    <div class="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3 md:flex-nowrap md:px-5">
      <ProviderBrandTile class="order-1" :provider-key="row.key" :label="row.label" :enabled="provider.enabled" />

      <div class="order-2 min-w-0 flex-1">
        <span :id="nameId" class="settings-label">{{ row.label }}</span>
        <p v-if="row.hint" class="settings-hint line-clamp-2">{{ row.hint }}</p>
      </div>

      <div class="order-4 flex w-full items-center gap-2 pl-[2.875rem] md:order-3 md:w-auto md:shrink-0 md:justify-end md:pl-0">
        <span class="flex shrink-0 md:min-w-[7.75rem] md:justify-end">
          <Badge
            v-if="chip"
            variant="outline"
            class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wide"
            :class="CHIP_CLASSES[chip.kind]"
            :title="chip.title"
          >
            <TriangleAlert v-if="chip.kind === 'setup'" :size="11" aria-hidden="true" />
            <span v-if="chip.title" class="sr-only">{{ chip.title }}</span>
            {{ chip.label }}
          </Badge>
        </span>

        <span class="flex shrink-0 md:min-w-[7.5rem] md:justify-end">
          <Button
            v-if="hasFields"
            type="button"
            variant="outline"
            size="sm"
            class="h-7 gap-1.5 px-2 text-[11px]"
            :aria-expanded="expanded"
            :aria-controls="panelId"
            @click="handleExpandToggle"
          >
            <SlidersHorizontal :size="12" aria-hidden="true" />
            <span>{{ t('settings.metadata.providers.configure') }}</span>
            <ChevronDown :size="12" class="transition-transform" :class="{ 'rotate-180': expanded }" aria-hidden="true" />
          </Button>
        </span>
      </div>

      <button
        type="button"
        role="switch"
        class="order-3 relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card md:order-4"
        :class="[provider.enabled ? 'bg-primary' : 'border border-border bg-muted', blockedMessage && !provider.enabled ? 'opacity-50' : '']"
        :aria-checked="provider.enabled"
        :aria-disabled="blockedMessage && !provider.enabled ? true : undefined"
        :aria-labelledby="nameId"
        @click="handleToggle"
      >
        <span
          class="pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform"
          :class="provider.enabled ? 'translate-x-4.5' : 'translate-x-0.5'"
        />
      </button>
    </div>

    <div v-show="expanded" :id="panelId" class="border-t border-border bg-muted/50 px-4 py-4 md:px-5 md:pl-[4.125rem]">
      <div class="flex flex-col gap-3.5">
        <p
          v-if="blockedMessage"
          class="flex items-start gap-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 text-xs leading-snug text-amber-600 dark:text-amber-400"
        >
          <TriangleAlert :size="14" class="mt-px shrink-0" aria-hidden="true" />
          <span>{{ blockedMessage }}</span>
        </p>

        <p v-if="testResult" role="status" class="rounded-md border px-2.5 py-2 text-xs leading-snug" :class="testResultClass">
          {{ testResult.message }}
        </p>

        <div class="flex flex-wrap gap-3">
          <div v-for="field in row.fields" :key="field.key" class="flex w-full min-w-0 flex-col gap-1.5" :class="field.widthClass">
            <label :for="fieldId(field)" class="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {{ field.label }}
            </label>

            <select
              v-if="field.type === 'select'"
              :id="fieldId(field)"
              :value="fieldValue(field)"
              :disabled="!canEditField(field)"
              class="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              @change="onFieldInput(field, $event)"
            >
              <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
            </select>

            <input
              v-else
              :id="fieldId(field)"
              v-bind="SECRET_INPUT_ATTRS"
              :type="field.type === 'password' ? 'text' : field.type"
              :name="`metadata-${row.key}-${field.key}`"
              :value="fieldValue(field)"
              :placeholder="field.placeholder ?? field.label"
              :disabled="!canEditField(field)"
              class="h-9 w-full min-w-0 rounded-md border border-input bg-background px-2.5 text-sm transition-shadow placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              :class="{ 'input-secret': field.type === 'password' }"
              @input="onFieldInput(field, $event)"
            />

            <p v-if="field.helper" class="text-[11px] leading-snug text-muted-foreground">{{ field.helper }}</p>
          </div>
        </div>

        <div v-if="testable" class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Button type="button" variant="outline" size="sm" :disabled="testing" @click="handleTest">
            <Loader2 v-if="testing" :size="13" class="animate-spin" aria-hidden="true" />
            <Plug v-else :size="13" aria-hidden="true" />
            <span>{{ testing ? t('settings.metadata.providers.testing') : t('settings.metadata.providers.test') }}</span>
          </Button>
          <p class="text-[11px] leading-snug text-muted-foreground">{{ t('settings.metadata.providers.testHint') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
