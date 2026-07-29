<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OidcProviderPublic, UserSettings } from '@bookorbit/types'
import { Clock, KeyRound, Link, LinkIcon, MapPin, Save, Trash2, Trophy, Upload } from '@lucide/vue'
import { toast } from 'vue-sonner'
import UserAvatar from '@/components/UserAvatar.vue'
import { api } from '@/lib/api'
import { generatePkce } from '@/features/auth/composables/useOidc'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { MAX_PROFILE_AVATAR_BYTES, useProfileAvatar } from '@/features/auth/composables/useProfileAvatar'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import SettingsPageHeader from './SettingsPageHeader.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
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
const removeAvatarConfirmOpen = ref(false)
const formName = ref('')
const formTimezone = ref('UTC')
const savedTimezone = computed(() => (user.value?.settings as UserSettings | undefined)?.timezone ?? 'UTC')
const timezoneChanged = computed(() => formTimezone.value !== savedTimezone.value)
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
const nameChanged = computed(() => {
  const current = user.value
  if (!current) return false
  return formName.value.trim() !== current.name
})
const profileChanged = computed(() => nameChanged.value || timezoneChanged.value)
const accountEditBlocked = computed(() => isDemoRestrictedAccount.value)
const canChangePassword = computed(
  () => !accountEditBlocked.value && user.value?.provisioningMethod !== 'oidc' && user.value?.provisioningMethod !== 'shared',
)

const accountTypeLabel = computed(() => {
  if (user.value?.provisioningMethod === 'oidc') return t('settings.account.profile.accountTypeOidc')
  if (user.value?.provisioningMethod === 'shared') return t('settings.account.profile.accountTypeShared')
  return t('settings.account.profile.accountTypeLocal')
})

const passwordHint = computed(() => {
  if (user.value?.provisioningMethod === 'oidc') return t('settings.account.profile.passwordHintOidc')
  if (user.value?.provisioningMethod === 'shared') return t('settings.account.profile.passwordHintShared')
  return t('settings.account.profile.passwordHint')
})

function handleChangePassword() {
  openChangePassword()
}

function openRemoveAvatarDialog() {
  removeAvatarConfirmOpen.value = true
}

function closeRemoveAvatarDialog() {
  removeAvatarConfirmOpen.value = false
}

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

function errorMessage(payload: { message?: string | string[] } | null, fallback: string): string {
  if (Array.isArray(payload?.message)) return payload.message[0] ?? fallback
  return payload?.message ?? fallback
}

/** Name and timezone live on different endpoints but save together as one action. */
async function saveProfile() {
  if (shouldBlockAccountEdit()) return
  if (!user.value || !profileChanged.value) return
  profileError.value = null

  const trimmedName = formName.value.trim()
  if (nameChanged.value && !trimmedName) {
    profileError.value = t('settings.account.profile.nameRequired')
    toast.error(profileError.value)
    return
  }

  savingProfile.value = true
  try {
    if (nameChanged.value) {
      const res = await api('/api/v1/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
        const message = errorMessage(payload, t('settings.account.profile.updateFailed'))
        profileError.value = message
        toast.error(message)
        return
      }
    }

    if (timezoneChanged.value) {
      const res = await api('/api/v1/users/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { timezone: formTimezone.value } }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
        const message = errorMessage(payload, t('settings.account.preferences.saveFailed'))
        profileError.value = message
        toast.error(message)
        return
      }
    }

    await me()
    toast.success(t('settings.account.profile.updated'))
  } finally {
    savingProfile.value = false
  }
}

function discardProfileChanges() {
  formName.value = user.value?.name ?? ''
  formTimezone.value = savedTimezone.value
  profileError.value = null
}

async function handleAchievementsToggle(enabled: boolean) {
  if (shouldBlockAccountEdit() || !user.value || savingAchievements.value) return

  savingAchievements.value = true
  try {
    const res = await api('/api/v1/users/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { achievementPreferences: { enabled } } }),
    })
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
      toast.error(errorMessage(payload, t('settings.account.readingPreferences.achievementsSaveFailed')))
      return
    }

    await me()
    toast.success(
      enabled ? t('settings.account.readingPreferences.achievementsEnabled') : t('settings.account.readingPreferences.achievementsDisabled'),
    )
  } finally {
    savingAchievements.value = false
  }
}

