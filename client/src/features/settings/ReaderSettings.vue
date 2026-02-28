<script setup lang="ts">
import { computed } from 'vue'
import { Monitor, Cloud } from 'lucide-vue-next'
import { api } from '@/lib/api'
import { useAuth } from '@/features/auth/composables/useAuth'

const { user } = useAuth()

const syncEnabled = computed(() => user.value?.settings?.syncReaderPreferences ?? false)

async function setStorageMode(sync: boolean) {
  if (!user.value || syncEnabled.value === sync) return
  const res = await api('/api/v1/users/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { syncReaderPreferences: sync } }),
  })
  if (res.ok) {
    user.value = { ...user.value, settings: { ...user.value.settings, syncReaderPreferences: sync } }
  }
}
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8">
    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">Reading</h2>
      <p class="mt-1 text-sm text-muted-foreground">General behavior that applies across all reader types.</p>
    </div>

    <!-- Preference storage -->
    <div class="mb-2">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Where to save reader preferences</p>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <!-- This device only -->
        <div
          class="flex items-start gap-4 px-5 py-4 rounded-xl border-2 cursor-pointer transition-colors"
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
              <span class="text-sm font-medium text-foreground">This device only</span>
              <span v-if="!syncEnabled" class="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
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
          class="flex items-start gap-4 px-5 py-4 rounded-xl border-2 cursor-pointer transition-colors"
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
              <span class="text-sm font-medium text-foreground">My account</span>
              <span v-if="syncEnabled" class="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/15 text-primary">
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
