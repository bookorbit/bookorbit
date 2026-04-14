<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { OidcProviderPublic } from '@projectx/types'
import { ChevronDown, ChevronUp, KeyRound, Link, LinkIcon, Save, Trash2, Upload } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import UserAvatar from '@/components/UserAvatar.vue'
import { api } from '@/lib/api'
import { generatePkce } from '@/features/auth/composables/useOidc'
import { useAuth } from '@/features/auth/composables/useAuth'
import { MAX_PROFILE_AVATAR_BYTES, useProfileAvatar } from '@/features/auth/composables/useProfileAvatar'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { useMediaQuery } from '@vueuse/core'

const { user, me } = useAuth()
const { open: openChangePassword } = useChangePasswordDialog()
const { uploading, removing, uploadAvatar, removeAvatar } = useProfileAvatar()

const fileInput = ref<HTMLInputElement | null>(null)
const savingProfile = ref(false)
const profileError = ref<string | null>(null)
const profileState = ref<'idle' | 'saved'>('idle')
const removeAvatarConfirmOpen = ref(false)
const profileCardOpen = ref(true)
const avatarCardOpen = ref(false)
const isMobile = useMediaQuery('(max-width: 767px)')

const formName = ref('')

watch(
  () => user.value,
  (current) => {
    formName.value = current?.name ?? ''
  },
  { immediate: true },
)

const hasAvatar = computed(() => Boolean(user.value?.avatarUrl))
const busy = computed(() => uploading.value || removing.value)
const profileBusy = computed(() => busy.value || savingProfile.value)
const profileChanged = computed(() => {
  const current = user.value
  if (!current) return false
  return formName.value.trim() !== current.name
})
const saveFeedback = computed(() => {
  if (profileError.value) return profileError.value
  if (profileChanged.value) return 'Unsaved changes'
  if (profileState.value === 'saved') return 'All changes saved'
  return ''
})

function triggerFileDialog() {
  fileInput.value?.click()
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  try {
    await uploadAvatar(file)
    toast.success('Profile picture updated')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to upload profile picture'
    toast.error(message)
  }
}

async function onRemoveAvatar() {
  removeAvatarConfirmOpen.value = false
  try {
    await removeAvatar()
    toast.success('Profile picture removed')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to remove profile picture'
    toast.error(message)
  }
}

async function saveProfile() {
  if (!user.value) return
  profileError.value = null
  const trimmedName = formName.value.trim()
  if (!trimmedName) {
    profileError.value = 'Name is required'
    toast.error(profileError.value)
    return
  }

  savingProfile.value = true
  try {
    const res = await api('/api/v1/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: trimmedName,
      }),
    })

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
      const message = Array.isArray(payload?.message)
        ? (payload.message[0] ?? 'Failed to update profile')
        : (payload?.message ?? 'Failed to update profile')
      profileError.value = message
      toast.error(message)
      return
    }

    await me()
    profileState.value = 'saved'
    toast.success('Profile updated')
  } finally {
    savingProfile.value = false
  }
}

watch([formName], () => {
  profileState.value = 'idle'
  if (profileError.value) profileError.value = null
})

watch(
  isMobile,
  () => {
    profileCardOpen.value = true
    avatarCardOpen.value = true
  },
  { immediate: true },
)

interface LinkedIdentity {
  id: number
  providerId: number
  providerSlug: string
  providerName: string
  providerIconUrl: string | null
  oidcSubject: string
  oidcIssuer: string
  linkedAt: string
}

const linkedIdentities = ref<LinkedIdentity[]>([])
const oidcProviders = ref<OidcProviderPublic[]>([])
const oidcIdentityLoading = ref(false)
const unlinkPassword = ref('')
const unlinkDialogOpen = ref(false)
const unlinkTarget = ref<LinkedIdentity | null>(null)
const unlinking = ref(false)
const linkingSlug = ref<string | null>(null)

