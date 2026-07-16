<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Link, Save, CheckCircle2, AlertCircle, Info, Loader2, Unlink } from '@lucide/vue'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useHardcoverSettings } from '../composables/useHardcoverSettings'

const { t } = useI18n()

const { settings, saving, validating, error, fetchSettings, saveSettings, disconnect, validateToken } = useHardcoverSettings()

const tokenInput = ref('')
const tokenVisible = ref(false)
const validationResult = ref<{ valid: boolean; username?: string } | null>(null)

const form = reactive({
  enabled: true,
  bookSyncMode: 'all_eligible' as 'all_eligible' | 'selected_only',
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
  autoSyncOnRatingChange: true,
  privacySettingId: 3,
})

onMounted(async () => {
  await fetchSettings()
  if (settings.value) {
    form.enabled = settings.value.enabled
    form.bookSyncMode = settings.value.bookSyncMode
    form.autoSyncOnStatusChange = settings.value.autoSyncOnStatusChange
    form.autoSyncOnProgressUpdate = settings.value.autoSyncOnProgressUpdate
    form.autoSyncOnRatingChange = settings.value.autoSyncOnRatingChange
    form.privacySettingId = settings.value.privacySettingId
  }
})

async function handleValidateToken() {
  if (!tokenInput.value.trim()) {
    toast.error(t('hardcover.connection.toast.enterToken'))
    return
  }
  const result = await validateToken(tokenInput.value.trim())
  validationResult.value = result
}

async function handleSave() {
  const ok = await saveSettings({
    ...(tokenInput.value.trim() ? { apiToken: tokenInput.value.trim() } : {}),
    enabled: form.enabled,
    bookSyncMode: form.bookSyncMode,
    autoSyncOnStatusChange: form.autoSyncOnStatusChange,
    autoSyncOnProgressUpdate: form.autoSyncOnProgressUpdate,
    autoSyncOnRatingChange: form.autoSyncOnRatingChange,
    privacySettingId: form.privacySettingId,
  })
  if (ok) {
    tokenInput.value = ''
    toast.success(t('hardcover.connection.toast.saved'))
  } else {
    toast.error(error.value ?? t('hardcover.connection.toast.saveFailed'))
  }
}

async function handleDisconnect() {
  await disconnect()
  tokenInput.value = ''
  validationResult.value = null
  toast.success(t('hardcover.connection.toast.disconnected'))
}

function toggleTokenVisible() {
  tokenVisible.value = !tokenVisible.value
}

const privacyOptions = computed(() => [
  { id: 1, label: t('hardcover.connection.privacy.public') },
  { id: 2, label: t('hardcover.connection.privacy.followersOnly') },
  { id: 3, label: t('hardcover.connection.privacy.private') },
])

const bookSyncModeOptions = computed(() => [
  {
    id: 'all_eligible' as const,
    label: t('hardcover.connection.syncScope.allEligible.label'),
    description: t('hardcover.connection.syncScope.allEligible.description'),
  },
  {
    id: 'selected_only' as const,
    label: t('hardcover.connection.syncScope.selectedOnly.label'),
    description: t('hardcover.connection.syncScope.selectedOnly.description'),
  },
])

