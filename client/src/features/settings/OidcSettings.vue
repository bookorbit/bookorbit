<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { api } from '@/lib/api'
import { toast } from 'vue-sonner'
import { Permission, PERMISSION_LABELS } from '@projectx/types'
import { Trash2 } from 'lucide-vue-next'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'

interface OidcConfig {
  enabled: boolean
  providerName: string
  issuerUri: string
  clientId: string
  clientSecret: string
  scopes: string
  iconUrl?: string
  claimMapping: { username: string; name: string; email: string; groups: string }
  autoProvision: { enabled: boolean; allowLocalLinking: boolean; defaultPermissionNames: string[] }
}

interface OidcTestResult {
  success: boolean
  issuer?: string
  authorizationEndpoint?: string
  tokenEndpoint?: string
  userinfoEndpoint?: string
  jwksUri?: string
  supportedScopes?: string[]
  codeChallengeMethodsSupported?: string[]
  backchannelLogoutSupported?: boolean
  error?: string
}

interface GroupMapping {
  id: number
  oidcGroupClaim: string
  permissionName: string | null
  createdAt: string
}

const ALL_PERMISSIONS = Object.values(Permission)

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const saveError = ref<string | null>(null)
const testResult = ref<OidcTestResult | null>(null)
const showTestDetails = ref(false)
const previewing = ref(false)
const previewClaims = ref<{ raw: Record<string, unknown>; mapped: Record<string, unknown> } | null>(null)

const groupMappings = ref<GroupMapping[]>([])
const newMapping = reactive({ oidcGroupClaim: '', permissionName: ALL_PERMISSIONS[0] })
const addingMapping = ref(false)

const form = reactive<OidcConfig>({
  enabled: false,
  providerName: '',
  issuerUri: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid profile email',
  iconUrl: '',
  claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
  autoProvision: { enabled: false, allowLocalLinking: true, defaultPermissionNames: [] },
})

const defaultPermissionSet = computed(() => new Set(form.autoProvision.defaultPermissionNames))