onMounted(async () => {
  oidcIdentityLoading.value = true
  try {
    const [identitiesRes, providersRes] = await Promise.all([
      api('/api/v1/auth/oidc/identities'),
      fetch('/api/v1/app-settings/oidc/providers/public'),
    ])
    if (identitiesRes.ok) linkedIdentities.value = await identitiesRes.json()
    if (providersRes.ok) oidcProviders.value = await providersRes.json()
  } finally {
    oidcIdentityLoading.value = false
  }
})

function availableForLinking(): OidcProviderPublic[] {
  const linkedSlugs = new Set(linkedIdentities.value.map((i) => i.providerSlug))
  return oidcProviders.value.filter((p) => p.enabled && !linkedSlugs.has(p.slug))
}

async function initiateOidcLink(provider: OidcProviderPublic) {
  linkingSlug.value = provider.slug
  try {
    const stateRes = await api(`/api/v1/auth/oidc/${provider.slug}/link-state`, { method: 'POST' })
    if (!stateRes.ok) {
      const err = await stateRes.json().catch(() => ({}))
      throw new Error(((err as Record<string, unknown>).message as string) ?? 'Failed to generate link state')
    }
    const { state, authorizationEndpoint, clientId, scopes } = await stateRes.json()
    const nonce = crypto.randomUUID()
    const { codeVerifier, codeChallenge } = await generatePkce()
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: `${window.location.origin}/oauth2-callback`,
      scope: scopes,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    })
    sessionStorage.setItem(`oidc_pkce_${state}`, JSON.stringify({ codeVerifier, nonce, state }))
    sessionStorage.setItem('oidc_link_pending', '1')
    window.location.href = `${authorizationEndpoint}?${params.toString()}`
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to start OIDC link')
    linkingSlug.value = null
  }
}

