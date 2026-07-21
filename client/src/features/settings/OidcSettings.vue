<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/lib/api'
import { generatePkce } from '@/features/auth/composables/useOidc'
import { toast } from 'vue-sonner'
import { Permission, PERMISSION_LABELS } from '@bookorbit/types'
import { ArrowLeft, Plus, ShieldCheck, Trash2 } from '@lucide/vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { t } = useI18n()

interface ProviderSummary {
  id: number
  slug: string
  displayName: string
  enabled: boolean
  issuerUri: string
  iconUrl: string | null
  displayOrder: number
}

interface ProviderDetail {
  id: number
  slug: string
  displayName: string
  enabled: boolean
  issuerUri: string
  clientId: string
  clientSecret: string
  scopes: string
  iconUrl: string | null
  claimMapping: { username: string; name: string; email: string; groups: string }
  autoProvision: { enabled: boolean; allowLocalLinking: boolean; defaultPermissionNames: string[] }
  displayOrder: number
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

type ViewMode = 'list' | 'create' | 'edit'
const viewMode = ref<ViewMode>('list')
const providers = ref<ProviderSummary[]>([])
const loading = ref(true)
const editingSlug = ref<string | null>(null)

const saving = ref(false)
const testing = ref(false)
const deleting = ref(false)
const saveError = ref<string | null>(null)
const testResult = ref<OidcTestResult | null>(null)
const showTestDetails = ref(false)
const previewing = ref(false)
const previewClaims = ref<{ raw: Record<string, unknown>; mapped: Record<string, unknown> } | null>(null)

const groupMappings = ref<GroupMapping[]>([])
const newMapping = reactive({ oidcGroupClaim: '', permissionName: ALL_PERMISSIONS[0] })
const addingMapping = ref(false)

const emptyForm = (): ProviderDetail => ({
  id: 0,
  slug: '',
  displayName: '',
  enabled: true,
  issuerUri: '',
  clientId: '',
  clientSecret: '',
  scopes: 'openid profile email',
  iconUrl: null,
  claimMapping: { username: 'preferred_username', name: 'name', email: 'email', groups: 'groups' },
  autoProvision: { enabled: false, allowLocalLinking: false, defaultPermissionNames: [] },
  displayOrder: 0,
})

const form = reactive<ProviderDetail>(emptyForm())
const defaultPermissionSet = computed(() => new Set(form.autoProvision.defaultPermissionNames))

onMounted(async () => {
  const stored = sessionStorage.getItem('oidc_preview_claims')
  const previewSlug = sessionStorage.getItem('oidc_preview_pending')
  let restoredClaims: { raw: Record<string, unknown>; mapped: Record<string, unknown> } | null = null
  if (stored) {
    try {
      restoredClaims = JSON.parse(stored)
    } catch {
      /* ignore */
    }
    sessionStorage.removeItem('oidc_preview_claims')
    sessionStorage.removeItem('oidc_preview_pending')
  }
  await loadProviders()
  if (previewSlug && restoredClaims) {
    await startEdit(previewSlug)
    previewClaims.value = restoredClaims
  }
})

async function loadProviders() {
  loading.value = true
  try {
    const res = await api('/api/v1/app-settings/oidc/providers')
    if (res.ok) providers.value = await res.json()
  } finally {
    loading.value = false
  }
}

function startCreate() {
  Object.assign(form, emptyForm())
  groupMappings.value = []
  testResult.value = null
  saveError.value = null
  previewClaims.value = null
  viewMode.value = 'create'
}

async function startEdit(slug: string) {
  loading.value = true
  editingSlug.value = slug
  testResult.value = null
  saveError.value = null
  previewClaims.value = null
  try {
    const [providerRes, mappingsRes] = await Promise.all([
      api(`/api/v1/app-settings/oidc/providers/${slug}`),
      api(`/api/v1/app-settings/oidc/providers/${slug}/group-mappings`),
    ])
    if (!providerRes.ok) throw new Error(t('settings.oidc.errors.loadProvider'))
    const data = await providerRes.json()
    Object.assign(form, data)
    form.clientSecret = ''
    if (mappingsRes.ok) groupMappings.value = await mappingsRes.json()
    viewMode.value = 'edit'
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('settings.oidc.errors.loadProvider'))
  } finally {
    loading.value = false
  }
}

