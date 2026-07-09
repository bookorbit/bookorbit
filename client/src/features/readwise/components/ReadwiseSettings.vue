<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { Link, Save, CheckCircle2, AlertCircle, Info, Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { ReadwiseSyncDisabledReason, ReadwiseTokenValidationResult } from '@bookorbit/types'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useReadwiseSettings } from '../composables/useReadwiseSettings'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { settings, saving, validating, error, fetchSettings, saveSettings, validateToken } = useReadwiseSettings()

const tokenInput = ref('')
const tokenVisible = ref(false)
const tokenInputId = 'readwise-access-token'
const validationResult = ref<ReadwiseTokenValidationResult | null>(null)

const form = reactive({
  enabled: false,
})

const disabledReasonMessages: Record<ReadwiseSyncDisabledReason, string> = {
  permission_denied: "Your account doesn't have Readwise sync permission.",
  missing_token: 'Add your Readwise access token to start syncing.',
  user_disabled: 'Sync is turned off.',
  invalid_token: 'Your Readwise token was rejected. Paste a new one and re-enable.',
}

onMounted(async () => {
  await fetchSettings()
  form.enabled = settings.value?.enabled ?? false
})

async function handleValidateToken() {
  const token = tokenInput.value.trim()
  if (!token && !settings.value?.tokenConfigured) {
    toast.error('Enter your Readwise access token first')
    return
  }
  const result = await validateToken(token || undefined)
  validationResult.value = result
}

async function handleSave() {
  const ok = await saveSettings({
    ...(tokenInput.value.trim() ? { apiToken: tokenInput.value.trim() } : {}),
    enabled: form.enabled,
  })
  if (ok) {
    tokenInput.value = ''
    toast.success('Readwise settings saved')
  } else {
    toast.error(error.value ?? 'Failed to save settings')
  }
}

function toggleTokenVisible() {
  tokenVisible.value = !tokenVisible.value
}
</script>

<template>
  <div class="space-y-6">
    <SettingsPageHeader v-if="!props.embedded" title="Readwise" subtitle="Send your highlights to Readwise automatically." />

    <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs space-y-5">
      <div class="flex items-center gap-3">
        <Link class="size-5 text-primary shrink-0" />
        <div>
          <p class="font-medium text-sm">Connection</p>
          <p class="text-xs text-muted-foreground mt-0.5">Connect your Readwise account to sync your highlights.</p>
        </div>
        <div v-if="settings?.tokenConfigured" class="ml-auto flex items-center gap-1.5 text-xs text-primary">
          <CheckCircle2 class="size-3.5" />
          Connected
        </div>
      </div>

      <div v-if="error" class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2">
        <AlertCircle class="size-3.5 shrink-0 text-destructive mt-0.5" />
        <p class="text-xs text-destructive leading-relaxed">{{ error }}</p>
      </div>

      <div v-if="settings?.disabledReason" class="flex items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-2">
        <Info class="size-3.5 shrink-0 text-muted-foreground mt-0.5" />
        <p class="text-xs text-muted-foreground leading-relaxed">
          {{ disabledReasonMessages[settings.disabledReason] }}
        </p>
      </div>

      <div class="space-y-2">
        <label :for="tokenInputId" class="text-xs font-medium text-muted-foreground uppercase tracking-wider"> Access Token </label>
        <div class="flex gap-2">
          <input
            :id="tokenInputId"
            v-model="tokenInput"
            :type="tokenVisible ? 'text' : 'password'"
            placeholder="Paste your Readwise access token"
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
          <a href="https://readwise.io/access_token" target="_blank" rel="noopener" class="text-primary underline underline-offset-2"
            >readwise.io/access_token</a
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
          Test
        </button>
        <span
          v-if="validationResult !== null"
          class="flex items-center gap-1 text-xs"
          :class="validationResult.valid ? 'text-primary' : 'text-destructive'"
        >
          <CheckCircle2 v-if="validationResult.valid" class="size-3.5" />
          <AlertCircle v-else class="size-3.5" />
          {{ validationResult.valid ? 'Valid token' : 'Invalid token' }}
        </span>
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-border">
        <div>
          <p class="text-sm">Enable sync</p>
          <p class="text-xs text-muted-foreground mt-0.5">Automatically send your highlights to Readwise.</p>
        </div>
        <ToggleSwitch v-model="form.enabled" />
      </div>

      <div class="flex items-center justify-end pt-2 border-t border-border">
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
  </div>
</template>
