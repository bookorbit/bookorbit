<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Plug, Plus } from '@lucide/vue'
import type { MetadataHttpProviderStatus, MetadataHttpProviderTestResult, MetadataHttpProviderView } from '@bookorbit/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { refreshMetadataProviderLabels } from '@/features/book/composables/useMetadataProviderLabels'
import ExternalProviderSheet from './ExternalProviderSheet.vue'
import ProviderBrandTile from './ProviderBrandTile.vue'
import { useExternalProviders, type ExternalProviderError } from '../composables/useExternalProviders'

/** Field rules and the built-in panel read provider statuses, which change with every edit here. */
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const { providers, loaded, fetchProviders, createProvider, updateProvider, removeProvider, testProvider, addToFieldRules } = useExternalProviders()

const sheetOpen = ref(false)
const editingId = ref<number | null>(null)
const busy = ref(false)
const testing = ref(false)
const testResult = ref<MetadataHttpProviderTestResult | null>(null)
const sheetError = ref<string | null>(null)
const sheetPrefill = ref<{ baseUrl: string; allowPrivateAddress: boolean } | null>(null)
const togglingIds = ref(new Set<number>())

const editing = computed(() => providers.value.find((provider) => provider.id === editingId.value) ?? null)
const enabledCount = computed(() => providers.value.filter((provider) => provider.enabled).length)

const ERROR_KEYS: Record<string, string> = {
  METADATA_PROVIDER_PRIVATE_ADDRESS: 'settings.metadata.externalProviders.errors.privateAddress',
  METADATA_PROVIDER_UNREACHABLE: 'settings.metadata.externalProviders.errors.unreachable',
  METADATA_PROVIDER_UNAUTHORIZED: 'settings.metadata.externalProviders.errors.unauthorized',
  METADATA_PROVIDER_INVALID_INFO: 'settings.metadata.externalProviders.errors.invalidInfo',
  METADATA_PROVIDER_INVALID_URL: 'settings.metadata.externalProviders.errors.invalidUrl',
  METADATA_PROVIDER_KEY_TAKEN: 'settings.metadata.externalProviders.errors.keyTaken',
  METADATA_PROVIDER_KEY_CHANGED: 'settings.metadata.externalProviders.errors.keyChanged',
  METADATA_PROVIDER_NOT_READY: 'settings.metadata.externalProviders.errors.notReady',
  METADATA_PROVIDER_AUTHORIZATION_UNREADABLE: 'settings.metadata.externalProviders.errors.authorizationUnreadable',
  REQUEST_ENCRYPTION_KEY_MISSING: 'settings.system.requests.errors.encryptionKeyMissing',
}

const STATUS_CLASSES: Record<'active' | 'ready' | 'warning', string> = {
  active: 'border-success/30 bg-success/10 text-success',
  ready: 'border-border text-muted-foreground',
  warning: 'border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400',
}

/** Translated copy for a code the panel knows, with the server's own words as the detail. */
function describeError(error: ExternalProviderError): string {
  const key = error.code ? ERROR_KEYS[error.code] : undefined
  const headline = key ? t(key) : t('settings.metadata.externalProviders.errors.generic')
  return error.message && !key ? `${headline} ${error.message}` : error.message && key ? `${headline} (${error.message})` : headline
}

function nameOf(provider: MetadataHttpProviderView): string {
  return provider.info?.name ?? provider.key
}

function hostOf(provider: MetadataHttpProviderView): string {
  try {
    return new URL(provider.baseUrl).host
  } catch {
    return provider.baseUrl
  }
}

function chipFor(provider: MetadataHttpProviderView): { label: string; tone: keyof typeof STATUS_CLASSES; title?: string } {
  if (provider.authorizationUnreadable) {
    return {
      label: t('settings.metadata.externalProviders.status.authorizationUnreadable'),
      tone: 'warning',
      title: t('settings.metadata.externalProviders.authorizationUnreadableHint'),
    }
  }
  const healthy: MetadataHttpProviderStatus[] = ['ok']
  if (!healthy.includes(provider.status)) {
    return {
      label: t(`settings.metadata.externalProviders.status.${provider.status}`),
      tone: 'warning',
      title: provider.lastError ?? undefined,
    }
  }
  return provider.enabled
    ? { label: t('settings.metadata.externalProviders.status.active'), tone: 'active' }
    : { label: t('settings.metadata.externalProviders.status.ready'), tone: 'ready' }
}

function openCreate(prefill: { baseUrl: string; allowPrivateAddress: boolean } | null = null) {
  editingId.value = null
  sheetPrefill.value = prefill
  testResult.value = null
  sheetError.value = null
  sheetOpen.value = true
}

function handleAddClick() {
  openCreate()
}

/** The tab offers ready-made providers below this list: it adds them through the same sheet. */
const registeredKeys = computed(() => providers.value.map((provider) => provider.key))
defineExpose({ openCreate, registeredKeys })

function openEdit(provider: MetadataHttpProviderView) {
  editingId.value = provider.id
  testResult.value = null
  sheetError.value = null
  sheetOpen.value = true
}

function closeSheet() {
  sheetOpen.value = false
}

async function handleSave(payload: Parameters<typeof createProvider>[0]) {
  busy.value = true
  sheetError.value = null
  try {
    const result = editing.value ? await updateProvider(editing.value.id, payload) : await createProvider(payload)
    if (!result.ok) {
      sheetError.value = describeError(result.error)
      return
    }
    if (!editing.value) {
      toast.success(t('settings.metadata.externalProviders.added', { name: nameOf(result.value) }))
      editingId.value = result.value.id
    } else {
      toast.success(t('settings.metadata.externalProviders.saved', { name: nameOf(result.value) }))
      sheetOpen.value = false
    }
    notifyChanged()
  } finally {
    busy.value = false
  }
}

