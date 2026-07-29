<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Save, Sparkles } from '@lucide/vue'
import { NOTIFICATION_CATEGORIES, type NotificationCategory, type NotificationPreferences } from '@bookorbit/types'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useWhatsNew } from '@/features/whats-new/composables/useWhatsNew'
import { api } from '@/lib/api'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { NOTIFICATION_CATEGORY_GROUPS, NOTIFICATION_CATEGORY_ICONS } from '../lib/notification-category-groups'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { t } = useI18n()

const { user, me } = useAuth()
const { popupEnabled, setPopupEnabled, loadPrefs } = useWhatsNew()

const saving = ref(false)

onMounted(() => {
  void loadPrefs()
})

async function handleWhatsNewToggle() {
  try {
    await setPopupEnabled(!popupEnabled.value)
  } catch {
    toast.error(t('notifications.preferences.savePreferenceFailed'))
  }
}

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

const enabledCount = computed(
  () => Object.keys(NOTIFICATION_CATEGORIES).filter((key) => preferences.value[key as NotificationCategory] !== false).length,
)
const totalCount = computed(() => Object.keys(NOTIFICATION_CATEGORIES).length)

function categoryLabel(category: NotificationCategory): string {
  return t(`notifications.preferences.categories.${category}.label`)
}

function categoryDescription(category: NotificationCategory): string {
  return t(`notifications.preferences.categories.${category}.description`)
}

function isEnabled(category: NotificationCategory): boolean {
  return preferences.value[category] !== false
}

function handleToggle(category: NotificationCategory, value: boolean) {
  preferences.value = { ...preferences.value, [category]: value }
}

function discardChanges() {
  loadFromUser()
}

async function handleSave() {
  saving.value = true
  try {
    const existingSettings = user.value?.settings ?? {}
    const res = await api('/api/v1/users/me/settings', {
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
        ? (payload.message[0] ?? t('notifications.preferences.saveFailed'))
        : (payload?.message ?? t('notifications.preferences.saveFailed'))
      toast.error(message)
      return
    }

    await me()
    loadFromUser()
    toast.success(t('notifications.preferences.saved'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SettingsPageHeader
    v-if="!props.embedded"
    class="hidden md:flex"
    :title="t('notifications.preferences.title')"
    :subtitle="t('notifications.preferences.subtitle')"
  />
  <div v-if="!props.embedded" class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('notifications.preferences.title') }}</h1>
    <p
      class="mt-1 overflow-hidden text-ellipsis text-sm leading-5 text-muted-foreground [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
    >
      {{ t('notifications.preferences.subtitle') }}
    </p>
  </div>

  <div class="mt-5 space-y-8 md:mt-0">
    <section v-for="group in NOTIFICATION_CATEGORY_GROUPS" :key="group.id" :aria-labelledby="`notification-group-${group.id}`" class="space-y-3">
      <div class="flex items-baseline justify-between gap-3">
        <h2 :id="`notification-group-${group.id}`" class="settings-group-label mb-0">
          {{ t(`notifications.preferences.groups.${group.id}`) }}
        </h2>
        <p v-if="group.id === 'library'" class="settings-hint mt-0">
          {{ t('notifications.preferences.enabledCount', { enabled: enabledCount, total: totalCount }) }}
        </p>
      </div>

      <div class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div v-for="category in group.categories" :key="category" class="flex items-center justify-between gap-4 px-4 py-4 md:px-5 md:py-5">
          <div class="flex min-w-0 max-w-2xl items-start gap-2.5">
            <component :is="NOTIFICATION_CATEGORY_ICONS[category]" :size="16" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <p class="settings-label">{{ categoryLabel(category) }}</p>
              <p class="settings-hint">{{ categoryDescription(category) }}</p>
            </div>
          </div>
          <ToggleSwitch
            :model-value="isEnabled(category)"
            :aria-label="categoryLabel(category)"
            class="shrink-0"
            @update:model-value="(value) => handleToggle(category, value)"
          />
        </div>
      </div>
    </section>

    <section aria-labelledby="notification-group-app" class="space-y-3">
      <h2 id="notification-group-app" class="settings-group-label mb-0">{{ t('notifications.preferences.groups.app') }}</h2>

      <div class="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-xs">
        <div class="flex items-center justify-between gap-4 px-4 py-4 md:px-5 md:py-5">
          <div class="flex min-w-0 max-w-2xl items-start gap-2.5">
            <Sparkles :size="16" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div class="min-w-0">
              <p class="settings-label">{{ t('notifications.preferences.whatsNewToggle') }}</p>
              <p class="settings-hint">{{ t('notifications.preferences.whatsNewToggleHint') }}</p>
            </div>
          </div>
          <ToggleSwitch
            :model-value="popupEnabled"
            :aria-label="t('notifications.preferences.whatsNewToggle')"
            class="shrink-0"
            @update:model-value="handleWhatsNewToggle"
          />
        </div>
      </div>
    </section>
  </div>

  <div
    v-if="hasChanges"
    class="sticky bottom-2 z-20 mt-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur"
  >
    <p role="status" class="settings-hint mt-0">{{ t('notifications.preferences.unsavedChanges') }}</p>
    <div class="flex shrink-0 items-center gap-2">
      <button type="button" class="settings-btn-outline" :disabled="saving" @click="discardChanges">
        {{ t('settings.account.feedback.discard') }}
      </button>
      <button type="button" class="settings-btn-primary" :disabled="saving" @click="handleSave">
        <Save :size="14" aria-hidden="true" />
        {{ saving ? t('notifications.preferences.saving') : t('common.save') }}
      </button>
    </div>
  </div>
</template>
