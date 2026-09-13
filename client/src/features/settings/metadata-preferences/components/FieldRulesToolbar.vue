<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { RotateCcw, Search, Trash2, X } from '@lucide/vue'
import type { FieldPreference, MetadataField, MetadataProviderKey, ProviderStatus } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ProviderBulkMenu from './ProviderBulkMenu.vue'
import type { ProviderBulkAction } from '../lib/field-rules'

const { t } = useI18n()

defineProps<{
  fields: Record<MetadataField, FieldPreference>
  statuses: ProviderStatus[]
  query: string
  providerFilter: MetadataProviderKey | null
  overriddenOnly: boolean
  isGlobalScope: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  'update:providerFilter': [value: MetadataProviderKey | null]
  'update:overriddenOnly': [value: boolean]
  bulk: [provider: MetadataProviderKey, action: ProviderBulkAction]
  clearProviders: []
  resetScope: []
}>()

function onQueryInput(event: Event) {
  emit('update:query', (event.target as HTMLInputElement).value)
}

function clearQuery() {
  emit('update:query', '')
}

function onProviderFilter(provider: MetadataProviderKey | null) {
  emit('update:providerFilter', provider)
}

function onBulk(provider: MetadataProviderKey, action: ProviderBulkAction) {
  emit('bulk', provider, action)
}

function toggleOverriddenOnly() {
  emit('update:overriddenOnly', true)
}

function showAllFields() {
  emit('update:overriddenOnly', false)
}

function clearProviders() {
  emit('clearProviders')
}

function resetScope() {
  emit('resetScope')
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 md:px-6">
    <div class="relative min-w-0 flex-1 md:max-w-64 md:flex-none">
      <Search :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        type="search"
        :value="query"
        :placeholder="t('settings.metadata.fieldRules.toolbar.searchFields')"
        :aria-label="t('settings.metadata.fieldRules.toolbar.searchFields')"
        class="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
        @input="onQueryInput"
      />
      <button
        v-if="query"
        type="button"
        class="absolute right-2 top-1/2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        :aria-label="t('settings.metadata.fieldRules.toolbar.clearSearch')"
        @click="clearQuery"
      >
        <X :size="13" aria-hidden="true" />
      </button>
    </div>

    <ProviderBulkMenu
      :fields="fields"
      :statuses="statuses"
      :filter="providerFilter"
      :disabled="disabled"
      @filter-change="onProviderFilter"
      @bulk="onBulk"
    />

    <div v-if="!isGlobalScope" class="inline-flex rounded-md border border-input p-0.5">
      <button
        type="button"
        :aria-pressed="!overriddenOnly"
        class="h-7 rounded px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
        :class="!overriddenOnly ? 'bg-muted font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground'"
        @click="showAllFields"
      >
        {{ t('settings.metadata.fieldRules.toolbar.allFields') }}
      </button>
      <button
        type="button"
        :aria-pressed="overriddenOnly"
        class="h-7 rounded px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-primary"
        :class="overriddenOnly ? 'bg-muted font-semibold text-foreground' : 'font-medium text-muted-foreground hover:text-foreground'"
        @click="toggleOverriddenOnly"
      >
        {{ t('settings.metadata.fieldRules.toolbar.overridesOnly') }}
      </button>
    </div>

    <div class="ml-auto flex items-center gap-2">
      <Button variant="destructive-outline" size="sm" type="button" :disabled="disabled" @click="clearProviders">
        <Trash2 :size="13" />
        <span class="hidden sm:inline">{{ t('settings.metadata.fieldRules.clearAllProviders') }}</span>
        <span class="sm:hidden">{{ t('settings.metadata.fieldRules.clearAll') }}</span>
      </Button>
      <Button variant="outline" size="sm" type="button" :disabled="disabled" @click="resetScope">
        <RotateCcw :size="13" />
        <span class="hidden sm:inline">{{ t('settings.metadata.fieldRules.resetToDefault') }}</span>
        <span class="sm:hidden">{{ t('settings.metadata.fieldRules.reset') }}</span>
      </Button>
    </div>
  </div>
</template>
