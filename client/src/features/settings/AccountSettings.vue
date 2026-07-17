<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OidcProviderPublic, UserSettings } from '@bookorbit/types'
import { ChevronDown, ChevronUp, Clock, KeyRound, Link, LinkIcon, MapPin, Save, Trash2, Trophy, Upload } from '@lucide/vue'
import { toast } from 'vue-sonner'
import UserAvatar from '@/components/UserAvatar.vue'
import { api } from '@/lib/api'
import { generatePkce } from '@/features/auth/composables/useOidc'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { MAX_PROFILE_AVATAR_BYTES, useProfileAvatar } from '@/features/auth/composables/useProfileAvatar'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { useMediaQuery } from '@vueuse/core'
import { useOnboardingTour } from '@/features/onboarding/composables/useOnboardingTour'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { t } = useI18n()
const { user, me } = useAuth()
const { isDemoRestrictedAccount } = usePermissions()
const { open: openChangePassword } = useChangePasswordDialog()
const { uploading, removing, uploadAvatar, removeAvatar } = useProfileAvatar()
const { resetTour } = useOnboardingTour()

const fileInput = ref<HTMLInputElement | null>(null)
const savingProfile = ref(false)
const profileError = ref<string | null>(null)
const profileState = ref<'idle' | 'saved'>('idle')
const removeAvatarConfirmOpen = ref(false)
const profileCardOpen = ref(true)
const avatarCardOpen = ref(false)
const isMobile = useMediaQuery('(max-width: 767px)')
const formName = ref('')
const formTimezone = ref('UTC')
const savingTimezone = ref(false)
const timezoneChanged = computed(() => formTimezone.value !== ((user.value?.settings as UserSettings | undefined)?.timezone ?? 'UTC'))
const savingAchievements = ref(false)
const achievementsEnabled = computed(() => (user.value?.settings as UserSettings | undefined)?.achievementPreferences?.enabled !== false)

const timezones = (() => {
  try {
    return (Intl as typeof Intl & { supportedValuesOf: (key: string) => string[] }).supportedValuesOf('timeZone')
  } catch {
    return ['UTC']
  }
})()

watch(
  () => user.value,
  (current) => {
    formName.value = current?.name ?? ''
    formTimezone.value = (current?.settings as UserSettings | undefined)?.timezone ?? 'UTC'
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
  if (profileChanged.value) return t('settings.account.feedback.unsavedChanges')
  if (profileState.value === 'saved') return t('settings.account.feedback.allSaved')
  return ''
})
const accountEditBlocked = computed(() => isDemoRestrictedAccount.value)
const canChangePassword = computed(
  () => !accountEditBlocked.value && user.value?.provisioningMethod !== 'oidc' && user.value?.provisioningMethod !== 'shared',
)

function shouldBlockAccountEdit(): boolean {
  if (!accountEditBlocked.value) return false
  toast.error(t('settings.account.demoRestricted.cannotEdit'))
  return true
}

function triggerFileDialog() {
  if (shouldBlockAccountEdit()) return
  fileInput.value?.click()
}

async function onFileSelected(event: Event) {
  if (shouldBlockAccountEdit()) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  try {
    await uploadAvatar(file)
    toast.success(t('settings.account.avatar.updated'))
  } catch (error) {
    const message = error instanceof Error ? error.message : t('settings.account.avatar.uploadFailed')
    toast.error(message)
  }
}

async function onRemoveAvatar() {
  if (shouldBlockAccountEdit()) {
    removeAvatarConfirmOpen.value = false
    return
  }
  removeAvatarConfirmOpen.value = false
  try {
    await removeAvatar()
    toast.success(t('settings.account.avatar.removed'))
  } catch (error) {
    const message = error instanceof Error ? error.message : t('settings.account.avatar.removeFailed')
    toast.error(message)
  }
}

