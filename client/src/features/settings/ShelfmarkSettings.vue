<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { CloudDownload, HelpCircle, CheckCircle, XCircle, Loader } from 'lucide-vue-next'
import { Permission } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { setShelfmarkEnabled } from '@/features/book/composables/useGlobalSearch'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { api } from '@/lib/api'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const canTestConnection = hasPermission(Permission.ManageAppSettings)
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })
const enabled = ref(false)
const url = ref('')
const externalUrl = ref('')
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const testResult = ref<'success' | 'error' | null>(null)

function handleUpdateEnabled(val: boolean) {
  enabled.value = val
}

function handleInputUrl() {
  testResult.value = null
}

onMounted(async () => {
  try {
    const res = await api('/api/v1/user-preferences/shelfmark')
    if (res.ok) {
      const data = await res.json()
      enabled.value = data.settings?.enabled ?? false
      url.value = data.settings?.url ?? ''
      externalUrl.value = data.settings?.externalUrl ?? ''
    } else {
      toast.error(t('settings.shelfmark.toasts.loadFailed'))
    }
  } catch {
    toast.error(t('settings.shelfmark.toasts.loadFailed'))
  } finally {
    loading.value = false
  }
})

async function testConnection() {
  const trimmedUrl = url.value.trim()
  if (!trimmedUrl) {
    toast.error(t('settings.shelfmark.toasts.urlRequired'))
    return
  }
  testing.value = true
  testResult.value = null
  try {
    const res = await api('/api/v1/user-preferences/shelfmark/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trimmedUrl }),
    })
    const data = await res.json()
    testResult.value = data.ok ? 'success' : 'error'
    if (data.ok) {
      toast.success(t('settings.shelfmark.toasts.connectionSuccessful'))
    } else {
      toast.error(
        data.status
          ? t('settings.shelfmark.toasts.connectionFailedStatus', { status: data.status })
          : t('settings.shelfmark.toasts.connectionFailed'),
      )
    }
  } catch {
    testResult.value = 'error'
    toast.error(t('settings.shelfmark.toasts.connectionFailed'))
  } finally {
    testing.value = false
  }
}

async function saveSettings() {
  saving.value = true
  try {
    const res = await api('/api/v1/user-preferences/shelfmark', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          enabled: enabled.value,
          url: url.value.trim(),
          externalUrl: externalUrl.value.trim() || undefined,
        },
      }),
    })
    if (res.ok) {
      setShelfmarkEnabled(enabled.value)
      toast.success(t('settings.shelfmark.toasts.saved'))
    } else {
      toast.error(t('settings.shelfmark.toasts.saveFailed'))
    }
  } catch {
    toast.error(t('settings.shelfmark.toasts.saveFailed'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SettingsPageHeader
    v-if="!props.embedded"
    class="hidden md:flex"
    :title="t('settings.shelfmark.title')"
    :subtitle="t('settings.shelfmark.subtitle')"
  />
  <div v-if="!props.embedded" class="md:hidden px-1 mb-6">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.shelfmark.title') }}</h1>
    <p class="mt-1 text-sm text-muted-foreground leading-5">{{ t('settings.shelfmark.subtitle') }}</p>
  </div>

  <div v-if="loading" class="text-sm text-muted-foreground" :class="{ 'mt-5 md:mt-0': !props.embedded }" role="status">{{ t('common.loading') }}</div>
  <template v-else>
    <div class="space-y-6">
      <div class="border border-border rounded-lg overflow-hidden shadow-xs">
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">{{ t('settings.shelfmark.enableLabel') }}</p>
            <p class="settings-hint">{{ t('settings.shelfmark.enableHint') }}</p>
          </div>
          <ToggleSwitch :model-value="enabled" :aria-label="t('settings.shelfmark.enableLabel')" @update:model-value="handleUpdateEnabled" />
        </div>
      </div>

      <div v-if="enabled" class="border border-border rounded-lg p-4 md:p-5 bg-card space-y-5 shadow-xs">
        <div>
          <label for="shelfmark-url" class="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {{ t('settings.shelfmark.urlLabel') }}
          </label>
          <div class="flex gap-2">
            <input
              id="shelfmark-url"
              v-model="url"
              type="url"
              :placeholder="t('settings.shelfmark.urlPlaceholder')"
              class="input-field w-full"
              @input="handleInputUrl"
            />
            <button
              v-if="canTestConnection"
              type="button"
              class="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors disabled:opacity-50"
              :disabled="testing || !url.trim()"
              @click="testConnection"
            >
              <Loader v-if="testing" :size="13" class="animate-spin" />
              <CheckCircle v-else-if="testResult === 'success'" :size="13" class="text-primary" />
              <XCircle v-else-if="testResult === 'error'" :size="13" class="text-destructive" />
              <CloudDownload v-else :size="13" />
              {{ testing ? t('settings.shelfmark.testing') : t('settings.shelfmark.testConnection') }}
            </button>
          </div>
          <p class="mt-1.5 text-xs text-muted-foreground">
            {{ t('settings.shelfmark.urlHint') }}
          </p>
        </div>

        <div>
          <label for="shelfmark-external-url" class="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {{ t('settings.shelfmark.externalUrlLabel') }}
            <span class="ml-1.5 normal-case font-normal text-muted-foreground">{{ t('settings.shelfmark.optional') }}</span>
          </label>
          <input
            id="shelfmark-external-url"
            v-model="externalUrl"
            type="url"
            :placeholder="t('settings.shelfmark.externalUrlPlaceholder')"
            class="input-field w-full"
          />
          <p class="mt-1.5 text-xs text-muted-foreground">
            {{ t('settings.shelfmark.externalUrlHint') }}
          </p>
        </div>

        <div class="border border-border bg-muted rounded-lg p-3 flex gap-2.5 items-start">
          <HelpCircle :size="16" class="text-primary shrink-0 mt-0.5" />
          <p class="text-xs text-muted-foreground leading-normal">
            <strong>{{ t('settings.shelfmark.directoryNoteTitle') }}</strong> {{ t('settings.shelfmark.directoryNote') }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-3 pt-2">
        <button
          class="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          :disabled="saving"
          @click="saveSettings"
        >
          {{ saving ? t('settings.shelfmark.saving') : t('settings.shelfmark.save') }}
        </button>
      </div>
    </div>
  </template>
</template>
