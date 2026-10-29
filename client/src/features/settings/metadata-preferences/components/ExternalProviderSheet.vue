<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, ShieldAlert } from '@lucide/vue'
import { METADATA_HTTP_PROVIDER_TIMEOUT_MS } from '@bookorbit/types'
import type { CreateMetadataHttpProviderPayload, MetadataHttpProviderTestResult, MetadataHttpProviderView } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsEditorSheet from '@/features/settings/components/SettingsEditorSheet.vue'
import type { EditorMenuAction } from '@/features/settings/lib/editor-actions'
import { formatNumber } from '@/i18n/formatters'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'

const props = defineProps<{
  open: boolean
  /** Null while adding a provider. */
  provider: MetadataHttpProviderView | null
  busy: boolean
  testing: boolean
  testResult: MetadataHttpProviderTestResult | null
  /** Already translated by the panel. */
  error: string | null
  /** Starting values while adding, such as a ready-made provider's address. */
  prefill?: { baseUrl: string; allowPrivateAddress: boolean } | null
}>()

const emit = defineEmits<{
  save: [payload: CreateMetadataHttpProviderPayload & { authorization?: string | null }]
  cancel: []
  remove: []
  purge: []
  test: []
}>()

const { t } = useI18n()

const PURGE_ACTION = 'purge'

const baseUrl = ref('')
const authorization = ref('')
const clearAuthorization = ref(false)
const allowPrivateAddress = ref(false)
const timeoutSeconds = ref(METADATA_HTTP_PROVIDER_TIMEOUT_MS.default / 1000)

const isEdit = computed(() => props.provider !== null)
const name = computed(() => props.provider?.info?.name ?? props.provider?.key ?? '')
const title = computed(() => (isEdit.value ? name.value : t('settings.metadata.externalProviders.sheet.createTitle')))
const minSeconds = METADATA_HTTP_PROVIDER_TIMEOUT_MS.min / 1000
const maxSeconds = METADATA_HTTP_PROVIDER_TIMEOUT_MS.max / 1000

function reset() {
  const prefill = props.provider ? null : props.prefill
  baseUrl.value = props.provider?.baseUrl ?? prefill?.baseUrl ?? ''
  authorization.value = ''
  clearAuthorization.value = false
  allowPrivateAddress.value = props.provider?.allowPrivateAddress ?? prefill?.allowPrivateAddress ?? false
  timeoutSeconds.value = (props.provider?.timeoutMs ?? METADATA_HTTP_PROVIDER_TIMEOUT_MS.default) / 1000
}

watch(
  () => [props.open, props.provider?.id] as const,
  ([open]) => {
    if (open) reset()
  },
  { immediate: true },
)

const dirty = computed(() => {
  // A ready-made provider's address arrives filled in; only what the admin typed is theirs to lose.
  if (!isEdit.value) return baseUrl.value.trim() !== (props.prefill?.baseUrl ?? '') || authorization.value.trim().length > 0
  const provider = props.provider!
  return (
    baseUrl.value.trim() !== provider.baseUrl ||
    authorization.value.trim().length > 0 ||
    clearAuthorization.value ||
    allowPrivateAddress.value !== provider.allowPrivateAddress ||
    timeoutSeconds.value * 1000 !== provider.timeoutMs
  )
})

const timeoutValid = computed(
  () => Number.isInteger(timeoutSeconds.value) && timeoutSeconds.value >= minSeconds && timeoutSeconds.value <= maxSeconds,
)
const canSave = computed(() => baseUrl.value.trim().length > 0 && timeoutValid.value && !props.busy)

const menuActions = computed<EditorMenuAction[]>(() =>
  isEdit.value
    ? [
        {
          id: PURGE_ACTION,
          label: t('settings.metadata.externalProviders.sheet.purge'),
          danger: true,
          separated: true,
          confirm: t('settings.metadata.externalProviders.sheet.purgeConfirm', { name: name.value }),
          consequence: t('settings.metadata.externalProviders.sheet.purgeConsequence'),
        },
      ]
    : [],
)

const testLine = computed(() => {
  const result = props.testResult
  if (!result) return null
  if (!result.ok) return { ok: false, text: t('settings.metadata.externalProviders.test.failed', { error: result.error ?? '' }) }
  const answered = t('settings.metadata.externalProviders.test.ok', {
    name: result.name ?? name.value,
    latency: formatNumber(result.latencyMs),
    count: result.resultCount ?? 0,
  })
  return {
    ok: true,
    text: result.sampleTitle ? `${answered} ${t('settings.metadata.externalProviders.test.sample', { title: result.sampleTitle })}` : answered,
  }
})

function handleSave() {
  if (!canSave.value) return
  const payload: CreateMetadataHttpProviderPayload & { authorization?: string | null } = {
    baseUrl: baseUrl.value.trim(),
    allowPrivateAddress: allowPrivateAddress.value,
    timeoutMs: timeoutSeconds.value * 1000,
  }
  if (authorization.value.trim()) payload.authorization = authorization.value.trim()
  else if (clearAuthorization.value) payload.authorization = null
  emit('save', payload)
}