async function saveProfile() {
  if (shouldBlockAccountEdit()) return
  if (!user.value) return
  profileError.value = null
  const trimmedName = formName.value.trim()
  if (!trimmedName) {
    profileError.value = t('settings.account.profile.nameRequired')
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
        ? (payload.message[0] ?? t('settings.account.profile.updateFailed'))
        : (payload?.message ?? t('settings.account.profile.updateFailed'))
      profileError.value = message
      toast.error(message)
      return
    }

    await me()
    profileState.value = 'saved'
    toast.success(t('settings.account.profile.updated'))
  } finally {
    savingProfile.value = false
  }
}

async function saveTimezone() {
  if (!user.value) return
  savingTimezone.value = true
  try {
    const res = await api('/api/v1/users/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { timezone: formTimezone.value } }),
    })
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
      const message = Array.isArray(payload?.message)
        ? (payload.message[0] ?? t('settings.account.preferences.saveFailed'))
        : (payload?.message ?? t('settings.account.preferences.saveFailed'))
      toast.error(message)
      return
    }
    await me()
    toast.success(t('settings.account.preferences.saved'))
  } finally {
    savingTimezone.value = false
  }
}

async function handleAchievementsToggle() {
  if (shouldBlockAccountEdit() || !user.value || savingAchievements.value) return

  const enabled = !achievementsEnabled.value
  savingAchievements.value = true
  try {
    const res = await api('/api/v1/users/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { achievementPreferences: { enabled } } }),
    })
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
      const message = Array.isArray(payload?.message)
        ? (payload.message[0] ?? 'Failed to update achievement preference')
        : (payload?.message ?? 'Failed to update achievement preference')
      toast.error(message)
      return
    }

    await me()
    toast.success(`Achievements ${enabled ? 'enabled' : 'disabled'}`)
  } finally {
    savingAchievements.value = false
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
  if (shouldBlockAccountEdit()) return
  linkingSlug.value = provider.slug
  try {
    const stateRes = await api(`/api/v1/auth/oidc/${provider.slug}/link-state`, { method: 'POST' })
    if (!stateRes.ok) {
      const err = await stateRes.json().catch(() => ({}))
      throw new Error(((err as Record<string, unknown>).message as string) ?? t('settings.account.connectedAccounts.linkStateFailed'))
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
    toast.error(err instanceof Error ? err.message : t('settings.account.connectedAccounts.startLinkFailed'))
    linkingSlug.value = null
  }
}

async function confirmUnlink() {
  if (shouldBlockAccountEdit()) return
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
      throw new Error(((err as Record<string, unknown>).message as string) ?? t('settings.account.connectedAccounts.unlinkFailed'))
    }
    linkedIdentities.value = linkedIdentities.value.filter((i) => i.providerId !== unlinkTarget.value!.providerId)
    unlinkDialogOpen.value = false
    unlinkPassword.value = ''
    unlinkTarget.value = null
    toast.success(t('settings.account.connectedAccounts.unlinked'))
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('settings.account.connectedAccounts.unlinkIdentityFailed'))
  } finally {
    unlinking.value = false
  }
}