async function handleRemove(purge: boolean) {
  const provider = editing.value
  if (!provider) return
  busy.value = true
  try {
    const result = await removeProvider(provider.id, purge)
    if (!result.ok) {
      sheetError.value = describeError(result.error)
      return
    }
    toast.success(t(purge ? 'settings.metadata.externalProviders.purged' : 'settings.metadata.externalProviders.removed', { name: nameOf(provider) }))
    sheetOpen.value = false
    notifyChanged()
  } finally {
    busy.value = false
  }
}

function handleRemoveOnly() {
  void handleRemove(false)
}

function handlePurge() {
  void handleRemove(true)
}

async function handleTest() {
  const provider = editing.value
  if (!provider) return
  testing.value = true
  try {
    const result = await testProvider(provider.id)
    testResult.value = result.ok
      ? result.value
      : { ok: false, name: null, version: null, latencyMs: 0, resultCount: null, sampleTitle: null, error: describeError(result.error) }
    notifyChanged()
  } finally {
    testing.value = false
  }
}

async function handleToggle(provider: MetadataHttpProviderView, enabled: boolean) {
  togglingIds.value = new Set([...togglingIds.value, provider.id])
  try {
    const result = await updateProvider(provider.id, { enabled })
    if (!result.ok) {
      toast.error(describeError(result.error))
      return
    }
    notifyChanged()
  } finally {
    const next = new Set(togglingIds.value)
    next.delete(provider.id)
    togglingIds.value = next
  }
}

async function handleAddToFieldRules(provider: MetadataHttpProviderView) {
  const result = await addToFieldRules(provider)
  if (!result.ok) {
    toast.error(describeError(result.error))
    return
  }
  toast.success(t('settings.metadata.externalProviders.fieldRulesAdded', { name: nameOf(provider), count: result.value }))
  notifyChanged()
}

/** Field rules, the built-in panel and every provider name shown elsewhere read what changed here. */
function notifyChanged() {
  emit('changed')
  void refreshMetadataProviderLabels()
}

onMounted(() => {
  void fetchProviders()
})
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-border bg-card shadow-xs" aria-labelledby="external-providers-title">
    <div class="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-2 md:px-5">
      <Plug :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      <h3 id="external-providers-title" class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {{ t('settings.metadata.externalProviders.yourProviders') }}
      </h3>
      <span v-if="providers.length" class="text-[11px] font-semibold tabular-nums text-muted-foreground">
        {{ t('settings.metadata.providers.groupEnabled', { enabled: enabledCount, total: providers.length }) }}
      </span>
      <Button type="button" size="sm" variant="outline" class="ms-auto h-7 gap-1.5 px-2 text-[11px]" @click="handleAddClick">
        <Plus :size="12" aria-hidden="true" />
        {{ t('settings.metadata.externalProviders.add') }}
      </Button>
    </div>

    <p v-if="loaded && providers.length === 0" class="px-4 py-6 text-center text-xs text-muted-foreground md:px-5">
      {{ t('settings.metadata.externalProviders.emptyWithDirectory') }}
    </p>

    <ul v-else>
      <li
        v-for="(provider, index) in providers"
        :key="provider.id"
        class="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3 md:flex-nowrap md:px-5"
        :class="{ 'border-t border-border': index > 0 }"
      >
        <ProviderBrandTile :provider-key="provider.key" :label="nameOf(provider)" :enabled="provider.enabled" />
        <button
          type="button"
          class="min-w-0 flex-1 rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('settings.metadata.externalProviders.edit', { name: nameOf(provider) })"
          @click="openEdit(provider)"
        >
          <span class="settings-label block truncate">{{ nameOf(provider) }}</span>
          <span class="settings-hint block truncate">
            {{ t('settings.metadata.externalProviders.row', { host: hostOf(provider), version: provider.info?.version ?? '-' }) }}
          </span>
        </button>
        <!-- Below md the controls take their own line, so a long provider name keeps its width. -->
        <div class="flex w-full items-center gap-2 ps-[2.875rem] md:w-auto md:shrink-0 md:ps-0">
          <Badge
            variant="outline"
            class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wide"
            :class="STATUS_CLASSES[chipFor(provider).tone]"
            :title="chipFor(provider).title"
          >
            {{ chipFor(provider).label }}
          </Badge>
          <Button
            v-if="provider.enabled"
            type="button"
            size="sm"
            variant="outline"
            class="h-7 px-2 text-[11px]"
            @click="handleAddToFieldRules(provider)"
          >
            {{ t('settings.metadata.externalProviders.useInFieldRules') }}
          </Button>
          <ToggleSwitch
            class="ms-auto md:ms-0"
            :model-value="provider.enabled"
            :disabled="togglingIds.has(provider.id)"
            :aria-label="t('settings.metadata.externalProviders.toggle', { name: nameOf(provider) })"
            @update:model-value="handleToggle(provider, $event)"
          />
        </div>
      </li>
    </ul>

    <ExternalProviderSheet
      :open="sheetOpen"
      :provider="editing"
      :busy="busy"
      :testing="testing"
      :test-result="testResult"
      :error="sheetError"
      :prefill="sheetPrefill"
      @save="handleSave"
      @cancel="closeSheet"
      @remove="handleRemoveOnly"
      @purge="handlePurge"
      @test="handleTest"
    />
  </section>
</template>
