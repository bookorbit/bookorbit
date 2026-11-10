<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { API_KEY_EXPIRY_PRESETS, type ApiKeySettings } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { apiJson, errorMessage, jsonBody } from '@/lib/api-json'

const { t } = useI18n()

const settings = ref<ApiKeySettings | null>(null)
const loading = ref(true)
const saving = ref(false)
const error = ref<string | null>(null)
const status = ref('')

const NO_LIMIT = 'none'

/** The presets, plus a cap set some other way (through the API) so the select can still show it. */
const lifetimeOptions = computed(() => {
  const presets = API_KEY_EXPIRY_PRESETS.filter((days): days is number => days !== null)
  const current = settings.value?.maxLifetimeDays
  const days = current && !presets.includes(current) ? [...presets, current].sort((a, b) => a - b) : presets
  return [
    { value: NO_LIMIT, label: t('apiKeys.server.noLimit') },
    ...days.map((value) => ({ value: String(value), label: t('apiKeys.expiry.days', { count: value }) })),
  ]
})

const lifetimeValue = computed(() => (settings.value?.maxLifetimeDays ? String(settings.value.maxLifetimeDays) : NO_LIMIT))

async function save(next: ApiKeySettings) {
  const previous = settings.value
  settings.value = next
  saving.value = true
  error.value = null
  try {
    settings.value = await apiJson<ApiKeySettings>('/api/v1/app-settings/api-keys', jsonBody('PUT', next), 'apiKeys.errors.saveSettings')
    status.value = t('apiKeys.server.saved')
  } catch (reason) {
    settings.value = previous
    error.value = errorMessage(reason, 'apiKeys.errors.saveSettings')
  } finally {
    saving.value = false
  }
}

function handleEnabledChange(enabled: boolean) {
  if (!settings.value || saving.value) return
  void save({ ...settings.value, enabled })
}

function handleLifetimeChange(event: Event) {
  if (!settings.value || saving.value) return
  const value = (event.target as HTMLSelectElement).value
  void save({ ...settings.value, maxLifetimeDays: value === NO_LIMIT ? null : Number(value) })
}

onMounted(async () => {
  try {
    settings.value = await apiJson<ApiKeySettings>('/api/v1/app-settings/api-keys', undefined, 'apiKeys.errors.load')
  } catch (reason) {
    error.value = errorMessage(reason, 'apiKeys.errors.load')
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="space-y-4">
    <p role="status" aria-live="polite" class="sr-only">{{ status }}</p>
    <p v-if="error" role="alert" class="settings-error-state">{{ error }}</p>
    <p v-if="loading" role="status" class="settings-loading-state">{{ t('common.loading') }}</p>

    <div v-else-if="settings" class="settings-card">
      <div class="settings-row">
        <div class="min-w-0">
          <p id="api-keys-enabled-label" class="settings-label">{{ t('apiKeys.server.enabled') }}</p>
          <p id="api-keys-enabled-hint" class="settings-hint settings-prose">{{ t('apiKeys.server.enabledHint') }}</p>
        </div>
        <ToggleSwitch
          :model-value="settings.enabled"
          :disabled="saving"
          aria-labelledby="api-keys-enabled-label"
          aria-describedby="api-keys-enabled-hint"
          class="self-start md:self-auto"
          @update:model-value="handleEnabledChange"
        />
      </div>
      <div class="settings-row">
        <div class="min-w-0">
          <label for="api-keys-max-lifetime" class="settings-label">{{ t('apiKeys.server.maxLifetime') }}</label>
          <p id="api-keys-max-lifetime-hint" class="settings-hint settings-prose">{{ t('apiKeys.server.maxLifetimeHint') }}</p>
        </div>
        <select
          id="api-keys-max-lifetime"
          :value="lifetimeValue"
          :disabled="saving"
          aria-describedby="api-keys-max-lifetime-hint"
          class="select-field w-full md:w-48"
          @change="handleLifetimeChange"
        >
          <option v-for="option in lifetimeOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </div>
    </div>

    <p v-if="settings" class="settings-hint settings-prose">{{ t('apiKeys.server.perUserHint') }}</p>
  </div>
</template>
