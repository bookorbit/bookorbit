<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api } from '@/lib/api'

interface OidcConfig {
  enabled: boolean
  providerName: string
  issuerUri: string
  clientId: string
  clientSecret: string
  scopes: string
  claimMapping: { username: string; name: string; email: string; groups: string }
  autoProvision: { enabled: boolean; allowLocalLinking: boolean; defaultRoleId: number | null }
}

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const saveError = ref<string | null>(null)
const saveSuccess = ref(false)
const testResult = ref<{ success: boolean; message: string } | null>(null)

const form = reactive<OidcConfig>({
  enabled: false,
  providerName: '',
  issuerUri: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid profile email',
  claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
  autoProvision: { enabled: false, allowLocalLinking: true, defaultRoleId: null },
})

onMounted(async () => {
  try {
    const res = await api('/api/app-settings/oidc')
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
  saveSuccess.value = false
  saving.value = true
  try {
    const body: Partial<OidcConfig> = { ...form }
    if (!body.clientSecret) delete body.clientSecret

    const res = await api('/api/app-settings/oidc', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error((err as any).message ?? 'Failed to save')
    }
    saveSuccess.value = true
    setTimeout(() => { saveSuccess.value = false }, 3000)
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : 'Failed to save settings'
  } finally {
    saving.value = false
  }
}

async function testConnection() {
  testResult.value = null
  testing.value = true
  try {
    const res = await api(`/api/app-settings/oidc/test?issuerUri=${encodeURIComponent(form.issuerUri)}`, { method: 'POST' })
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
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl mx-auto">

    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">OIDC / SSO</h2>
      <p class="mt-1 text-sm text-muted-foreground">Configure an OpenID Connect provider for single sign-on.</p>
    </div>

    <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>

    <form v-else class="space-y-6" @submit.prevent="save">

      <!-- Enable -->
      <div>
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Status</p>
        <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
          <div class="flex items-center justify-between px-5 py-4 bg-card">
            <div>
              <p class="text-sm font-medium text-foreground">Enable OIDC</p>
              <p class="text-xs text-muted-foreground mt-0.5">Show SSO login button and allow OIDC authentication.</p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="form.enabled"
              class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
              :class="form.enabled ? 'bg-primary' : 'bg-input'"
              @click="form.enabled = !form.enabled"
            >
              <span class="inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform" :class="form.enabled ? 'translate-x-4' : 'translate-x-0.5'" />
            </button>
          </div>
        </div>
      </div>

      <!-- Provider -->
      <div>
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Provider</p>
        <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
          <div class="flex items-center justify-between gap-8 px-5 py-4 bg-card">
            <div class="shrink-0">
              <p class="text-sm font-medium text-foreground">Provider Name</p>
              <p class="text-xs text-muted-foreground mt-0.5">Shown on the login button.</p>
            </div>
            <input v-model="form.providerName" type="text" placeholder="Authentik"
              class="w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div class="flex items-start justify-between gap-8 px-5 py-4 bg-card">
            <div class="shrink-0 pt-0.5">
              <p class="text-sm font-medium text-foreground">Issuer URI</p>
              <p class="text-xs text-muted-foreground mt-0.5">The provider's base URL.</p>
            </div>
            <div class="flex flex-col items-end gap-2">
              <div class="flex items-center gap-2">
                <input v-model="form.issuerUri" type="url" placeholder="https://accounts.example.com"
                  class="w-64 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                <button type="button" :disabled="testing || !form.issuerUri"
                  class="rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors shrink-0"
                  @click="testConnection">
                  {{ testing ? 'Testing...' : 'Test' }}
                </button>
              </div>
              <div v-if="testResult" class="text-xs px-3 py-1.5 rounded-md border"
                :class="testResult.success ? 'border-green-500/30 text-green-600 bg-green-500/5' : 'border-destructive/30 text-destructive bg-destructive/5'">
                {{ testResult.message }}
              </div>
            </div>
          </div>
          <div class="flex items-center justify-between gap-8 px-5 py-4 bg-card">
            <p class="text-sm font-medium text-foreground shrink-0">Client ID</p>
            <input v-model="form.clientId" type="text"
              class="w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div class="flex items-center justify-between gap-8 px-5 py-4 bg-card">
            <p class="text-sm font-medium text-foreground shrink-0">Client Secret</p>
            <input v-model="form.clientSecret" type="password" placeholder="Leave blank to keep existing" autocomplete="new-password"
              class="w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div class="flex items-center justify-between gap-8 px-5 py-4 bg-card">
            <p class="text-sm font-medium text-foreground shrink-0">Scopes</p>
            <input v-model="form.scopes" type="text"
              class="w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
        </div>
      </div>

      <!-- Claim mapping -->
      <div>
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Claim Mapping</p>
        <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
          <div class="flex items-center justify-between gap-8 px-5 py-4 bg-card">
            <p class="text-sm font-medium text-foreground shrink-0">Username claim</p>
            <input v-model="form.claimMapping.username" type="text"
              class="w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div class="flex items-center justify-between gap-8 px-5 py-4 bg-card">
            <p class="text-sm font-medium text-foreground shrink-0">Name claim</p>
            <input v-model="form.claimMapping.name" type="text"
              class="w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div class="flex items-center justify-between gap-8 px-5 py-4 bg-card">
            <p class="text-sm font-medium text-foreground shrink-0">Email claim</p>
            <input v-model="form.claimMapping.email" type="text"
              class="w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
          <div class="flex items-center justify-between gap-8 px-5 py-4 bg-card">
            <p class="text-sm font-medium text-foreground shrink-0">Groups claim</p>
            <input v-model="form.claimMapping.groups" type="text"
              class="w-52 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
          </div>
        </div>
      </div>

      <!-- Auto-provisioning -->
      <div>
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Auto-Provisioning</p>
        <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
          <div class="flex items-center justify-between px-5 py-4 bg-card">
            <div>
              <p class="text-sm font-medium text-foreground">Auto-provision users</p>
              <p class="text-xs text-muted-foreground mt-0.5">Create accounts on first OIDC login if user does not exist.</p>
            </div>
            <button type="button" role="switch" :aria-checked="form.autoProvision.enabled"
              class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
              :class="form.autoProvision.enabled ? 'bg-primary' : 'bg-input'"
              @click="form.autoProvision.enabled = !form.autoProvision.enabled">
              <span class="inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform" :class="form.autoProvision.enabled ? 'translate-x-4' : 'translate-x-0.5'" />
            </button>
          </div>
          <div class="flex items-center justify-between px-5 py-4 bg-card">
            <div>
              <p class="text-sm font-medium text-foreground">Allow local account linking</p>
              <p class="text-xs text-muted-foreground mt-0.5">Link OIDC identity to an existing local account by username match.</p>
            </div>
            <button type="button" role="switch" :aria-checked="form.autoProvision.allowLocalLinking"
              class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors"
              :class="form.autoProvision.allowLocalLinking ? 'bg-primary' : 'bg-input'"
              @click="form.autoProvision.allowLocalLinking = !form.autoProvision.allowLocalLinking">
              <span class="inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform" :class="form.autoProvision.allowLocalLinking ? 'translate-x-4' : 'translate-x-0.5'" />
            </button>
          </div>
        </div>
      </div>

      <!-- Save -->
      <div class="flex items-center gap-3">
        <button type="submit" :disabled="saving"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
          {{ saving ? 'Saving...' : 'Save changes' }}
        </button>
        <p v-if="saveSuccess" class="text-sm text-green-600">Saved.</p>
        <p v-if="saveError" class="text-sm text-destructive">{{ saveError }}</p>
      </div>

    </form>
  </div>
</template>