async function confirmUnlink() {
  if (!unlinkPassword.value || !unlinkTarget.value) return
  unlinking.value = true
  try {
    const res = await api(`/api/v1/auth/oidc/identities/${unlinkTarget.value.providerId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: unlinkPassword.value }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(((err as Record<string, unknown>).message as string) ?? 'Failed to unlink')
    }
    linkedIdentities.value = linkedIdentities.value.filter((i) => i.providerId !== unlinkTarget.value!.providerId)
    unlinkDialogOpen.value = false
    unlinkPassword.value = ''
    unlinkTarget.value = null
    toast.success('Identity unlinked')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to unlink identity')
  } finally {
    unlinking.value = false
  }
}

function openUnlinkDialog(identity: LinkedIdentity) {
  unlinkTarget.value = identity
  unlinkPassword.value = ''
  unlinkDialogOpen.value = true
}

function closeUnlinkDialog() {
  unlinkDialogOpen.value = false
  unlinkPassword.value = ''
  unlinkTarget.value = null
}
</script>

<template>
  <SettingsPageHeader class="hidden md:flex" title="Account" subtitle="Manage your personal profile settings." />
  <div class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">Account</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      Manage your personal profile settings.
    </p>
  </div>

  <div class="mt-5 md:mt-0 space-y-4">
    <section class="rounded-xl border border-border bg-card p-4 md:p-5 space-y-4 mb-4">
      <button class="md:hidden w-full flex items-center justify-between gap-2 text-left" @click="profileCardOpen = !profileCardOpen">
        <div>
          <p class="text-sm font-semibold text-foreground">Profile & Security</p>
          <p class="text-xs text-muted-foreground truncate max-w-[17rem]">@{{ user?.username ?? '' }}</p>
        </div>
        <ChevronUp v-if="profileCardOpen" :size="16" class="text-muted-foreground shrink-0" />
        <ChevronDown v-else :size="16" class="text-muted-foreground shrink-0" />
      </button>

      <div v-show="profileCardOpen || !isMobile" class="space-y-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5 sm:col-span-2">
            <label class="settings-label">Username</label>
            <input
              :value="user?.username ?? ''"
              type="text"
              readonly
              class="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground truncate"
            />
          </div>
          <div class="space-y-1.5">
            <label class="settings-label">Full name</label>
            <input
              v-model="formName"
              type="text"
              autocomplete="name"
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div class="space-y-1.5">
            <label class="settings-label">Email</label>
            <input
              :value="user?.email ?? ''"
              type="email"
              readonly
              class="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground truncate"
            />
            <p class="text-xs text-muted-foreground">Contact an administrator to change your email address.</p>
          </div>
        </div>

        <div class="hidden md:flex flex-wrap items-center gap-2">
          <button class="settings-btn-primary" :disabled="!profileChanged || profileBusy" @click="saveProfile">
            <Save :size="14" />
            {{ savingProfile ? 'Saving...' : 'Save profile' }}
          </button>
          <button class="settings-btn-outline inline-flex items-center gap-2" :disabled="profileBusy" @click="openChangePassword()">
            <KeyRound :size="14" />
            Change password
          </button>
          <span class="text-xs text-muted-foreground">Account type: {{ user?.provisioningMethod === 'oidc' ? 'OIDC / SSO' : 'Local' }}</span>
        </div>

        <div class="md:hidden flex flex-wrap items-center gap-2">
          <button class="settings-btn-outline inline-flex items-center gap-2" :disabled="profileBusy" @click="openChangePassword()">
            <KeyRound :size="14" />
            Change password
          </button>
          <span class="text-xs text-muted-foreground">Account type: {{ user?.provisioningMethod === 'oidc' ? 'OIDC / SSO' : 'Local' }}</span>
        </div>
        <p v-if="profileError" class="text-xs text-destructive">{{ profileError }}</p>
      </div>
    </section>

    <section class="rounded-xl border border-border bg-card p-4 md:p-5 space-y-4">
      <button class="md:hidden w-full flex items-center justify-between gap-2 text-left" @click="avatarCardOpen = !avatarCardOpen">
        <div>
          <p class="text-sm font-semibold text-foreground">Profile Picture</p>
          <p class="text-xs text-muted-foreground truncate max-w-[17rem]">{{ user?.name ?? 'Unknown user' }}</p>
        </div>
        <ChevronUp v-if="avatarCardOpen" :size="16" class="text-muted-foreground shrink-0" />
        <ChevronDown v-else :size="16" class="text-muted-foreground shrink-0" />
      </button>

      <div v-show="avatarCardOpen || !isMobile" class="space-y-4">
        <div class="flex items-center gap-4">
          <UserAvatar :name="user?.name ?? null" :avatar-url="user?.avatarUrl ?? null" size-class="h-20 w-20" text-class="text-xl font-semibold" />
          <div class="min-w-0">
            <p class="text-sm font-medium text-foreground truncate">{{ user?.name ?? 'Unknown user' }}</p>
            <p class="text-xs text-muted-foreground truncate">{{ user?.username ?? '' }}</p>
            <p class="mt-1 text-xs text-muted-foreground">PNG/JPEG/WEBP up to {{ Math.floor(MAX_PROFILE_AVATAR_BYTES / 1024 / 1024) }} MB</p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <input ref="fileInput" type="file" accept="image/*" class="hidden" :disabled="profileBusy" @change="onFileSelected" />

          <button class="settings-btn-primary" :disabled="profileBusy" @click="triggerFileDialog">
            <Upload :size="14" />
            {{ uploading ? 'Uploading...' : hasAvatar ? 'Replace picture' : 'Upload picture' }}
          </button>

          <button
            class="settings-btn-outline inline-flex items-center gap-2"
            :disabled="profileBusy || !hasAvatar"
            @click="removeAvatarConfirmOpen = true"
          >
            <Trash2 :size="14" />
            {{ removing ? 'Removing...' : 'Remove picture' }}
          </button>
        </div>
      </div>
    </section>

    <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
      <div class="flex items-center gap-2">
        <button class="settings-btn-primary flex-1 min-h-10 justify-center" :disabled="!profileChanged || profileBusy" @click="saveProfile">
          <Save :size="14" />
          {{ savingProfile ? 'Saving...' : 'Save profile' }}
        </button>
      </div>
      <p v-if="saveFeedback" class="mt-1.5 text-xs" :class="profileError ? 'text-destructive' : 'text-muted-foreground'">
        {{ saveFeedback }}
      </p>
    </div>
  </div>

  <!-- OIDC Identity section -->
  <div v-if="!oidcIdentityLoading" class="mt-4">
    <section class="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
      <div class="flex items-center gap-2">
        <LinkIcon class="h-4 w-4 text-muted-foreground shrink-0" />
        <h2 class="text-sm font-semibold text-foreground">Connected Accounts</h2>
      </div>

      <!-- Linked identities -->
      <div v-if="linkedIdentities.length > 0" class="space-y-2">
        <div
          v-for="identity in linkedIdentities"
          :key="identity.id"
          class="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
        >
          <img v-if="identity.providerIconUrl" :src="identity.providerIconUrl" alt="" class="h-5 w-5 shrink-0 rounded object-contain" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium text-foreground truncate">{{ identity.providerName }}</p>
            <p class="text-xs text-muted-foreground truncate">{{ identity.oidcSubject }}</p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/5 transition-colors"
            @click="openUnlinkDialog(identity)"
          >
            Unlink
          </button>
        </div>
      </div>

      <!-- Link new provider -->
      <div v-if="availableForLinking().length > 0" class="space-y-2">
        <p class="text-xs text-muted-foreground">Link additional providers:</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="provider in availableForLinking()"
            :key="provider.slug"
            type="button"
            :disabled="linkingSlug !== null"
            class="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors"
            @click="initiateOidcLink(provider)"
          >
            <img v-if="provider.iconUrl" :src="provider.iconUrl" alt="" class="h-3 w-3 shrink-0 object-contain" />
            <Link class="h-3 w-3" />
            {{ linkingSlug === provider.slug ? 'Redirecting...' : `Link ${provider.displayName}` }}
          </button>
        </div>
      </div>

      <p v-if="linkedIdentities.length === 0 && availableForLinking().length === 0" class="text-sm text-muted-foreground">
        No OIDC providers are configured. Ask an administrator to set up SSO.
      </p>
    </section>
  </div>

  <div
    v-if="removeAvatarConfirmOpen"
    class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
    @click.self="removeAvatarConfirmOpen = false"
  >
    <button class="absolute inset-0 bg-black/45" @click="removeAvatarConfirmOpen = false" />
    <div class="relative w-full rounded-t-xl border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-xl md:p-5">
      <p class="text-base font-semibold text-foreground">Remove profile picture?</p>
      <p class="mt-1 text-sm text-muted-foreground">Your avatar will be removed and replaced with initials.</p>
      <div class="mt-4 flex items-center justify-end gap-2">
        <button
          class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
          @click="removeAvatarConfirmOpen = false"
        >
          Cancel
        </button>
        <button
          class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          @click="onRemoveAvatar"
        >
          Remove
        </button>
      </div>
    </div>
  </div>

  <!-- Unlink OIDC identity confirmation dialog -->
  <div v-if="unlinkDialogOpen" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="closeUnlinkDialog">
    <button class="absolute inset-0 bg-black/45" @click="closeUnlinkDialog" />
    <div class="relative w-full rounded-t-xl border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-xl md:p-5">
      <p class="text-base font-semibold text-foreground">Unlink {{ unlinkTarget?.providerName ?? 'OIDC' }} identity?</p>
      <p class="mt-1 text-sm text-muted-foreground">Enter your password to confirm. You will no longer be able to sign in with this provider.</p>
      <input
        v-model="unlinkPassword"
        type="password"
        placeholder="Current password"
        autocomplete="current-password"
        class="input-field mt-3 w-full"
      />
      <div class="mt-4 flex items-center justify-end gap-2">
        <button class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors" @click="closeUnlinkDialog">
          Cancel
        </button>
        <button
          :disabled="unlinking || !unlinkPassword"
          class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          @click="confirmUnlink"
        >
          {{ unlinking ? 'Unlinking...' : 'Unlink' }}
        </button>
      </div>
    </div>
  </div>
</template>
