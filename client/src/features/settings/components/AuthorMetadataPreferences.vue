<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ALL_AUTHOR_METADATA_FIELDS, providerSupportsAuthorField } from '@bookorbit/types'
import type {
  AuthorFieldPreference,
  AuthorMetadataField,
  AuthorMetadataPreferences,
  AuthorMetadataProviderInfo,
  AuthorMetadataProviderKey,
  MetadataProviderKey,
  ProviderStatus,
} from '@bookorbit/types'
import { Plus } from '@lucide/vue'
import { api } from '@/lib/api'
import ProviderChipList from '../metadata-preferences/components/ProviderChipList.vue'
import MergeStrategyPicker from '../metadata-preferences/components/MergeStrategyPicker.vue'

const { t } = useI18n()

const preferences = ref<AuthorMetadataPreferences | null>(null)
const providers = ref<AuthorMetadataProviderInfo[]>([])
const saving = ref(false)

const fields = computed(() => ALL_AUTHOR_METADATA_FIELDS)

// ProviderChipList is shared with book metadata and describes providers as
// ProviderStatus. Author provider keys are the same string values, so it takes
// them unchanged.
const statuses = computed<ProviderStatus[]>(() =>
  providers.value.map((provider) => ({
    key: provider.key as unknown as MetadataProviderKey,
    label: provider.label,
    configured: true,
    enabled: true,
  })),
)

function capableProviders(field: AuthorMetadataField): AuthorMetadataProviderInfo[] {
  return providers.value.filter((provider) => providerSupportsAuthorField(provider.key, field))
}

// Ordering only means something where more than one provider can fill the
// field. Audnexus returns just a biography and a photo, so the other five
// fields have a single possible source and render as plain text.
function isOrderable(field: AuthorMetadataField): boolean {
  return capableProviders(field).length > 1
}

// ProviderChipList can reorder and remove but never add, so an orderable field
// needs its own affordance or a removed provider is gone for good.
function unassignedProviders(field: AuthorMetadataField): AuthorMetadataProviderInfo[] {
  const assigned = new Set<string>(preferenceFor(field)?.providers ?? [])
  return capableProviders(field).filter((provider) => !assigned.has(provider.key))
}

function addProvider(field: AuthorMetadataField, key: AuthorMetadataProviderKey) {
  const current = preferenceFor(field)
  if (!current || current.providers.includes(key)) return
  update(field, { providers: [...current.providers, key] })
}

function soleProviderLabel(field: AuthorMetadataField): string {
  return capableProviders(field)[0]?.label ?? t('settings.admin.authorEnrichment.metadataPreferences.noProviders')
}

const providersHint = computed(() => {
  const limited = providers.value.filter((provider) => provider.supportedFields.length < ALL_AUTHOR_METADATA_FIELDS.length)
  if (limited.length === 0) return ''
  return t('settings.admin.authorEnrichment.metadataPreferences.limitedProviders', {
    providers: limited.map((provider) => provider.label).join(', '),
  })
})

onMounted(async () => {
  const [prefsRes, providersRes] = await Promise.all([api('/api/v1/authors/metadata/preferences'), api('/api/v1/authors/metadata/providers')])
  if (providersRes.ok) providers.value = await providersRes.json()
  if (prefsRes.ok) preferences.value = await prefsRes.json()
})

function fieldLabel(field: AuthorMetadataField) {
  return t(`settings.admin.authorEnrichment.fields.${field}`)
}

function preferenceFor(field: AuthorMetadataField): AuthorFieldPreference | null {
  return preferences.value?.fields[field] ?? null
}

function providersFor(field: AuthorMetadataField): MetadataProviderKey[] {
  return (preferenceFor(field)?.providers ?? []) as unknown as MetadataProviderKey[]
}

function update(field: AuthorMetadataField, patch: Partial<AuthorFieldPreference>) {
  const current = preferences.value
  if (!current) return
  preferences.value = {
    fields: { ...current.fields, [field]: { ...current.fields[field], ...patch } },
  }
}