onMounted(async () => {
  const stored = sessionStorage.getItem('oidc_preview_claims')
  if (stored) {
    try {
      previewClaims.value = JSON.parse(stored)
    } catch {
      // ignore
    }
    sessionStorage.removeItem('oidc_preview_claims')
  }

  try {
    const [configRes, mappingsRes] = await Promise.all([api('/api/v1/app-settings/oidc'), api('/api/v1/app-settings/oidc/group-mappings')])
    if (configRes.ok) {
      const data = await configRes.json()
      Object.assign(form, data)
      form.clientSecret = ''
    }
    if (mappingsRes.ok) {
      groupMappings.value = await mappingsRes.json()
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
  showTestDetails.value = false
  testing.value = true
  try {
    const res = await api(`/api/v1/app-settings/oidc/test?issuerUri=${encodeURIComponent(form.issuerUri)}`, { method: 'POST' })
    const data: OidcTestResult = await res.json()
    testResult.value = data
  } catch {
    testResult.value = { success: false, error: 'Request failed' }
  } finally {
    testing.value = false
  }
}

async function previewOidcClaims() {
  previewing.value = true
  previewClaims.value = null
  try {
    const stateRes = await api('/api/auth/oidc/preview-state', { method: 'POST' })
    if (!stateRes.ok) throw new Error('Failed to generate preview state')
    const { state, authorizationEndpoint } = await stateRes.json()

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: form.clientId,
      redirect_uri: `${window.location.origin}/oauth2-callback`,
      scope: form.scopes,
      state,
      nonce: crypto.randomUUID(),
    })
    sessionStorage.setItem('oidc_preview_pending', '1')
    window.location.href = `${authorizationEndpoint}?${params.toString()}`
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to start preview')
    previewing.value = false
  }
}

function toggleTestDetails() {
  showTestDetails.value = !showTestDetails.value
}

function toggleDefaultPermission(permission: Permission) {
  const idx = form.autoProvision.defaultPermissionNames.indexOf(permission)
  if (idx === -1) {
    form.autoProvision.defaultPermissionNames.push(permission)
  } else {
    form.autoProvision.defaultPermissionNames.splice(idx, 1)
  }
}

async function addGroupMapping() {
  if (!newMapping.oidcGroupClaim.trim()) return
  addingMapping.value = true
  try {
    const res = await api('/api/v1/app-settings/oidc/group-mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oidcGroupClaim: newMapping.oidcGroupClaim.trim(), permissionName: newMapping.permissionName }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(((err as Record<string, unknown>).message as string) ?? 'Failed to add mapping')
    }
    const created: GroupMapping = await res.json()
    groupMappings.value.push(created)
    newMapping.oidcGroupClaim = ''
    toast.success('Group mapping added')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to add mapping')
  } finally {
    addingMapping.value = false
  }
}

async function deleteGroupMapping(id: number) {
  try {
    const res = await api(`/api/v1/app-settings/oidc/group-mappings/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to delete')
    groupMappings.value = groupMappings.value.filter((m) => m.id !== id)
    toast.success('Group mapping removed')
  } catch {
    toast.error('Failed to remove group mapping')
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
        <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
          <div class="min-w-0 md:shrink-0">
            <p class="settings-label">Icon URL</p>
            <p class="settings-hint">Optional logo shown next to the login button.</p>
          </div>
          <div class="flex w-full items-center gap-2 md:w-72">
            <img v-if="form.iconUrl" :src="form.iconUrl" alt="icon preview" class="h-5 w-5 shrink-0 rounded object-contain" />
            <input v-model="form.iconUrl" type="url" placeholder="https://example.com/logo.svg" class="input-field min-w-0 flex-1" />
          </div>
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
              class="w-full rounded-md border px-3 py-2 text-xs md:w-auto"
              :class="
                testResult.success ? 'border-green-500/30 text-green-600 bg-green-500/5' : 'border-destructive/30 text-destructive bg-destructive/5'
              "
            >
              <div class="flex items-center justify-between gap-2">
                <span>{{ testResult.success ? `Connected - ${testResult.issuer ?? ''}` : (testResult.error ?? 'Connection failed') }}</span>
                <button
                  v-if="testResult.success"
                  type="button"
                  class="shrink-0 underline underline-offset-2 opacity-70 hover:opacity-100"
                  @click="toggleTestDetails"
                >
                  {{ showTestDetails ? 'Hide' : 'Details' }}
                </button>
              </div>
              <div v-if="testResult.success && showTestDetails" class="mt-2 space-y-0.5 border-t border-green-500/20 pt-2 font-mono text-[10px]">
                <div v-if="testResult.tokenEndpoint">token: {{ testResult.tokenEndpoint }}</div>
                <div v-if="testResult.userinfoEndpoint">userinfo: {{ testResult.userinfoEndpoint }}</div>
                <div v-if="testResult.jwksUri">jwks: {{ testResult.jwksUri }}</div>
                <div v-if="testResult.codeChallengeMethodsSupported?.length">pkce: {{ testResult.codeChallengeMethodsSupported.join(', ') }}</div>
                <div v-if="testResult.supportedScopes?.length">scopes: {{ testResult.supportedScopes.join(', ') }}</div>
                <div>backchannel logout: {{ testResult.backchannelLogoutSupported ? 'supported' : 'not supported' }}</div>
              </div>
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
      <div class="flex items-center justify-between">
        <p class="settings-group-label">Claim Mapping</p>
        <button
          v-if="form.enabled && form.clientId && form.issuerUri"
          type="button"
          :disabled="previewing"
          class="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
          @click="previewOidcClaims"
        >
          {{ previewing ? 'Redirecting...' : 'Preview claims' }}
        </button>
      </div>
      <div v-if="previewClaims" class="mb-3 rounded-md border border-border bg-card p-3 text-xs">
        <p class="font-medium text-foreground mb-1.5">Mapped claims</p>
        <pre class="text-muted-foreground overflow-auto rounded bg-muted/40 p-2 text-[10px]">{{ JSON.stringify(previewClaims.mapped, null, 2) }}</pre>
        <p class="mt-2 font-medium text-foreground mb-1.5">Raw claims</p>
        <pre class="text-muted-foreground overflow-auto rounded bg-muted/40 p-2 text-[10px] max-h-40">{{
          JSON.stringify(previewClaims.raw, null, 2)
        }}</pre>
      </div>
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
        <!-- P1-4: Default permissions for auto-provisioned users -->
        <div class="px-4 py-3.5 bg-card md:px-5 md:py-4">
          <div class="mb-3">
            <p class="settings-label">Default permissions</p>
            <p class="settings-hint">Permissions granted to new users on first OIDC login.</p>
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label v-for="perm in ALL_PERMISSIONS" :key="perm" class="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                :checked="defaultPermissionSet.has(perm)"
                class="h-4 w-4 rounded border-input accent-primary cursor-pointer"
                @change="toggleDefaultPermission(perm)"
              />
              <span class="text-sm text-foreground">{{ PERMISSION_LABELS[perm] }}</span>
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- Group Mappings (P1-3) -->
    <div>
      <p class="settings-group-label">Group Mappings</p>
      <p class="mb-3 text-xs text-muted-foreground">Map OIDC group claims to ProjectX permissions. Synced on every login.</p>
      <div class="border border-border rounded-lg overflow-hidden bg-card">
        <!-- Existing mappings -->
        <div v-if="groupMappings.length > 0" class="divide-y divide-border">
          <div v-for="mapping in groupMappings" :key="mapping.id" class="flex items-center justify-between gap-3 px-4 py-3 md:px-5">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-foreground truncate">{{ mapping.oidcGroupClaim }}</p>
              <p class="text-xs text-muted-foreground">
                {{ mapping.permissionName ? (PERMISSION_LABELS[mapping.permissionName as Permission] ?? mapping.permissionName) : 'No permission' }}
              </p>
            </div>
            <button
              type="button"
              class="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              @click="deleteGroupMapping(mapping.id)"
            >
              <Trash2 class="w-4 h-4" />
            </button>
          </div>
        </div>
        <div v-else class="px-4 py-4 text-sm text-muted-foreground md:px-5">No group mappings configured.</div>

        <!-- Add new mapping -->
        <div class="border-t border-border px-4 py-3.5 md:px-5 md:py-4">
          <p class="settings-label mb-2">Add mapping</p>
          <div class="flex flex-col gap-2 sm:flex-row">
            <input v-model="newMapping.oidcGroupClaim" type="text" placeholder="OIDC group claim (e.g. admins)" class="input-field flex-1 min-w-0" />
            <select v-model="newMapping.permissionName" class="input-field sm:w-52 shrink-0">
              <option v-for="perm in ALL_PERMISSIONS" :key="perm" :value="perm">
                {{ PERMISSION_LABELS[perm] }}
              </option>
            </select>
            <button
              type="button"
              :disabled="addingMapping || !newMapping.oidcGroupClaim.trim()"
              class="settings-btn-primary shrink-0 disabled:opacity-50"
              @click="addGroupMapping"
            >
              {{ addingMapping ? 'Adding...' : 'Add' }}
            </button>
          </div>
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