function selectBookSyncMode(mode: 'all_eligible' | 'selected_only') {
  form.bookSyncMode = mode
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs space-y-5">
    <div class="flex items-center gap-3">
      <Link class="size-5 text-primary shrink-0" />
      <div>
        <p class="font-medium text-sm">{{ t('hardcover.connection.title') }}</p>
        <p class="text-xs text-muted-foreground mt-0.5">{{ t('hardcover.connection.description') }}</p>
      </div>
      <div v-if="settings?.tokenConfigured" class="ml-auto flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle2 class="size-3.5" />
        {{ t('hardcover.connection.connected') }}
      </div>
    </div>

    <div class="space-y-2">
      <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider"> {{ t('hardcover.connection.apiToken') }} </label>
      <div class="flex gap-2">
        <input
          v-model="tokenInput"
          :type="tokenVisible ? 'text' : 'password'"
          :placeholder="t('hardcover.connection.tokenPlaceholder')"
          class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          autocomplete="off"
        />
        <button
          type="button"
          class="px-3 py-2 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          @click="toggleTokenVisible"
        >
          {{ tokenVisible ? t('hardcover.connection.hide') : t('hardcover.connection.show') }}
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        {{ t('hardcover.connection.findTokenAt') }}
        <a href="https://hardcover.app/account/api" target="_blank" rel="noopener" class="text-primary underline underline-offset-2"
          >hardcover.app/account/api</a
        >.
      </p>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        :disabled="validating"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        @click="handleValidateToken"
      >
        <Loader2 v-if="validating" class="size-3 animate-spin" />
        {{ t('hardcover.connection.validateToken') }}
      </button>
      <span
        v-if="validationResult !== null"
        class="flex items-center gap-1 text-xs"
        :class="validationResult.valid ? 'text-green-600' : 'text-destructive'"
      >
        <CheckCircle2 v-if="validationResult.valid" class="size-3.5" />
        <AlertCircle v-else class="size-3.5" />
        {{
          validationResult.valid ? t('hardcover.connection.valid', { username: validationResult.username }) : t('hardcover.connection.invalidToken')
        }}
      </span>
    </div>

    <div v-if="settings?.tokenConfigured" class="space-y-3 pt-2 border-t border-border">
      <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{{ t('hardcover.connection.syncOptions') }}</p>
      <div class="flex items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-2">
        <Info class="size-3.5 shrink-0 text-muted-foreground mt-0.5" />
        <p class="text-xs text-muted-foreground leading-relaxed">
          {{ t('hardcover.connection.syncInfo') }}
        </p>
      </div>

      <div class="space-y-2">
        <p class="text-sm">{{ t('hardcover.connection.syncScope.title') }}</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="option in bookSyncModeOptions"
            :key="option.id"
            type="button"
            class="rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            :class="
              form.bookSyncMode === option.id
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
            "
            @click="selectBookSyncMode(option.id)"
          >
            <div class="text-sm font-medium">{{ option.label }}</div>
            <div class="mt-0.5 text-xs leading-relaxed">{{ option.description }}</div>
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">{{ t('hardcover.connection.enableSync.title') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ t('hardcover.connection.enableSync.description') }}</p>
        </div>
        <ToggleSwitch v-model="form.enabled" />
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">{{ t('hardcover.connection.syncOnStatus.title') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ t('hardcover.connection.syncOnStatus.description') }}</p>
        </div>
        <ToggleSwitch v-model="form.autoSyncOnStatusChange" :disabled="!form.enabled" />
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">{{ t('hardcover.connection.syncOnProgress.title') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ t('hardcover.connection.syncOnProgress.description') }}</p>
        </div>
        <ToggleSwitch v-model="form.autoSyncOnProgressUpdate" :disabled="!form.enabled" />
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">{{ t('hardcover.connection.syncOnRating.title') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ t('hardcover.connection.syncOnRating.description') }}</p>
        </div>
        <ToggleSwitch v-model="form.autoSyncOnRatingChange" :disabled="!form.enabled" />
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">{{ t('hardcover.connection.privacy.title') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ t('hardcover.connection.privacy.description') }}</p>
        </div>
        <select
          v-model="form.privacySettingId"
          class="rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          :disabled="!form.enabled"
        >
          <option v-for="opt in privacyOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
        </select>
      </div>
    </div>

    <div class="flex items-center justify-between pt-2 border-t border-border gap-2">
      <button
        v-if="settings?.tokenConfigured"
        type="button"
        :disabled="saving"
        class="flex items-center gap-1.5 text-xs text-destructive hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
        @click="handleDisconnect"
      >
        <Unlink class="size-3.5" />
        {{ t('hardcover.connection.disconnect') }}
      </button>
      <div class="flex-1" />
      <button
        type="button"
        :disabled="saving"
        class="flex items-center gap-1.5 px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        @click="handleSave"
      >
        <Loader2 v-if="saving" class="size-3.5 animate-spin" />
        <Save v-else class="size-3.5" />
        {{ t('common.save') }}
      </button>
    </div>
  </div>
</template>