watch([formName, formTimezone], () => {
  if (profileError.value) profileError.value = null
})

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
      class="mt-1 overflow-hidden text-ellipsis text-sm leading-5 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
    >
      {{ t('settings.account.subtitle') }}
    </p>
  </div>

  <div class="mt-5 space-y-8 md:mt-0">
    <p
      v-if="accountEditBlocked"
      class="rounded-md border-[var(--pill-warning)]/40 border bg-[var(--pill-warning)]/10 px-3 py-2 text-xs text-[var(--pill-warning)]"
    >
      {{ t('settings.account.demoRestricted.notice') }}
    </p>

    <section aria-labelledby="account-profile-heading" class="space-y-3">
      <h2 id="account-profile-heading" class="settings-group-label mb-0">{{ t('settings.account.groups.profile') }}</h2>

      <div class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div class="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between md:px-5 md:py-5">
          <div class="flex min-w-0 items-center gap-4">
            <UserAvatar :name="user?.name ?? null" :avatar-url="user?.avatarUrl ?? null" size-class="h-16 w-16" text-class="text-lg font-semibold" />
            <div class="min-w-0">
              <p class="settings-label truncate">{{ user?.name ?? t('settings.account.avatar.unknownUser') }}</p>
              <p class="settings-hint truncate">
                @{{ user?.username ?? '' }}
                <span aria-hidden="true"> · </span>
                {{ accountTypeLabel }}
              </p>
              <p class="settings-hint">
                {{ t('settings.account.avatar.formatHint', { size: Math.floor(MAX_PROFILE_AVATAR_BYTES / 1024 / 1024) }) }}
              </p>
            </div>
          </div>

          <div class="flex shrink-0 flex-wrap items-center gap-2">
            <input
              ref="fileInput"
              type="file"
              accept="image/*"
              class="hidden"
              :disabled="profileBusy || accountEditBlocked"
              @change="onFileSelected"
            />
            <button type="button" class="settings-btn-outline" :disabled="profileBusy || accountEditBlocked" @click="triggerFileDialog">
              <Upload :size="14" aria-hidden="true" />
              {{
                uploading
                  ? t('settings.account.avatar.uploading')
                  : hasAvatar
                    ? t('settings.account.avatar.replace')
                    : t('settings.account.avatar.upload')
              }}
            </button>
            <button
              type="button"
              class="settings-btn-outline"
              :disabled="profileBusy || !hasAvatar || accountEditBlocked"
              @click="openRemoveAvatarDialog"
            >
              <Trash2 :size="14" aria-hidden="true" />
              {{ removing ? t('settings.account.avatar.removing') : t('settings.account.avatar.remove') }}
            </button>
          </div>
        </div>

        <div class="space-y-4 px-4 py-4 md:px-5 md:py-5">
          <div class="grid gap-4 sm:grid-cols-2">
            <div class="space-y-1.5 sm:col-span-2">
              <label for="account-full-name" class="settings-label">{{ t('settings.account.profile.fullName') }}</label>
              <input
                id="account-full-name"
                v-model="formName"
                type="text"
                autocomplete="name"
                :readonly="accountEditBlocked"
                class="input-field w-full"
                :class="accountEditBlocked ? 'cursor-not-allowed bg-muted/50 text-muted-foreground' : ''"
                :aria-describedby="profileError ? 'account-full-name-error' : undefined"
                :aria-invalid="profileError ? 'true' : undefined"
              />
              <p v-if="profileError" id="account-full-name-error" role="alert" class="text-xs font-medium text-destructive">{{ profileError }}</p>
            </div>
            <div class="space-y-1.5">
              <label for="account-username" class="settings-label">{{ t('settings.account.profile.username') }}</label>
              <input
                id="account-username"
                :value="user?.username ?? ''"
                type="text"
                readonly
                class="input-field w-full truncate bg-muted/50 text-muted-foreground"
              />
              <p class="settings-hint">{{ t('settings.account.profile.usernameHint') }}</p>
            </div>
            <div class="space-y-1.5">
              <label for="account-email" class="settings-label">{{ t('settings.account.profile.email') }}</label>
              <input
                id="account-email"
                :value="user?.email ?? ''"
                type="email"
                readonly
                class="input-field w-full truncate bg-muted/50 text-muted-foreground"
              />
              <p class="settings-hint">{{ t('settings.account.profile.emailHint') }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section aria-labelledby="account-preferences-heading" class="space-y-3">
      <h2 id="account-preferences-heading" class="settings-group-label mb-0">{{ t('settings.account.groups.preferences') }}</h2>

      <div class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div class="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5 md:py-5">
          <div class="flex min-w-0 max-w-2xl items-start gap-2.5">
            <Clock :size="16" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <label for="account-timezone" class="settings-label">{{ t('settings.account.readingPreferences.timezone') }}</label>
              <p class="settings-hint">{{ t('settings.account.readingPreferences.timezoneHint') }}</p>
            </div>
          </div>
          <select id="account-timezone" v-model="formTimezone" class="select-field w-full md:w-64">
            <option v-for="tz in timezones" :key="tz" :value="tz">{{ tz }}</option>
          </select>
        </div>

        <div class="flex items-center justify-between gap-4 px-4 py-4 md:px-5 md:py-5">
          <div class="flex min-w-0 max-w-2xl items-start gap-2.5">
            <Trophy :size="16" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.account.readingPreferences.enableAchievements') }}</p>
              <p class="settings-hint">{{ t('settings.account.readingPreferences.enableAchievementsHint') }}</p>
            </div>
          </div>
          <ToggleSwitch
            :model-value="achievementsEnabled"
            :disabled="savingAchievements || accountEditBlocked"
            :aria-label="t('settings.account.readingPreferences.enableAchievements')"
            class="shrink-0"
            @update:model-value="handleAchievementsToggle"
          />
        </div>

        <div class="hidden items-center justify-between gap-4 px-4 py-4 md:flex md:px-5 md:py-5">
          <div class="flex min-w-0 max-w-2xl items-start gap-2.5">
            <MapPin :size="16" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.account.tour.title') }}</p>
              <p class="settings-hint">{{ t('settings.account.tour.description') }}</p>
            </div>
          </div>
          <button type="button" class="settings-btn-outline shrink-0" @click="resetTour">{{ t('settings.account.tour.action') }}</button>
        </div>
      </div>
    </section>

    <section aria-labelledby="account-security-heading" class="space-y-3">
      <h2 id="account-security-heading" class="settings-group-label mb-0">{{ t('settings.account.groups.security') }}</h2>

      <div class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div class="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-5 md:py-5">
          <div class="flex min-w-0 max-w-2xl items-start gap-2.5">
            <KeyRound :size="16" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.account.profile.changePassword') }}</p>
              <p class="settings-hint">{{ passwordHint }}</p>
            </div>
          </div>
          <button
            type="button"
            class="settings-btn-outline shrink-0 self-start md:self-auto"
            :disabled="!canChangePassword || profileBusy"
            @click="handleChangePassword"
          >
            {{ t('settings.account.profile.changePassword') }}
          </button>
        </div>

        <div v-if="!oidcIdentityLoading" class="space-y-3 px-4 py-4 md:px-5 md:py-5">
          <div class="flex min-w-0 max-w-2xl items-start gap-2.5">
            <LinkIcon :size="16" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <h3 class="settings-label">{{ t('settings.account.connectedAccounts.title') }}</h3>
              <p class="settings-hint">{{ t('settings.account.connectedAccounts.description') }}</p>
            </div>
          </div>

          <ul v-if="linkedIdentities.length > 0" class="space-y-2">
            <li
              v-for="identity in linkedIdentities"
              :key="identity.id"
              class="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
            >
              <img v-if="identity.providerIconUrl" :src="identity.providerIconUrl" alt="" class="size-5 shrink-0 rounded object-contain" />
              <div class="min-w-0 flex-1">
                <p class="settings-label truncate">{{ identity.providerName }}</p>
                <p class="settings-hint truncate">{{ identity.oidcSubject }}</p>
              </div>
              <button
                type="button"
                :disabled="accountEditBlocked"
                class="shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                :aria-label="t('settings.account.connectedAccounts.unlinkAria', { provider: identity.providerName })"
                @click="openUnlinkDialog(identity)"
              >
                {{ t('settings.account.connectedAccounts.unlink') }}
              </button>
            </li>
          </ul>

          <div v-if="availableForLinking().length > 0" class="space-y-2">
            <p class="settings-hint">{{ t('settings.account.connectedAccounts.linkAdditional') }}</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="provider in availableForLinking()"
                :key="provider.slug"
                type="button"
                :disabled="linkingSlug !== null || accountEditBlocked"
                class="settings-btn-outline"
                @click="initiateOidcLink(provider)"
              >
                <img v-if="provider.iconUrl" :src="provider.iconUrl" alt="" class="size-3 shrink-0 object-contain" />
                <Link v-else :size="12" aria-hidden="true" />
                {{
                  linkingSlug === provider.slug
                    ? t('settings.account.connectedAccounts.redirecting')
                    : t('settings.account.connectedAccounts.linkProvider', { provider: provider.displayName })
                }}
              </button>
            </div>
          </div>

          <p v-if="linkedIdentities.length === 0 && availableForLinking().length === 0" class="settings-hint">
            {{ t('settings.account.connectedAccounts.noneConfigured') }}
          </p>
        </div>
      </div>
    </section>
  </div>

  <div
    v-if="profileChanged"
    class="sticky bottom-2 z-20 mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur"
  >
    <p role="status" class="settings-hint mt-0">{{ t('settings.account.feedback.unsavedChanges') }}</p>
    <div class="flex shrink-0 items-center gap-2">
      <button type="button" class="settings-btn-outline" :disabled="profileBusy" @click="discardProfileChanges">
        {{ t('settings.account.feedback.discard') }}
      </button>
      <button type="button" class="settings-btn-primary" :disabled="profileBusy || accountEditBlocked" @click="saveProfile">
        <Save :size="14" aria-hidden="true" />
        {{ savingProfile ? t('settings.account.profile.saving') : t('settings.account.profile.save') }}
      </button>
    </div>
  </div>

  <ConfirmDialog
    :open="removeAvatarConfirmOpen"
    :title="t('settings.account.avatar.removeConfirm.title')"
    :description="t('settings.account.avatar.removeConfirm.description')"
    :confirm-label="t('settings.account.avatar.removeConfirm.confirm')"
    :busy="removing"
    :confirm-disabled="accountEditBlocked"
    @confirm="onRemoveAvatar"
    @cancel="closeRemoveAvatarDialog"
  />

  <ConfirmDialog
    :open="unlinkDialogOpen"
    :title="t('settings.account.connectedAccounts.unlinkDialog.title', { provider: unlinkTarget?.providerName ?? 'OIDC' })"
    :description="t('settings.account.connectedAccounts.unlinkDialog.description')"
    :confirm-label="unlinking ? t('settings.account.connectedAccounts.unlinking') : t('settings.account.connectedAccounts.unlink')"
    :busy="unlinking"
    :confirm-disabled="!unlinkPassword || accountEditBlocked"
    @confirm="confirmUnlink"
    @cancel="closeUnlinkDialog"
  >
    <div class="mt-3 space-y-1.5">
      <label for="account-unlink-password" class="settings-label">
        {{ t('settings.account.connectedAccounts.unlinkDialog.currentPassword') }}
      </label>
      <input id="account-unlink-password" v-model="unlinkPassword" type="password" autocomplete="current-password" class="input-field w-full" />
    </div>
  </ConfirmDialog>
</template>