function backToList() {
  viewMode.value = 'list'
  editingSlug.value = null
  loadProviders()
}

async function saveProvider() {
  saveError.value = null
  saving.value = true
  try {
    if (viewMode.value === 'create') {
      const res = await api('/api/v1/app-settings/oidc/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: form.slug,
          displayName: form.displayName,
          enabled: form.enabled,
          issuerUri: form.issuerUri,
          clientId: form.clientId,
          clientSecret: form.clientSecret,
          scopes: form.scopes,
          iconUrl: form.iconUrl || null,
          claimMapping: form.claimMapping,
          autoProvision: form.autoProvision,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(((err as Record<string, unknown>).message as string) ?? t('settings.oidc.errors.createProvider'))
      }
      toast.success(t('settings.oidc.toasts.providerCreated'))
      backToList()
    } else {
      const body: Record<string, unknown> = {
        displayName: form.displayName,
        enabled: form.enabled,
        issuerUri: form.issuerUri,
        clientId: form.clientId,
        scopes: form.scopes,
        iconUrl: form.iconUrl || null,
        claimMapping: form.claimMapping,
        autoProvision: form.autoProvision,
      }
      if (form.clientSecret) body.clientSecret = form.clientSecret

      const res = await api(`/api/v1/app-settings/oidc/providers/${editingSlug.value}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(((err as Record<string, unknown>).message as string) ?? t('settings.oidc.errors.save'))
      }
      toast.success(t('settings.oidc.toasts.providerSaved'))
    }
  } catch (err) {
    saveError.value = err instanceof Error ? err.message : t('settings.oidc.errors.save')
    toast.error(saveError.value)
  } finally {
    saving.value = false
  }
}

async function deleteProvider() {
  if (!editingSlug.value) return
  deleting.value = true
  try {
    const res = await api(`/api/v1/app-settings/oidc/providers/${editingSlug.value}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(((err as Record<string, unknown>).message as string) ?? t('settings.oidc.errors.delete'))
    }
    toast.success(t('settings.oidc.toasts.providerDeleted'))
    backToList()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('settings.oidc.errors.deleteProvider'))
  } finally {
    deleting.value = false
  }
}

async function testConnection() {
  testResult.value = null
  showTestDetails.value = false
  testing.value = true
  try {
    const slug = editingSlug.value ?? form.slug ?? '_new'
    const res = await api(`/api/v1/app-settings/oidc/providers/${slug}/test?issuerUri=${encodeURIComponent(form.issuerUri)}`, { method: 'POST' })
    testResult.value = await res.json()
  } catch {
    testResult.value = { success: false, error: t('settings.oidc.errors.requestFailed') }
  } finally {
    testing.value = false
  }
}

async function previewOidcClaims() {
  if (!editingSlug.value) return
  previewing.value = true
  previewClaims.value = null
  try {
    const stateRes = await api(`/api/v1/auth/oidc/${editingSlug.value}/preview-state`, { method: 'POST' })
    if (!stateRes.ok) throw new Error(t('settings.oidc.errors.previewState'))
    const { state, authorizationEndpoint } = await stateRes.json()
    const nonce = crypto.randomUUID()
    const { codeVerifier, codeChallenge } = await generatePkce()

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: form.clientId,
      redirect_uri: `${window.location.origin}/oauth2-callback`,
      scope: form.scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    })
    sessionStorage.setItem(`oidc_pkce_${state}`, JSON.stringify({ codeVerifier, nonce, state }))
    sessionStorage.setItem('oidc_preview_pending', editingSlug.value)
    window.location.href = `${authorizationEndpoint}?${params.toString()}`
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('settings.oidc.errors.startPreview'))
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
  if (!newMapping.oidcGroupClaim.trim() || !editingSlug.value) return
  addingMapping.value = true
  try {
    const res = await api(`/api/v1/app-settings/oidc/providers/${editingSlug.value}/group-mappings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oidcGroupClaim: newMapping.oidcGroupClaim.trim(), permissionName: newMapping.permissionName }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(((err as Record<string, unknown>).message as string) ?? t('settings.oidc.errors.addMapping'))
    }
    const created: GroupMapping = await res.json()
    groupMappings.value.push(created)
    newMapping.oidcGroupClaim = ''
    toast.success(t('settings.oidc.toasts.mappingAdded'))
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('settings.oidc.errors.addMapping'))
  } finally {
    addingMapping.value = false
  }
}

async function deleteGroupMapping(id: number) {
  if (!editingSlug.value) return
  try {
    const res = await api(`/api/v1/app-settings/oidc/providers/${editingSlug.value}/group-mappings/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(t('settings.oidc.errors.delete'))
    groupMappings.value = groupMappings.value.filter((m) => m.id !== id)
    toast.success(t('settings.oidc.toasts.mappingRemoved'))
  } catch {
    toast.error(t('settings.oidc.errors.removeMapping'))
  }
}
</script>