function openUnlinkDialog(identity: LinkedIdentity) {
  if (shouldBlockAccountEdit()) return
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
  <SettingsPageHeader v-if="!props.embedded" class="hidden md:flex" :title="t('settings.account.title')" :subtitle="t('settings.account.subtitle')" />
  <div v-if="!props.embedded" class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.account.title') }}</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      {{ t('settings.account.subtitle') }}
    </p>
  </div>

  <div class="mt-5 md:mt-0 space-y-4">
    <section class="rounded-lg border border-border bg-card p-4 md:p-5 space-y-4 mb-4 shadow-xs">
      <button class="md:hidden w-full flex items-center justify-between gap-2 text-left" @click="profileCardOpen = !profileCardOpen">
        <div>
          <p class="text-sm font-semibold text-foreground">{{ t('settings.account.profile.securityHeading') }}</p>
          <p class="text-xs text-muted-foreground truncate max-w-[17rem]">@{{ user?.username ?? '' }}</p>
        </div>
        <ChevronUp v-if="profileCardOpen" :size="16" class="text-muted-foreground shrink-0" />
        <ChevronDown v-else :size="16" class="text-muted-foreground shrink-0" />
      </button>

      <div v-show="profileCardOpen || !isMobile" class="space-y-4">
        <p
          v-if="accountEditBlocked"
          class="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
        >
          {{ t('settings.account.demoRestricted.notice') }}
        </p>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5 sm:col-span-2">
            <label class="settings-label">{{ t('settings.account.profile.username') }}</label>
            <input
              :value="user?.username ?? ''"
              type="text"
              readonly
              class="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground truncate"
            />
          </div>
          <div class="space-y-1.5">
            <label class="settings-label">{{ t('settings.account.profile.fullName') }}</label>
            <input
              v-model="formName"
              type="text"
              autocomplete="name"
              :readonly="accountEditBlocked"
              :class="[
                'w-full rounded-md border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50',
                accountEditBlocked ? 'bg-muted/50 text-muted-foreground cursor-not-allowed' : 'bg-background text-foreground',
              ]"
            />
          </div>
          <div class="space-y-1.5">
            <label class="settings-label">{{ t('settings.account.profile.email') }}</label>
            <input
              :value="user?.email ?? ''"
              type="email"
              readonly
              class="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground truncate"
            />
            <p class="text-xs text-muted-foreground">{{ t('settings.account.profile.emailHint') }}</p>
          </div>
        </div>

        <div class="hidden md:flex flex-wrap items-center gap-2">
          <button class="settings-btn-primary" :disabled="!profileChanged || profileBusy || accountEditBlocked" @click="saveProfile">
            <Save :size="14" />
            {{ savingProfile ? t('settings.account.profile.saving') : t('settings.account.profile.save') }}
          </button>
          <button
            v-if="canChangePassword"
            class="settings-btn-outline inline-flex items-center gap-2"
            :disabled="profileBusy || accountEditBlocked"
            @click="openChangePassword()"
          >
            <KeyRound :size="14" />
            {{ t('settings.account.profile.changePassword') }}
          </button>
          <span class="text-xs text-muted-foreground">
            {{ t('settings.account.profile.accountType') }}
            {{
              user?.provisioningMethod === 'oidc'
                ? t('settings.account.profile.accountTypeOidc')
                : user?.provisioningMethod === 'shared'
                  ? t('settings.account.profile.accountTypeShared')
                  : t('settings.account.profile.accountTypeLocal')
            }}
          </span>
        </div>

        <div class="md:hidden flex flex-wrap items-center gap-2">
          <button
            v-if="canChangePassword"
            class="settings-btn-outline inline-flex items-center gap-2"
            :disabled="profileBusy || accountEditBlocked"
            @click="openChangePassword()"
          >
            <KeyRound :size="14" />
            {{ t('settings.account.profile.changePassword') }}
          </button>
          <span class="text-xs text-muted-foreground">
            {{ t('settings.account.profile.accountType') }}
            {{
              user?.provisioningMethod === 'oidc'
                ? t('settings.account.profile.accountTypeOidc')
                : user?.provisioningMethod === 'shared'
                  ? t('settings.account.profile.accountTypeShared')
                  : t('settings.account.profile.accountTypeLocal')
            }}
          </span>
        </div>
        <p v-if="profileError" class="text-xs text-destructive">{{ profileError }}</p>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4 md:p-5 space-y-4 shadow-xs">
      <div class="flex items-center gap-2">
        <Clock class="h-4 w-4 text-muted-foreground shrink-0" />
        <div>
          <p class="text-sm font-semibold text-foreground">{{ t('settings.account.readingPreferences.title') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ t('settings.account.readingPreferences.timezoneHint') }}</p>
        </div>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <label class="settings-label">{{ t('settings.account.readingPreferences.timezone') }}</label>
          <select
            v-model="formTimezone"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</option>
          </select>
        </div>
      </div>
      <button class="settings-btn-primary" :disabled="!timezoneChanged || savingTimezone" @click="saveTimezone">
        <Save :size="14" />
        {{ savingTimezone ? t('settings.account.profile.saving') : t('settings.account.readingPreferences.save') }}
      </button>
    </section>

    <section class="rounded-lg border border-border bg-card p-4 md:p-5 shadow-xs">
      <div class="flex items-center justify-between gap-4 py-1.5">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <Trophy :size="16" class="text-muted-foreground shrink-0" />
            <p class="text-sm font-semibold text-foreground">{{ t('settings.account.readingPreferences.enableAchievements') }}</p>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ t('settings.account.readingPreferences.enableAchievementsHint') }}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          :aria-checked="achievementsEnabled"
          :disabled="savingAchievements || accountEditBlocked"
          class="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
          :class="achievementsEnabled ? 'bg-primary' : 'bg-muted-foreground/30'"
          @click="handleAchievementsToggle"
        >
          <span
            class="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-xs ring-0 transition-transform"
            :class="achievementsEnabled ? 'translate-x-4' : 'translate-x-0'"
          />
        </button>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4 md:p-5 space-y-4 shadow-xs">
      <button class="md:hidden w-full flex items-center justify-between gap-2 text-left" @click="avatarCardOpen = !avatarCardOpen">
        <div>
          <p class="text-sm font-semibold text-foreground">{{ t('settings.account.avatar.title') }}</p>
          <p class="text-xs text-muted-foreground truncate max-w-[17rem]">{{ user?.name ?? t('settings.account.avatar.unknownUser') }}</p>
        </div>
        <ChevronUp v-if="avatarCardOpen" :size="16" class="text-muted-foreground shrink-0" />
        <ChevronDown v-else :size="16" class="text-muted-foreground shrink-0" />
      </button>

      <div v-show="avatarCardOpen || !isMobile" class="space-y-4">
        <div class="flex items-center gap-4">
          <UserAvatar :name="user?.name ?? null" :avatar-url="user?.avatarUrl ?? null" size-class="h-20 w-20" text-class="text-xl font-semibold" />
          <div class="min-w-0">
            <p class="text-sm font-medium text-foreground truncate">{{ user?.name ?? t('settings.account.avatar.unknownUser') }}</p>
            <p class="text-xs text-muted-foreground truncate">{{ user?.username ?? '' }}</p>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ t('settings.account.avatar.formatHint', { size: Math.floor(MAX_PROFILE_AVATAR_BYTES / 1024 / 1024) }) }}
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <input ref="fileInput" type="file" accept="image/*" class="hidden" :disabled="profileBusy || accountEditBlocked" @change="onFileSelected" />

          <button class="settings-btn-primary" :disabled="profileBusy || accountEditBlocked" @click="triggerFileDialog">
            <Upload :size="14" />
            {{
              uploading
                ? t('settings.account.avatar.uploading')
                : hasAvatar
                  ? t('settings.account.avatar.replace')
                  : t('settings.account.avatar.upload')
            }}
          </button>

          <button
            class="settings-btn-outline inline-flex items-center gap-2"
            :disabled="profileBusy || !hasAvatar || accountEditBlocked"
            @click="removeAvatarConfirmOpen = true"
          >
            <Trash2 :size="14" />
            {{ removing ? t('settings.account.avatar.removing') : t('settings.account.avatar.remove') }}
          </button>
        </div>
      </div>
    </section>

    <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
      <div class="flex items-center gap-2">
        <button
          class="settings-btn-primary flex-1 min-h-10 justify-center"
          :disabled="!profileChanged || profileBusy || accountEditBlocked"
          @click="saveProfile"
        >
          <Save :size="14" />
          {{ savingProfile ? t('settings.account.profile.saving') : t('settings.account.profile.save') }}
        </button>
      </div>
      <p v-if="saveFeedback" class="mt-1.5 text-xs" :class="profileError ? 'text-destructive' : 'text-muted-foreground'">
        {{ saveFeedback }}
      </p>
    </div>
  </div>

  <!-- OIDC Identity section -->
  <div v-if="!oidcIdentityLoading" class="mt-4">
    <section class="rounded-lg border border-border bg-card p-4 md:p-5 space-y-3 shadow-xs">
      <div class="flex items-center gap-2">
        <LinkIcon class="h-4 w-4 text-muted-foreground shrink-0" />
        <h2 class="text-sm font-semibold text-foreground">{{ t('settings.account.connectedAccounts.title') }}</h2>
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
            :disabled="accountEditBlocked"
            class="shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            @click="openUnlinkDialog(identity)"
          >
            {{ t('settings.account.connectedAccounts.unlink') }}
          </button>
        </div>
      </div>

      <!-- Link new provider -->
      <div v-if="availableForLinking().length > 0" class="space-y-2">
        <p class="text-xs text-muted-foreground">{{ t('settings.account.connectedAccounts.linkAdditional') }}</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="provider in availableForLinking()"
            :key="provider.slug"
            type="button"
            :disabled="linkingSlug !== null || accountEditBlocked"
            class="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 transition-colors"
            @click="initiateOidcLink(provider)"
          >
            <img v-if="provider.iconUrl" :src="provider.iconUrl" alt="" class="h-3 w-3 shrink-0 object-contain" />
            <Link class="h-3 w-3" />
            {{
              linkingSlug === provider.slug
                ? t('settings.account.connectedAccounts.redirecting')
                : t('settings.account.connectedAccounts.linkProvider', { provider: provider.displayName })
            }}
          </button>
        </div>
      </div>

      <p v-if="linkedIdentities.length === 0 && availableForLinking().length === 0" class="text-sm text-muted-foreground">
        {{ t('settings.account.connectedAccounts.noneConfigured') }}
      </p>
    </section>
  </div>

  <div
    v-if="removeAvatarConfirmOpen"
    class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
    @click.self="removeAvatarConfirmOpen = false"
  >
    <button class="absolute inset-0 bg-black/45" @click="removeAvatarConfirmOpen = false" />
    <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
      <p class="text-base font-semibold text-foreground">{{ t('settings.account.avatar.removeConfirm.title') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.account.avatar.removeConfirm.description') }}</p>
      <div class="mt-4 flex items-center justify-end gap-2">
        <button
          class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
          @click="removeAvatarConfirmOpen = false"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          :disabled="accountEditBlocked"
          class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed"
          @click="onRemoveAvatar"
        >
          {{ t('settings.account.avatar.removeConfirm.confirm') }}
        </button>
      </div>
    </div>
  </div>

  <!-- Guided Tour (desktop only) -->
  <div class="hidden md:block mt-4">
    <section class="rounded-lg border border-border bg-card p-4 md:p-5 shadow-xs">
      <div class="flex items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <MapPin class="h-4 w-4 text-muted-foreground shrink-0" />
          <div>
            <p class="text-sm font-semibold text-foreground">{{ t('settings.account.tour.title') }}</p>
            <p class="text-xs text-muted-foreground mt-0.5">{{ t('settings.account.tour.description') }}</p>
          </div>
        </div>
        <button class="settings-btn-outline shrink-0" @click="resetTour">{{ t('settings.account.tour.action') }}</button>
      </div>
    </section>
  </div>

  <!-- Unlink OIDC identity confirmation dialog -->
  <div v-if="unlinkDialogOpen" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="closeUnlinkDialog">
    <button class="absolute inset-0 bg-black/45" @click="closeUnlinkDialog" />
    <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
      <p class="text-base font-semibold text-foreground">
        {{ t('settings.account.connectedAccounts.unlinkDialog.title', { provider: unlinkTarget?.providerName ?? 'OIDC' }) }}
      </p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.account.connectedAccounts.unlinkDialog.description') }}</p>
      <input
        v-model="unlinkPassword"
        type="password"
        :placeholder="t('settings.account.connectedAccounts.unlinkDialog.currentPassword')"
        autocomplete="current-password"
        class="input-field mt-3 w-full"
      />
      <div class="mt-4 flex items-center justify-end gap-2">
        <button class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors" @click="closeUnlinkDialog">
          {{ t('common.cancel') }}
        </button>
        <button
          :disabled="unlinking || !unlinkPassword || accountEditBlocked"
          class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          @click="confirmUnlink"
        >
          {{ unlinking ? t('settings.account.connectedAccounts.unlinking') : t('settings.account.connectedAccounts.unlink') }}
        </button>
      </div>
    </div>
  </div>
</template>
