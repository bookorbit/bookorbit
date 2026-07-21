<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Monitor, Cloud } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import SettingsPageHeader from './SettingsPageHeader.vue'

const props = withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  {
    embedded: false,
  },
)

const { t } = useI18n()
const { user } = useAuth()
const { isDemoRestrictedAccount } = usePermissions()

const syncEnabled = computed(() => !isDemoRestrictedAccount.value && (user.value?.settings?.syncReaderPreferences ?? false))

async function setStorageMode(sync: boolean) {
  if (!user.value || syncEnabled.value === sync) return
  if (isDemoRestrictedAccount.value) {
    toast.error(t('settings.reader.general.demoCannotChangeStorage'))
    return
  }
  try {
    const res = await api('/api/v1/users/me/reader-storage-mode', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync }),
    })
    if (res.ok) {
      user.value = { ...user.value, settings: { ...user.value.settings, syncReaderPreferences: sync } }
      toast.success(sync ? t('settings.reader.general.preferencesSynced') : t('settings.reader.general.preferencesLocal'))
    } else {
      toast.error(t('settings.reader.general.storageUpdateFailed'))
    }
  } catch {
    toast.error(t('settings.reader.general.storageUpdateError'))
  }
}
</script>

<template>
  <div
    class="[&_.settings-hint]:overflow-hidden [&_.settings-hint]:text-ellipsis [&_.settings-hint]:whitespace-nowrap md:[&_.settings-hint]:overflow-visible md:[&_.settings-hint]:whitespace-normal"
  >
    <SettingsPageHeader v-if="!props.embedded" :title="t('settings.reader.general.title')" :subtitle="t('settings.reader.general.subtitle')" />

    <!-- Preference storage -->
    <div class="mt-5 mb-2">
      <p class="settings-group-label">{{ t('settings.reader.general.storageLabel') }}</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <!-- This device only -->
        <div
          class="flex items-start gap-4 px-4 py-3.5 md:px-5 md:py-4 rounded-lg border-2 cursor-pointer transition-colors"
          :class="!syncEnabled ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-muted-foreground/30'"
          @click="setStorageMode(false)"
        >
          <div
            class="mt-0.5 flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-colors"
            :class="!syncEnabled ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'"
          >
            <Monitor :size="16" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="settings-label">{{ t('settings.reader.general.deviceOnly') }}</span>
              <span v-if="!syncEnabled" class="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                {{ t('settings.reader.general.active') }}
              </span>
            </div>
            <span class="block text-xs text-muted-foreground leading-relaxed">
              {{ t('settings.reader.general.deviceOnlyHint') }}
            </span>
          </div>
        </div>

        <!-- My account -->
        <div
          class="flex items-start gap-4 px-4 py-3.5 md:px-5 md:py-4 rounded-lg border-2 transition-colors"
          :class="[
            isDemoRestrictedAccount ? 'border-border bg-card opacity-50 cursor-not-allowed' : 'cursor-pointer',
            !isDemoRestrictedAccount && (syncEnabled ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-muted-foreground/30'),
          ]"
          @click="setStorageMode(true)"
        >
          <div
            class="mt-0.5 flex items-center justify-center w-8 h-8 rounded-lg shrink-0 transition-colors"
            :class="syncEnabled ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'"
          >
            <Cloud :size="16" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <span class="settings-label">{{ t('settings.reader.general.myAccount') }}</span>
              <span v-if="syncEnabled" class="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                {{ t('settings.reader.general.active') }}
              </span>
              <span
                v-if="isDemoRestrictedAccount"
                class="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
              >
                {{ t('settings.reader.general.notAvailable') }}
              </span>
            </div>
            <span class="block text-xs text-muted-foreground leading-relaxed">
              {{ t('settings.reader.general.myAccountHint') }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