function handleCancel() {
  emit('cancel')
}

function handleRemove() {
  emit('remove')
}

function handleAction(id: string) {
  if (id === PURGE_ACTION) emit('purge')
}

function handleTest() {
  emit('test')
}

function handleClearAuthorization() {
  clearAuthorization.value = true
  authorization.value = ''
}
</script>

<template>
  <SettingsEditorSheet
    :open="open"
    :title="title"
    :description="t('settings.metadata.externalProviders.sheet.description')"
    :dirty="dirty"
    :busy="busy"
    :removable="isEdit"
    :remove-label="t('settings.metadata.externalProviders.sheet.remove')"
    :remove-confirm="t('settings.metadata.externalProviders.sheet.removeConfirm', { name })"
    :remove-consequence="t('settings.metadata.externalProviders.sheet.removeConsequence')"
    :menu-actions="menuActions"
    @save="handleSave"
    @cancel="handleCancel"
    @remove="handleRemove"
    @action="handleAction"
  >
    <template #status>
      <p v-if="provider?.info" class="text-xs text-muted-foreground">
        {{ t('settings.metadata.externalProviders.sheet.identity', { key: provider.key, version: provider.info.version ?? '-' }) }}
      </p>
    </template>

    <div class="space-y-5">
      <p v-if="error" role="alert" class="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {{ error }}
      </p>

      <label class="block space-y-1.5">
        <span class="settings-label">{{ t('settings.metadata.externalProviders.fields.baseUrl') }}</span>
        <input
          v-model="baseUrl"
          type="url"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          maxlength="2048"
          class="input-field w-full font-mono"
          placeholder="http://provider:8080"
          aria-describedby="external-provider-url-hint"
        />
        <span id="external-provider-url-hint" class="settings-hint block">{{ t('settings.metadata.externalProviders.fields.baseUrlHint') }}</span>
      </label>

      <div class="space-y-1.5">
        <label for="external-provider-authorization" class="settings-label">{{
          t('settings.metadata.externalProviders.fields.authorization')
        }}</label>
        <input
          id="external-provider-authorization"
          v-model="authorization"
          type="text"
          v-bind="SECRET_INPUT_ATTRS"
          maxlength="4096"
          class="input-field input-secret w-full font-mono"
          :placeholder="
            provider?.hasAuthorization && !clearAuthorization ? t('settings.metadata.externalProviders.fields.authorizationSaved') : 'Bearer ...'
          "
          aria-describedby="external-provider-authorization-hint"
        />
        <span id="external-provider-authorization-hint" class="settings-hint block">{{
          t('settings.metadata.externalProviders.fields.authorizationHint')
        }}</span>
        <button
          v-if="provider?.hasAuthorization && !clearAuthorization"
          type="button"
          class="text-xs font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          @click="handleClearAuthorization"
        >
          {{ t('settings.metadata.externalProviders.fields.clearAuthorization') }}
        </button>
      </div>

      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <span id="external-provider-private-label" class="settings-label">{{ t('settings.metadata.externalProviders.fields.allowPrivate') }}</span>
          <p class="settings-hint">{{ t('settings.metadata.externalProviders.fields.allowPrivateHint') }}</p>
        </div>
        <ToggleSwitch v-model="allowPrivateAddress" aria-labelledby="external-provider-private-label" />
      </div>

      <label class="block space-y-1.5">
        <span class="settings-label block">{{ t('settings.metadata.externalProviders.fields.timeout') }}</span>
        <input
          v-model.number="timeoutSeconds"
          type="number"
          :min="minSeconds"
          :max="maxSeconds"
          step="1"
          class="input-field w-28 tabular-nums"
          :aria-invalid="!timeoutValid"
        />
        <span class="settings-hint block">{{
          t('settings.metadata.externalProviders.fields.timeoutHint', { min: minSeconds, max: maxSeconds })
        }}</span>
      </label>

      <p class="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <ShieldAlert :size="14" class="mt-px shrink-0" aria-hidden="true" />
        <span>{{ t('settings.metadata.externalProviders.fields.privacy') }}</span>
      </p>

      <p
        v-if="testLine"
        role="status"
        class="rounded-md border px-3 py-2 text-xs"
        :class="testLine.ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'"
      >
        {{ testLine.text }}
      </p>
    </div>

    <template #actions>
      <Button v-if="isEdit" size="sm" variant="outline" type="button" :disabled="testing || busy" @click="handleTest">
        <Loader2 v-if="testing" class="animate-spin" aria-hidden="true" />
        {{ testing ? t('settings.metadata.externalProviders.sheet.testing') : t('settings.metadata.externalProviders.sheet.test') }}
      </Button>
    </template>
  </SettingsEditorSheet>
</template>
