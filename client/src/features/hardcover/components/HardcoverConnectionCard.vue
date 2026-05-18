<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Link, Save, CheckCircle2, AlertCircle, Info, Loader2, Unlink } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useHardcoverSettings } from '../composables/useHardcoverSettings'

const { settings, saving, validating, error, fetchSettings, saveSettings, disconnect, validateToken } = useHardcoverSettings()

const tokenInput = ref('')
const tokenVisible = ref(false)
const validationResult = ref<{ valid: boolean; username?: string } | null>(null)

const form = reactive({
  enabled: true,
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
  autoSyncOnRatingChange: true,
  privacySettingId: 3,
})

onMounted(async () => {
  await fetchSettings()
  if (settings.value) {
    form.enabled = settings.value.enabled
    form.autoSyncOnStatusChange = settings.value.autoSyncOnStatusChange
    form.autoSyncOnProgressUpdate = settings.value.autoSyncOnProgressUpdate
    form.autoSyncOnRatingChange = settings.value.autoSyncOnRatingChange
    form.privacySettingId = settings.value.privacySettingId
  }
})

async function handleValidateToken() {
  if (!tokenInput.value.trim()) {
    toast.error('Enter your Hardcover API token first')
    return
  }
  const result = await validateToken(tokenInput.value.trim())
  validationResult.value = result
}

async function handleSave() {
  const ok = await saveSettings({
    ...(tokenInput.value.trim() ? { apiToken: tokenInput.value.trim() } : {}),
    enabled: form.enabled,
    autoSyncOnStatusChange: form.autoSyncOnStatusChange,
    autoSyncOnProgressUpdate: form.autoSyncOnProgressUpdate,
    autoSyncOnRatingChange: form.autoSyncOnRatingChange,
    privacySettingId: form.privacySettingId,
  })
  if (ok) {
    tokenInput.value = ''
    toast.success('Hardcover settings saved')
  } else {
    toast.error(error.value ?? 'Failed to save settings')
  }
}

async function handleDisconnect() {
  await disconnect()
  tokenInput.value = ''
  validationResult.value = null
  toast.success('Hardcover disconnected')
}

function toggleTokenVisible() {
  tokenVisible.value = !tokenVisible.value
}

const privacyOptions = [
  { id: 1, label: 'Public' },
  { id: 2, label: 'Followers only' },
  { id: 3, label: 'Private' },
]
</script>

<template>
  <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs space-y-5">
    <div class="flex items-center gap-3">
      <Link class="size-5 text-primary shrink-0" />
      <div>
        <p class="font-medium text-sm">Connection</p>
        <p class="text-xs text-muted-foreground mt-0.5">Connect your Hardcover account to sync reading data.</p>
      </div>
      <div v-if="settings?.tokenConfigured" class="ml-auto flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle2 class="size-3.5" />
        Connected
      </div>
    </div>

    <div class="space-y-2">
      <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider"> API Token </label>
      <div class="flex gap-2">
        <input
          v-model="tokenInput"
          :type="tokenVisible ? 'text' : 'password'"
          placeholder="Paste your Hardcover API token"
          class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
          autocomplete="off"
        />
        <button
          type="button"
          class="px-3 py-2 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
          @click="toggleTokenVisible"
        >
          {{ tokenVisible ? 'Hide' : 'Show' }}
        </button>
      </div>
      <p class="text-xs text-muted-foreground">
        Find your token at
        <a href="https://hardcover.app/account/api" target="_blank" rel="noopener" class="text-primary underline underline-offset-2"
          >hardcover.app/account/api</a
        >.
      </p>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        :disabled="validating || !tokenInput.trim()"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        @click="handleValidateToken"
      >
        <Loader2 v-if="validating" class="size-3 animate-spin" />
        Validate token
      </button>
      <span
        v-if="validationResult !== null"
        class="flex items-center gap-1 text-xs"
        :class="validationResult.valid ? 'text-green-600' : 'text-destructive'"
      >
        <CheckCircle2 v-if="validationResult.valid" class="size-3.5" />
        <AlertCircle v-else class="size-3.5" />
        {{ validationResult.valid ? `Valid (${validationResult.username})` : 'Invalid token' }}
      </span>
    </div>

    <div v-if="settings?.tokenConfigured" class="space-y-3 pt-2 border-t border-border">
      <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sync options</p>
      <div class="flex items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-2">
        <Info class="size-3.5 shrink-0 text-muted-foreground mt-0.5" />
        <p class="text-xs text-muted-foreground leading-relaxed">
          Sync runs only for books that are not unread. This applies to status, progress, and rating triggers. These switches control when a sync
          runs.
        </p>
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">Enable sync</p>
          <p class="text-xs text-muted-foreground mt-0.5">Pause all Hardcover syncing without disconnecting.</p>
        </div>
        <ToggleSwitch v-model="form.enabled" />
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">Sync on status change</p>
          <p class="text-xs text-muted-foreground mt-0.5">Push updates when you mark a book as reading, read, etc.</p>
        </div>
        <ToggleSwitch v-model="form.autoSyncOnStatusChange" :disabled="!form.enabled" />
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">Sync on progress update</p>
          <p class="text-xs text-muted-foreground mt-0.5">Push reading progress and dates when a session is saved.</p>
        </div>
        <ToggleSwitch v-model="form.autoSyncOnProgressUpdate" :disabled="!form.enabled" />
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">Sync on rating change</p>
          <p class="text-xs text-muted-foreground mt-0.5">Push your star ratings to Hardcover.</p>
        </div>
        <ToggleSwitch v-model="form.autoSyncOnRatingChange" :disabled="!form.enabled" />
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">Privacy</p>
          <p class="text-xs text-muted-foreground mt-0.5">Default visibility for synced books on Hardcover.</p>
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
        Disconnect
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
        Save
      </button>
    </div>
  </div>
</template>
