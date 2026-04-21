<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Save } from 'lucide-vue-next'
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, type NotificationCategory, type NotificationPreferences } from '@bookorbit/types'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'

const { user, me } = useAuth()

const saving = ref(false)

const preferences = ref<NotificationPreferences>({})

function loadFromUser() {
  const userPrefs = user.value?.settings?.notificationPreferences
  const result: NotificationPreferences = {}
  for (const key of Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[]) {
    result[key] = userPrefs?.[key] !== false
  }
  preferences.value = result
}

loadFromUser()

const hasChanges = computed(() => {
  const userPrefs = user.value?.settings?.notificationPreferences
  for (const key of Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[]) {
    const current = preferences.value[key] !== false
    const saved = userPrefs?.[key] !== false
    if (current !== saved) return true
  }
  return false
})

function handleToggle(category: NotificationCategory) {
  preferences.value = {
    ...preferences.value,
    [category]: !preferences.value[category],
  }
}

async function handleSave() {
  saving.value = true
  try {
    const existingSettings = user.value?.settings ?? {}
    const res = await api('/api/v1/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          ...existingSettings,
          notificationPreferences: { ...preferences.value },
        },
      }),
    })

    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string | string[] } | null
      const message = Array.isArray(payload?.message)
        ? (payload.message[0] ?? 'Failed to save preferences')
        : (payload?.message ?? 'Failed to save preferences')
      toast.error(message)
      return
    }

    await me()
    loadFromUser()
    toast.success('Notification preferences saved')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SettingsPageHeader class="hidden md:flex" title="Notifications" subtitle="Choose which notification categories you want to receive." />
  <div class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">Notifications</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      Choose which notification categories you want to receive.
    </p>
  </div>

  <div class="mt-5 md:mt-0 space-y-4">
    <section class="rounded-xl border border-border bg-card p-4 md:p-5 space-y-4">
      <div
        v-for="category in Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[]"
        :key="category"
        class="flex items-center justify-between gap-4 py-1.5"
      >
        <span class="text-sm text-foreground">{{ NOTIFICATION_CATEGORY_LABELS[category] }}</span>
        <button
          type="button"
          role="switch"
          :aria-checked="preferences[category] !== false"
          class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          :class="preferences[category] !== false ? 'bg-primary' : 'bg-muted-foreground/30'"
          @click="handleToggle(category)"
        >
          <span
            class="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm ring-0 transition-transform"
            :class="preferences[category] !== false ? 'translate-x-4' : 'translate-x-0'"
          />
        </button>
      </div>

      <div class="flex items-center gap-2 pt-2 border-t border-border">
        <button class="settings-btn-primary" :disabled="!hasChanges || saving" @click="handleSave">
          <Save :size="14" />
          {{ saving ? 'Saving...' : 'Save' }}
        </button>
        <span v-if="hasChanges" class="text-xs text-muted-foreground">Unsaved changes</span>
      </div>
    </section>
  </div>
</template>
