<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'

interface OidcConfig {
  enabled: boolean
  providerName: string
  issuerUri: string
  clientId: string
  clientSecret: string
  scopes: string
  claimMapping: { username: string; name: string; email: string; groups: string }
  autoProvision: { enabled: boolean; allowLocalLinking: boolean; defaultPermissionNames: string[] }
}

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const saveError = ref<string | null>(null)
const testResult = ref<{ success: boolean; message: string } | null>(null)

const form = reactive<OidcConfig>({
  enabled: false,
  providerName: '',
  issuerUri: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid profile email',
  claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
  autoProvision: { enabled: false, allowLocalLinking: true, defaultPermissionNames: [] },
})

onMounted(async () => {
  try {
    const res = await api('/api/v1/app-settings/oidc')
    if (res.ok) {
      const data = await res.json()
      Object.assign(form, data)
      form.clientSecret = ''
    }
  } finally {
    loading.value = false
  }
})

async function save() {
  saveError.value = null
  saving.value = true
  try {
    const body: Partial<OidcConfig> = { ...form }
    if (!body.clientSecret) delete body.clientSecret

    const res = await api('/api/v1/app-settings/oidc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(((err as Record<string, unknown>).message as string) ?? 'Failed to save')
    }
    toast.success('OIDC settings saved')
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Failed to save settings'
    toast.error(saveError.value)
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testResult.value = null
  testing.value = true
  try {
    const res = await api(`/api/v1/app-settings/oidc/test?issuerUri=${encodeURIComponent(form.issuerUri)}`, { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      testResult.value = { success: true, message: `Connected - issuer: ${data.issuer}` }
    } else {
      testResult.value = { success: false, message: data.error ?? 'Connection failed' }
    }
  } catch {
    testResult.value = { success: false, message: 'Request failed' }
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <SettingsPageHeader class="hidden md:flex" title="OIDC / SSO" subtitle="Configure an OpenID Connect provider for single sign-on." />
  <div class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">OIDC / SSO</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      Configure an OpenID Connect provider for single sign-on.
    </p>
  </div>

  <div v-if="loading" class="mt-5 md:mt-0 text-sm text-muted-foreground">Loading...</div>

  <form v-else class="mt-5 md:mt-0 space-y-6" @submit.prevent="save">
    <!-- Enable -->
    <div>
      <p class="settings-group-label">Status</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">Enable OIDC</p>
            <p class="settings-hint">Show SSO login button and allow OIDC authentication.</p>
          </div>
          <ToggleSwitch v-model="form.enabled" class="self-start md:self-auto" />
        </div>
      </div>
    </div>

    <!-- Provider -->
    <div>
      <p class="settings-group-label">Provider</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
          <div class="min-w-0 md:shrink-0">
            <p class="settings-label">Provider Name</p>
            <p class="settings-hint">Shown on the login button.</p>
          </div>
          <input v-model="form.providerName" type="text" placeholder="Authentik" class="input-field w-full md:w-72" />
        </div>
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-start md:justify-between md:gap-8 md:px-5 md:py-4">
          <div class="min-w-0 md:shrink-0 md:pt-0.5">
            <p class="settings-label">Issuer URI</p>
            <p class="settings-hint">The provider's base URL.</p>
          </div>
          <div class="flex w-full flex-col items-start gap-2 md:w-auto md:items-end">
            <div class="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
              <input v-model="form.issuerUri" type="url" placeholder="https://accounts.example.com" class="input-field w-full md:w-80" />
              <button
                type="button"
                :disabled="testing || !form.issuerUri"
                class="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-primary/50 md:w-auto md:py-1.5"
                @click="testConnection"
              >
                {{ testing ? 'Testing...' : 'Test' }}
              </button>
            </div>
            <div
              v-if="testResult"
              class="w-full text-xs px-3 py-1.5 rounded-md border md:w-auto"
              :class="
                testResult.success ? 'border-green-500/30 text-green-600 bg-green-500/5' : 'border-destructive/30 text-destructive bg-destructive/5'
              "
            >
              {{ testResult.message }}
            </div>
          </div>
        </div>
        <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
          <p class="settings-label md:shrink-0">Client ID</p>
          <input v-model="form.clientId" type="text" class="input-field w-full md:w-72" />
        </div>
        <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
          <p class="settings-label md:shrink-0">Client Secret</p>
          <input
            v-model="form.clientSecret"
            type="password"
            placeholder="Leave blank to keep existing"
            autocomplete="new-password"
            class="input-field w-full md:w-72"
          />
        </div>
        <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
          <p class="settings-label md:shrink-0">Scopes</p>
          <input v-model="form.scopes" type="text" class="input-field w-full md:w-72" />
        </div>
      </div>
    </div>

    <!-- Claim mapping -->
    <div>
      <p class="settings-group-label">Claim Mapping</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
          <p class="settings-label md:shrink-0">Username claim</p>
          <input v-model="form.claimMapping.username" type="text" class="input-field w-full md:w-72" />
        </div>
        <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
          <p class="settings-label md:shrink-0">Name claim</p>
          <input v-model="form.claimMapping.name" type="text" class="input-field w-full md:w-72" />
        </div>
        <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
          <p class="settings-label md:shrink-0">Email claim</p>
          <input v-model="form.claimMapping.email" type="text" class="input-field w-full md:w-72" />
        </div>
        <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
          <p class="settings-label md:shrink-0">Groups claim</p>
          <input v-model="form.claimMapping.groups" type="text" class="input-field w-full md:w-72" />
        </div>
      </div>
    </div>

    <!-- Auto-provisioning -->
    <div>
      <p class="settings-group-label">Auto-Provisioning</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">Auto-provision users</p>
            <p class="settings-hint">Create accounts on first OIDC login if user does not exist.</p>
          </div>
          <ToggleSwitch v-model="form.autoProvision.enabled" class="self-start md:self-auto" />
        </div>
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">Allow local account linking</p>
            <p class="settings-hint">Link OIDC identity to an existing local account by username match.</p>
          </div>
          <ToggleSwitch v-model="form.autoProvision.allowLocalLinking" class="self-start md:self-auto" />
        </div>
      </div>
    </div>

    <!-- Save -->
    <div class="hidden md:flex items-center gap-3">
      <button type="submit" :disabled="saving" class="settings-btn-primary">
        {{ saving ? 'Saving...' : 'Save changes' }}
      </button>
      <p v-if="saveError" class="text-sm text-destructive">{{ saveError }}</p>
    </div>
    <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
      <div class="flex items-center gap-2">
        <button type="submit" :disabled="saving" class="settings-btn-primary w-full min-h-10 justify-center">
          {{ saving ? 'Saving...' : 'Save changes' }}
        </button>
      </div>
      <p v-if="saveError" class="mt-1.5 text-xs text-destructive line-clamp-2">{{ saveError }}</p>
    </div>
  </form>
</template>
