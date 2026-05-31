<script setup lang="ts">
import { computed } from 'vue'
import { toast } from 'vue-sonner'
import { Cloud, Monitor } from 'lucide-vue-next'
import { getDisplayPreferencesSnapshot } from '@/composables/useDisplaySettings'
import { loadDisplaySettingsFromServer, seedDisplaySettingsToServer } from '@/composables/useDisplaySettingsSync'
import { loadFromServer, seedToServer } from '@/composables/useThemeSync'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { api } from '@/lib/api'
import { useThemeStore } from '@/stores/theme'

const themeStore = useThemeStore()
const { user } = useAuth()
const { isDemoRestrictedAccount } = usePermissions()

const syncEnabled = computed(() => !isDemoRestrictedAccount.value && (user.value?.settings?.syncThemePreferences ?? false))

async function handleSetStorageMode(sync: boolean) {
  if (!user.value || syncEnabled.value === sync) return

  if (isDemoRestrictedAccount.value) {
    toast.error('Demo-restricted account cannot change theme storage mode')
    return
  }

  try {
    const res = await api('/api/v1/users/me/theme-storage-mode', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync }),
    })

    if (!res.ok) {
      toast.error('Failed to update storage mode')
      return
    }

    user.value = {
      ...user.value,
      settings: { ...user.value.settings, syncThemePreferences: sync },
    }

    if (sync) {
      const [themePrefsRes, displayPrefsRes] = await Promise.all([api('/api/v1/user-preferences/theme'), api('/api/v1/user-preferences/display')])

      if (themePrefsRes.ok) {
        const body = (await themePrefsRes.json()) as { settings: unknown }
        if (body.settings == null) {
          await seedToServer({
            theme: themeStore.theme,
            accent: themeStore.accent,
            radius: themeStore.radius,
            background: themeStore.background,
            brightness: themeStore.brightness,
          })
        } else {
          await loadFromServer()
        }
      }

      if (displayPrefsRes.ok) {
        const body = (await displayPrefsRes.json()) as { settings: unknown }
        if (body.settings == null) {
          await seedDisplaySettingsToServer(getDisplayPreferencesSnapshot())
        } else {
          await loadDisplaySettingsFromServer()
        }
      }
    }

    toast.success(sync ? 'Preferences will now be synced' : 'Preferences will stay on this device')
  } catch {
    toast.error('An error occurred while updating storage mode')
  }
}

async function handleDeviceMode() {
  await handleSetStorageMode(false)
}

async function handleAccountMode() {
  await handleSetStorageMode(true)
}
</script>

<template>
  <div>
    <p class="settings-group-label">Where to save appearance preferences</p>
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div
        class="flex items-start gap-4 px-4 py-3.5 md:px-5 md:py-4 rounded-lg border-2 cursor-pointer transition-colors"
        :class="!syncEnabled ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-muted-foreground/30'"
        @click="handleDeviceMode"
      >
        <div
          class="mt-0.5 flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-colors"
          :class="!syncEnabled ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'"
        >
          <Monitor :size="16" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="settings-label">This device only</span>
            <span v-if="!syncEnabled" class="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
              Active
            </span>
          </div>
          <span class="block text-xs text-muted-foreground leading-relaxed">
            Preferences stay in your browser. Best if you want a different look on different devices.
          </span>
        </div>
      </div>

      <div
        class="flex items-start gap-4 px-4 py-3.5 md:px-5 md:py-4 rounded-lg border-2 transition-colors"
        :class="[
          isDemoRestrictedAccount ? 'border-border bg-card opacity-50 cursor-not-allowed' : 'cursor-pointer',
          !isDemoRestrictedAccount && (syncEnabled ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-muted-foreground/30'),
        ]"
        @click="handleAccountMode"
      >
        <div
          class="mt-0.5 flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-colors"
          :class="syncEnabled ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'"
        >
          <Cloud :size="16" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="settings-label">My account</span>
            <span v-if="syncEnabled" class="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
              Active
            </span>
            <span
              v-if="isDemoRestrictedAccount"
              class="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
            >
              Not available
            </span>
          </div>
          <span class="block text-xs text-muted-foreground leading-relaxed">
            Preferences are saved to your account. Best if you want the same appearance on every device.
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
