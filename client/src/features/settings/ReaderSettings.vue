<script setup lang="ts">
import { computed } from 'vue'
import { Monitor, Cloud } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/features/auth/composables/useAuth'
import SettingsPageHeader from './SettingsPageHeader.vue'

const props = withDefaults(
  defineProps<{
    embedded?: boolean
  }>(),
  {
    embedded: false,
  },
)

const { user } = useAuth()

const syncEnabled = computed(() => user.value?.settings?.syncReaderPreferences ?? false)

async function setStorageMode(sync: boolean) {
  if (!user.value || syncEnabled.value === sync) return
  try {
    const res = await api('/api/v1/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { syncReaderPreferences: sync } }),
    })
    if (res.ok) {
      user.value = { ...user.value, settings: { ...user.value.settings, syncReaderPreferences: sync } }
      toast.success(sync ? 'Preferences will now be synced' : 'Preferences will stay on this device')
    } else {
      toast.error('Failed to update storage mode')
    }
  } catch {
    toast.error('An error occurred while updating storage mode')
  }
}
</script>

<template>
  <div
    class="[&_.settings-hint]:overflow-hidden [&_.settings-hint]:text-ellipsis [&_.settings-hint]:whitespace-nowrap md:[&_.settings-hint]:overflow-visible md:[&_.settings-hint]:whitespace-normal"
  >
    <SettingsPageHeader v-if="!props.embedded" title="Reading" subtitle="General behavior that applies across all reader types." />

    <!-- Preference storage -->
    <div class="mt-5 mb-2">
      <p class="settings-group-label">Where to save reader preferences</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <!-- This device only -->
        <div
          class="flex items-start gap-4 px-4 py-3.5 md:px-5 md:py-4 rounded-xl border-2 cursor-pointer transition-colors"
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
              <span class="settings-label">This device only</span>
              <span v-if="!syncEnabled" class="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                Active
              </span>
            </div>
            <span class="block text-xs text-muted-foreground leading-relaxed">
              Preferences stay in your browser. Best if you always read on this device, or want different settings per device.
            </span>
          </div>
        </div>

        <!-- My account -->
        <div
          class="flex items-start gap-4 px-4 py-3.5 md:px-5 md:py-4 rounded-xl border-2 cursor-pointer transition-colors"
          :class="syncEnabled ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-muted-foreground/30'"
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
              <span class="settings-label">My account</span>
              <span v-if="syncEnabled" class="text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                Active
              </span>
            </div>
            <span class="block text-xs text-muted-foreground leading-relaxed">
              Preferences are saved to your account. Best if you log in from multiple devices and want a consistent experience everywhere.
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