<template>
  <!-- List view -->
  <template v-if="viewMode === 'list'">
    <SettingsPageHeader v-if="!props.embedded" class="hidden md:flex" :title="t('settings.oidc.title')" :subtitle="t('settings.oidc.subtitle')" />
    <div v-if="!props.embedded" class="md:hidden px-1">
      <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.oidc.title') }}</h1>
      <p
        class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
      >
        {{ t('settings.oidc.subtitle') }}
      </p>
    </div>

    <div v-if="loading" class="mt-5 md:mt-0 text-sm text-muted-foreground">{{ t('common.loading') }}</div>

    <div v-else class="mt-5 md:mt-0 space-y-4">
      <div>
        <div class="flex items-center justify-between mb-3">
          <p class="settings-group-label mb-0">{{ t('settings.oidc.providers') }}</p>
          <button type="button" class="settings-btn-primary" @click="startCreate">
            <Plus :size="12" />
            {{ t('settings.oidc.addProvider') }}
          </button>
        </div>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs">
          <div v-if="providers.length > 0" class="divide-y divide-border">
            <button
              v-for="provider in providers"
              :key="provider.slug"
              type="button"
              class="flex w-full items-center gap-3 px-4 py-4 bg-card text-left hover:bg-muted/30 transition-colors md:px-5"
              @click="startEdit(provider.slug)"
            >
              <div
                class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0 border border-border overflow-hidden"
              >
                <img v-if="provider.iconUrl" :src="provider.iconUrl" alt="" class="h-5 w-5 object-contain" />
                <ShieldCheck v-else :size="16" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-foreground truncate">{{ provider.displayName }}</p>
                <p class="text-xs text-muted-foreground truncate">{{ provider.slug }} - {{ provider.issuerUri }}</p>
              </div>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                :class="provider.enabled ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'"
              >
                {{ provider.enabled ? t('settings.oidc.enabled') : t('settings.oidc.disabled') }}
              </span>
            </button>
          </div>
          <div v-else class="px-5 py-10 bg-card text-center">
            <div class="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
              <ShieldCheck :size="18" class="text-muted-foreground/70" />
            </div>
            <p class="text-sm font-medium text-foreground">{{ t('settings.oidc.empty.title') }}</p>
            <p class="text-xs text-muted-foreground mt-1 max-w-[240px] mx-auto">{{ t('settings.oidc.empty.description') }}</p>
          </div>
        </div>
      </div>
    </div>
  </template>

  <!-- Create / Edit view -->
  <template v-else>
    <div class="hidden md:flex items-center gap-3 mb-4">
      <button type="button" class="p-1 rounded-md text-muted-foreground hover:text-foreground transition-colors" @click="backToList">
        <ArrowLeft class="w-5 h-5" />
      </button>
      <div
        v-if="viewMode === 'edit' && form.iconUrl"
        class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0 border border-border overflow-hidden"
      >
        <img :src="form.iconUrl" alt="" class="h-7 w-7 object-contain" />
      </div>
      <div>
        <h2 class="text-lg font-semibold text-foreground">
          {{ viewMode === 'create' ? t('settings.oidc.addProvider') : form.displayName || t('settings.oidc.editProvider') }}
        </h2>
        <p class="text-sm text-muted-foreground">
          {{ viewMode === 'create' ? t('settings.oidc.configureNew') : t('settings.oidc.editing', { slug: editingSlug }) }}
        </p>
      </div>
    </div>
    <div class="md:hidden px-1 mb-4">
      <button type="button" class="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2" @click="backToList">
        <ArrowLeft class="w-4 h-4" />
        {{ t('common.back') }}
      </button>
      <h1 class="text-xl font-semibold tracking-tight text-foreground">
        {{ viewMode === 'create' ? t('settings.oidc.addProvider') : form.displayName || t('settings.oidc.editProvider') }}
      </h1>
    </div>

    <div v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</div>

    <form v-else class="space-y-6" @submit.prevent="saveProvider">
      <!-- Status -->
      <div>
        <p class="settings-group-label">{{ t('settings.oidc.form.status') }}</p>
        <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
          <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.oidc.form.enableProvider') }}</p>
              <p class="settings-hint">{{ t('settings.oidc.form.enableProviderHint') }}</p>
            </div>
            <ToggleSwitch v-model="form.enabled" class="self-start md:self-auto" />
          </div>
        </div>
      </div>

      <!-- Identity -->
      <div>
        <p class="settings-group-label">{{ t('settings.oidc.form.identity') }}</p>
        <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
          <div
            v-if="viewMode === 'create'"
            class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4"
          >
            <div class="min-w-0 md:shrink-0">
              <p class="settings-label">{{ t('settings.oidc.form.slug') }}</p>
              <p class="settings-hint">{{ t('settings.oidc.form.slugHint') }}</p>
            </div>
            <input v-model="form.slug" type="text" placeholder="keycloak" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" class="input-field w-full md:w-72" />
          </div>
          <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
            <div class="min-w-0 md:shrink-0">
              <p class="settings-label">{{ t('settings.oidc.form.displayName') }}</p>
              <p class="settings-hint">{{ t('settings.oidc.form.displayNameHint') }}</p>
            </div>
            <input v-model="form.displayName" type="text" placeholder="Keycloak" class="input-field w-full md:w-72" />
          </div>
          <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
            <div class="min-w-0 md:shrink-0">
              <p class="settings-label">{{ t('settings.oidc.form.iconUrl') }}</p>
              <p class="settings-hint">{{ t('settings.oidc.form.iconUrlHint') }}</p>
            </div>
            <div class="flex w-full items-center gap-2 md:w-72">
              <img
                v-if="form.iconUrl"
                :src="form.iconUrl"
                :alt="t('settings.oidc.form.iconPreviewAlt')"
                class="h-5 w-5 shrink-0 rounded object-contain"
              />
              <input v-model="form.iconUrl" type="url" placeholder="https://example.com/logo.svg" class="input-field min-w-0 flex-1" />
            </div>
          </div>
        </div>
      </div>

      <!-- Connection -->
      <div>
        <p class="settings-group-label">{{ t('settings.oidc.form.connection') }}</p>
        <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
          <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-start md:justify-between md:gap-8 md:px-5 md:py-4">
            <div class="min-w-0 md:shrink-0 md:pt-0.5">
              <p class="settings-label">{{ t('settings.oidc.form.issuerUri') }}</p>
              <p class="settings-hint">{{ t('settings.oidc.form.issuerUriHint') }}</p>
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
                  {{ testing ? t('settings.oidc.form.testing') : t('settings.oidc.form.test') }}
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
                  <span>{{
                    testResult.success
                      ? t('settings.oidc.test.connected', { issuer: testResult.issuer ?? '' })
                      : (testResult.error ?? t('settings.oidc.test.connectionFailed'))
                  }}</span>
                  <button
                    v-if="testResult.success"
                    type="button"
                    class="shrink-0 underline underline-offset-2 opacity-70 hover:opacity-100"
                    @click="toggleTestDetails"
                  >
                    {{ showTestDetails ? t('settings.oidc.test.hide') : t('settings.oidc.test.details') }}
                  </button>
                </div>
                <div v-if="testResult.success && showTestDetails" class="mt-2 space-y-0.5 border-t border-green-500/20 pt-2 font-mono text-[10px]">
                  <div v-if="testResult.tokenEndpoint">token: {{ testResult.tokenEndpoint }}</div>
                  <div v-if="testResult.userinfoEndpoint">userinfo: {{ testResult.userinfoEndpoint }}</div>
                  <div v-if="testResult.jwksUri">jwks: {{ testResult.jwksUri }}</div>
                  <div v-if="testResult.codeChallengeMethodsSupported?.length">pkce: {{ testResult.codeChallengeMethodsSupported.join(', ') }}</div>
                  <div v-if="testResult.supportedScopes?.length">scopes: {{ testResult.supportedScopes.join(', ') }}</div>
                  <div>
                    backchannel logout:
                    {{ testResult.backchannelLogoutSupported ? t('settings.oidc.test.supported') : t('settings.oidc.test.notSupported') }}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
            <p class="settings-label md:shrink-0">{{ t('settings.oidc.form.clientId') }}</p>
            <input v-model="form.clientId" type="text" class="input-field w-full md:w-72" />
          </div>
          <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
            <p class="settings-label md:shrink-0">{{ t('settings.oidc.form.clientSecret') }}</p>
            <input
              v-model="form.clientSecret"
              type="password"
              :placeholder="viewMode === 'edit' ? t('settings.oidc.form.clientSecretPlaceholder') : ''"
              autocomplete="new-password"
              class="input-field w-full md:w-72"
            />
          </div>
          <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
            <p class="settings-label md:shrink-0">{{ t('settings.oidc.form.scopes') }}</p>
            <input v-model="form.scopes" type="text" class="input-field w-full md:w-72" />
          </div>
        </div>
      </div>

      <!-- Claim mapping -->
      <div>
        <div class="flex items-center justify-between">
          <p class="settings-group-label">{{ t('settings.oidc.form.claimMapping') }}</p>
          <button
            v-if="viewMode === 'edit' && form.enabled && form.clientId && form.issuerUri"
            type="button"
            :disabled="previewing"
            class="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
            @click="previewOidcClaims"
          >
            {{ previewing ? t('settings.oidc.form.redirecting') : t('settings.oidc.form.previewClaims') }}
          </button>
        </div>
        <div v-if="previewClaims" class="mb-3 rounded-md border border-border bg-card p-3 text-xs">
          <p class="font-medium text-foreground mb-1.5">{{ t('settings.oidc.form.mappedClaims') }}</p>
          <pre class="text-muted-foreground overflow-auto rounded bg-muted/40 p-2 text-[11px]">{{
            JSON.stringify(previewClaims.mapped, null, 2)
          }}</pre>
          <p class="mt-2 font-medium text-foreground mb-1.5">{{ t('settings.oidc.form.rawClaims') }}</p>
          <pre class="text-muted-foreground overflow-auto rounded bg-muted/40 p-2 text-[11px] max-h-40">{{
            JSON.stringify(previewClaims.raw, null, 2)
          }}</pre>
        </div>
        <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
          <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
            <p class="settings-label md:shrink-0">{{ t('settings.oidc.form.usernameClaim') }}</p>
            <input v-model="form.claimMapping.username" type="text" class="input-field w-full md:w-72" />
          </div>
          <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
            <p class="settings-label md:shrink-0">{{ t('settings.oidc.form.nameClaim') }}</p>
            <input v-model="form.claimMapping.name" type="text" class="input-field w-full md:w-72" />
          </div>
          <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
            <p class="settings-label md:shrink-0">{{ t('settings.oidc.form.emailClaim') }}</p>
            <input v-model="form.claimMapping.email" type="text" class="input-field w-full md:w-72" />
          </div>
          <div class="flex flex-col gap-2 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:gap-8 md:px-5 md:py-4">
            <p class="settings-label md:shrink-0">{{ t('settings.oidc.form.groupsClaim') }}</p>
            <input v-model="form.claimMapping.groups" type="text" class="input-field w-full md:w-72" />
          </div>
        </div>
      </div>

      <!-- Auto-provisioning -->
      <div>
        <p class="settings-group-label">{{ t('settings.oidc.form.autoProvisioning') }}</p>
        <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
          <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.oidc.form.autoProvisionUsers') }}</p>
              <p class="settings-hint">{{ t('settings.oidc.form.autoProvisionUsersHint') }}</p>
            </div>
            <ToggleSwitch v-model="form.autoProvision.enabled" class="self-start md:self-auto" />
          </div>
          <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.oidc.form.allowLocalLinking') }}</p>
              <p class="settings-hint">{{ t('settings.oidc.form.allowLocalLinkingHint') }}</p>
            </div>
            <ToggleSwitch v-model="form.autoProvision.allowLocalLinking" class="self-start md:self-auto" />
          </div>
          <div class="px-4 py-3.5 bg-card md:px-5 md:py-4">
            <div class="mb-3">
              <p class="settings-label">{{ t('settings.oidc.form.defaultPermissions') }}</p>
              <p class="settings-hint">{{ t('settings.oidc.form.defaultPermissionsHint') }}</p>
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

      <!-- Group Mappings (only in edit mode) -->
      <div v-if="viewMode === 'edit'">
        <p class="settings-group-label">{{ t('settings.oidc.groupMappings.title') }}</p>
        <p class="mb-3 text-xs text-muted-foreground">{{ t('settings.oidc.groupMappings.description') }}</p>
        <div class="border border-border rounded-lg overflow-hidden bg-card shadow-xs">
          <div v-if="groupMappings.length > 0" class="divide-y divide-border">
            <div v-for="mapping in groupMappings" :key="mapping.id" class="flex items-center justify-between gap-3 px-4 py-3 md:px-5">
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-foreground truncate">{{ mapping.oidcGroupClaim }}</p>
                <p class="text-xs text-muted-foreground">
                  {{
                    mapping.permissionName
                      ? (PERMISSION_LABELS[mapping.permissionName as Permission] ?? mapping.permissionName)
                      : t('settings.oidc.groupMappings.noPermission')
                  }}
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
          <div v-else class="px-4 py-4 text-sm text-muted-foreground md:px-5">{{ t('settings.oidc.groupMappings.empty') }}</div>

          <div class="border-t border-border px-4 py-3.5 md:px-5 md:py-4">
            <p class="settings-label mb-2">{{ t('settings.oidc.groupMappings.addMapping') }}</p>
            <div class="flex flex-col gap-2 sm:flex-row">
              <input
                v-model="newMapping.oidcGroupClaim"
                type="text"
                :placeholder="t('settings.oidc.groupMappings.claimPlaceholder')"
                class="input-field flex-1 min-w-0"
              />
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
                {{ addingMapping ? t('settings.oidc.groupMappings.adding') : t('settings.oidc.groupMappings.add') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Save + Delete -->
      <div class="hidden md:flex items-center gap-3">
        <button type="submit" :disabled="saving" class="settings-btn-primary">
          {{
            saving
              ? t('settings.oidc.form.saving')
              : viewMode === 'create'
                ? t('settings.oidc.form.createProvider')
                : t('settings.oidc.form.saveChanges')
          }}
        </button>
        <button
          v-if="viewMode === 'edit'"
          type="button"
          :disabled="deleting"
          class="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
          @click="deleteProvider"
        >
          {{ deleting ? t('settings.oidc.form.deleting') : t('settings.oidc.form.deleteProvider') }}
        </button>
        <p v-if="saveError" class="text-sm text-destructive">{{ saveError }}</p>
      </div>
      <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
        <div class="flex items-center gap-2">
          <button type="submit" :disabled="saving" class="settings-btn-primary w-full min-h-10 justify-center">
            {{
              saving
                ? t('settings.oidc.form.saving')
                : viewMode === 'create'
                  ? t('settings.oidc.form.createProvider')
                  : t('settings.oidc.form.saveChanges')
            }}
          </button>
          <button
            v-if="viewMode === 'edit'"
            type="button"
            :disabled="deleting"
            class="shrink-0 min-h-10 rounded-md border border-destructive/30 bg-destructive/5 px-3 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
            @click="deleteProvider"
          >
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
        <p v-if="saveError" class="mt-1.5 text-xs text-destructive line-clamp-2">{{ saveError }}</p>
      </div>
    </form>
  </template>
</template>
