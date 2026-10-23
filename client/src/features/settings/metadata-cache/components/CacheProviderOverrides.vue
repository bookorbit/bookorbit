<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { METADATA_CACHE_NAMESPACES, type MetadataCacheNamespace, type MetadataCacheProviderInfo } from '@bookorbit/types'
import CacheProviderOverrideRow from './CacheProviderOverrideRow.vue'
import { providerOverrideKey, type DurationDraft, type ProviderOverrideDraft, type ProviderOverrideErrors } from '../lib/cache-settings'

const props = defineProps<{
  providers: MetadataCacheProviderInfo[]
  overrides: Record<string, ProviderOverrideDraft>
  errors: Record<string, ProviderOverrideErrors>
  inherited: { resultsTtl: DurationDraft; emptyTtl: DurationDraft }
  globalEnabled: boolean
}>()

const emit = defineEmits<{
  update: [ProviderOverrideDraft]
  reset: [key: string]
}>()

const { t } = useI18n()

const NAMESPACE_LABEL_KEYS: Record<MetadataCacheNamespace, string> = {
  book: 'settings.metadata.searchCache.providers.books',
  author: 'settings.metadata.searchCache.providers.authors',
}

interface ProviderGroup {
  namespace: MetadataCacheNamespace
  label: string
  rows: { key: string; provider: MetadataCacheProviderInfo; override: ProviderOverrideDraft }[]
}

const groups = computed<ProviderGroup[]>(() =>
  METADATA_CACHE_NAMESPACES.map((namespace) => ({
    namespace,
    label: t(NAMESPACE_LABEL_KEYS[namespace]),
    rows: props.providers
      .filter((provider) => provider.namespace === namespace)
      .flatMap((provider) => {
        const key = providerOverrideKey(provider)
        const override = props.overrides[key]
        return override ? [{ key, provider, override }] : []
      }),
  })).filter((group) => group.rows.length > 0),
)

function handleUpdate(next: ProviderOverrideDraft) {
  emit('update', next)
}

function handleReset(key: string) {
  emit('reset', key)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="!globalEnabled" class="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
      {{ t('settings.metadata.searchCache.providers.globalOff') }}
    </p>
    <section v-for="group in groups" :key="group.namespace" :aria-labelledby="`cache-providers-${group.namespace}`" class="flex flex-col gap-2">
      <h3 :id="`cache-providers-${group.namespace}`" class="settings-card-title">{{ group.label }}</h3>
      <ul class="settings-card">
        <CacheProviderOverrideRow
          v-for="row in group.rows"
          :key="row.key"
          :provider="row.provider"
          :override="row.override"
          :errors="errors[row.key]"
          :inherited="inherited"
          @update="handleUpdate"
          @reset="handleReset"
        />
      </ul>
    </section>
    <p v-if="groups.length === 0" class="settings-empty-state text-sm text-muted-foreground">
      {{ t('settings.metadata.searchCache.providers.none') }}
    </p>
  </div>
</template>