function toggleField(field: AuthorMetadataField) {
  const current = preferenceFor(field)
  if (!current) return
  update(field, { enabled: !current.enabled })
}

function onMergeStrategyChange(field: AuthorMetadataField, mergeStrategy: AuthorFieldPreference['mergeStrategy']) {
  update(field, { mergeStrategy })
}

function onProvidersChange(field: AuthorMetadataField, next: MetadataProviderKey[]) {
  // The shared chip list is typed for book providers, so drop anything that is
  // not a registered author provider or cannot return this field.
  const filtered = (next as unknown as AuthorMetadataProviderKey[]).filter((key) => providerSupportsAuthorField(key, field))
  update(field, { providers: filtered })
}

async function save() {
  if (saving.value || !preferences.value) return
  saving.value = true
  try {
    const res = await api('/api/v1/authors/metadata/preferences', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(preferences.value),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    preferences.value = await res.json()
    toast.success(t('settings.admin.authorEnrichment.metadataPreferences.saved'))
  } catch {
    toast.error(t('settings.admin.authorEnrichment.metadataPreferences.saveFailed'))
  } finally {
    saving.value = false
  }
}

defineExpose({ save })
</script>

<template>
  <div v-if="preferences" class="flex flex-col">
    <div class="px-4 py-3.5 md:px-5 md:py-4 bg-card">
      <p class="settings-label">
        {{ t('settings.admin.authorEnrichment.metadataPreferences.title') }}
      </p>
      <p class="settings-hint">
        {{ t('settings.admin.authorEnrichment.metadataPreferences.hint') }}
        <span v-if="providersHint">{{ providersHint }}</span>
      </p>
    </div>

    <div
      v-for="field in fields"
      :key="field"
      class="px-4 py-2.5 md:px-5 md:py-3 flex flex-col gap-2 md:flex-row md:items-center md:gap-4 bg-card border-t border-border"
    >
      <div class="flex items-center gap-3 md:w-48 shrink-0">
        <button
          type="button"
          role="switch"
          :aria-checked="preferences.fields[field].enabled"
          :aria-label="fieldLabel(field)"
          :disabled="saving"
          class="relative flex h-4.5 w-8.5 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          :class="preferences.fields[field].enabled ? 'bg-primary' : 'bg-muted border border-border'"
          @click="toggleField(field)"
        >
          <span
            class="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform"
            :class="preferences.fields[field].enabled ? 'translate-x-4' : 'translate-x-0.5'"
          />
        </button>
        <span class="text-sm text-foreground">{{ fieldLabel(field) }}</span>
      </div>

      <div class="flex-1 min-w-0">
        <div v-if="isOrderable(field)" class="flex flex-wrap items-center gap-2">
          <ProviderChipList
            :providers="providersFor(field)"
            :statuses="statuses"
            :disabled="saving || !preferences.fields[field].enabled"
            @update:providers="(next: MetadataProviderKey[]) => onProvidersChange(field, next)"
          />
          <button
            v-for="provider in unassignedProviders(field)"
            :key="provider.key"
            type="button"
            :disabled="saving || !preferences.fields[field].enabled"
            :aria-label="t('settings.admin.authorEnrichment.metadataPreferences.addProvider', { provider: provider.label })"
            class="flex items-center gap-1 h-6 px-2 rounded border border-dashed border-border text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
            @click="addProvider(field, provider.key)"
          >
            <Plus :size="11" :stroke-width="3" />
            {{ provider.label }}
          </button>
        </div>
        <span v-else class="text-sm" :class="preferences.fields[field].enabled ? 'text-foreground' : 'text-muted-foreground'">
          {{ soleProviderLabel(field) }}
        </span>
      </div>

      <div class="md:w-48 shrink-0">
        <MergeStrategyPicker
          :model-value="preferences.fields[field].mergeStrategy"
          :disabled="saving || !preferences.fields[field].enabled"
          @update:model-value="(value: AuthorFieldPreference['mergeStrategy']) => onMergeStrategyChange(field, value)"
        />
      </div>
    </div>
  </div>
</template>
