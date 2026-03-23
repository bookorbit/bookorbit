<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { KeyRound, Save, Trash2, Upload } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import UserAvatar from '@/components/UserAvatar.vue'
import { api } from '@/lib/api'
import { useAuth } from '@/features/auth/composables/useAuth'
import { MAX_PROFILE_AVATAR_BYTES, useProfileAvatar } from '@/features/auth/composables/useProfileAvatar'
import { useChangePasswordDialog } from '@/composables/useChangePasswordDialog'
import SettingsPageHeader from './SettingsPageHeader.vue'

const { user, me } = useAuth()
const { open: openChangePassword } = useChangePasswordDialog()
const { uploading, removing, uploadAvatar, removeAvatar } = useProfileAvatar()

const fileInput = ref<HTMLInputElement | null>(null)
const savingProfile = ref(false)

const formName = ref('')
const formEmail = ref('')

watch(
  () => user.value,
  (current) => {
    formName.value = current?.name ?? ''
    formEmail.value = current?.email ?? ''
  },
  { immediate: true },
)

const hasAvatar = computed(() => Boolean(user.value?.avatarUrl))
const busy = computed(() => uploading.value || removing.value)
const profileBusy = computed(() => busy.value || savingProfile.value)
const profileChanged = computed(() => {
  const current = user.value
  if (!current) return false
  return formName.value.trim() !== current.name || formEmail.value.trim() !== (current.email ?? '')
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
  const trimmedName = formName.value.trim()
  if (!trimmedName) {
    toast.error('Name is required')
    return
  }

  savingProfile.value = true
  try {
    const trimmedEmail = formEmail.value.trim()
    const res = await api('/api/v1/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: trimmedName,
        email: trimmedEmail.length > 0 ? trimmedEmail : null,
      }),
    })

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
      const message = Array.isArray(payload?.message)
        ? (payload.message[0] ?? 'Failed to update profile')
        : (payload?.message ?? 'Failed to update profile')
      toast.error(message)
      return
    }

    await me()
    toast.success('Profile updated')
  } finally {
    savingProfile.value = false
  }
}
</script>

<template>
  <SettingsPageHeader title="Account" subtitle="Manage your personal profile settings." />

  <section class="rounded-xl border border-border bg-card/50 p-5 space-y-4 mb-4">
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="space-y-1.5 sm:col-span-2">
        <label class="settings-label">Username</label>
        <input
          :value="user?.username ?? ''"
          type="text"
          readonly
          class="w-full rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
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
          v-model="formEmail"
          type="email"
          autocomplete="email"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
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
  </section>

  <section class="rounded-xl border border-border bg-card/50 p-5 space-y-4">
    <div class="flex items-center gap-4">
      <UserAvatar :name="user?.name ?? null" :avatar-url="user?.avatarUrl ?? null" size-class="h-20 w-20" text-class="text-xl font-semibold" />
      <div class="min-w-0">
        <p class="text-sm font-medium text-foreground">{{ user?.name ?? 'Unknown user' }}</p>
        <p class="text-xs text-muted-foreground">{{ user?.username ?? '' }}</p>
        <p class="mt-1 text-xs text-muted-foreground">PNG/JPEG/WEBP up to {{ Math.floor(MAX_PROFILE_AVATAR_BYTES / 1024 / 1024) }} MB</p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <input ref="fileInput" type="file" accept="image/*" class="hidden" :disabled="profileBusy" @change="onFileSelected" />

      <button class="settings-btn-primary" :disabled="profileBusy" @click="triggerFileDialog">
        <Upload :size="14" />
        {{ uploading ? 'Uploading...' : hasAvatar ? 'Replace picture' : 'Upload picture' }}
      </button>

      <button class="settings-btn-outline inline-flex items-center gap-2" :disabled="profileBusy || !hasAvatar" @click="onRemoveAvatar">
        <Trash2 :size="14" />
        {{ removing ? 'Removing...' : 'Remove picture' }}
      </button>
    </div>
  </section>
</template>
