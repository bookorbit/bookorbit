<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { CloudDownload, HelpCircle, CheckCircle, XCircle, Loader } from 'lucide-vue-next'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { api } from '@/lib/api'

const enabled = ref(false)
const url = ref('')
const externalUrl = ref('')
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const testResult = ref<'success' | 'error' | null>(null)

function handleUpdateEnabled(val: boolean) {
  enabled.value = val
}

function handleInputUrl() {
  testResult.value = null
}

onMounted(async () => {
  try {
    const res = await api('/api/v1/user-preferences/shelfmark')
    if (res.ok) {
      const data = await res.json()
      enabled.value = data.settings?.enabled ?? false
      url.value = data.settings?.url ?? ''
      externalUrl.value = data.settings?.externalUrl ?? ''
    } else {
      toast.error('Failed to load Shelfmark settings')
    }
  } catch {
    toast.error('Failed to load Shelfmark settings')
  } finally {
    loading.value = false
  }
})

async function testConnection() {
  const trimmedUrl = url.value.trim()
  if (!trimmedUrl) {
    toast.error('Please enter a Shelfmark URL before testing')
    return
  }
  testing.value = true
  testResult.value = null
  try {
    const res = await api('/api/v1/user-preferences/shelfmark/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: trimmedUrl }),
    })
    const data = await res.json()
    testResult.value = data.ok ? 'success' : 'error'
    if (data.ok) {
      toast.success('Connection successful')
    } else {
      toast.error(data.error ? `Connection failed: ${data.error}` : `Connection failed (HTTP ${data.status})`)
    }
  } catch {
    testResult.value = 'error'
    toast.error('Connection failed — check the URL and try again')
  } finally {
    testing.value = false
  }
}

async function saveSettings() {
  saving.value = true
  try {
    const res = await api('/api/v1/user-preferences/shelfmark', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: {
          enabled: enabled.value,
          url: url.value.trim(),
          externalUrl: externalUrl.value.trim() || undefined,
        },
      }),
    })
    if (res.ok) {
      toast.success('Shelfmark settings saved')
    } else {
      toast.error('Failed to save Shelfmark settings')
    }
  } catch {
    toast.error('Failed to save Shelfmark settings')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SettingsPageHeader
    class="hidden md:flex"
    title="Shelfmark Integration"
    subtitle="Configure Shelfmark to search and download books that are not in your library."
  />
  <div class="md:hidden px-1 mb-6">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">Shelfmark Integration</h1>
    <p class="mt-1 text-sm text-muted-foreground leading-5">Configure Shelfmark to search and download books that are not in your library.</p>
  </div>

  <div v-if="loading" class="mt-5 md:mt-0 text-sm text-muted-foreground">Loading...</div>
  <template v-else>
    <div class="space-y-6">
      <!-- Enable Toggle -->
      <div class="border border-border rounded-lg overflow-hidden shadow-xs">
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">Enable Shelfmark Integration</p>
            <p class="settings-hint">Search external metadata providers and show download links to Shelfmark</p>
          </div>
          <ToggleSwitch :model-value="enabled" @update:model-value="handleUpdateEnabled" />
        </div>
      </div>

      <!-- Settings Form -->
      <div v-if="enabled" class="border border-border rounded-lg p-4 md:p-5 bg-card space-y-5 shadow-xs">
        <!-- Integration URL -->
        <div>
          <label class="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Shelfmark URL</label>
          <div class="flex gap-2">
            <input
              v-model="url"
              type="url"
              placeholder="e.g. http://localhost:8080 or http://shelfmark.local"
              class="input-field w-full"
              @input="handleInputUrl"
            />
            <button
              type="button"
              class="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border border-border bg-card hover:bg-accent transition-colors disabled:opacity-50"
              :disabled="testing || !url.trim()"
              @click="testConnection"
            >
              <Loader v-if="testing" :size="13" class="animate-spin" />
              <CheckCircle v-else-if="testResult === 'success'" :size="13" class="text-emerald-500" />
              <XCircle v-else-if="testResult === 'error'" :size="13" class="text-destructive" />
              <CloudDownload v-else :size="13" />
              {{ testing ? 'Testing…' : 'Test Connection' }}
            </button>
          </div>
          <p class="mt-1.5 text-xs text-muted-foreground">
            The URL of your self-hosted Shelfmark instance. Used for both metadata search and as the fallback link target.
          </p>
        </div>

        <!-- External URL (optional) -->
        <div>
          <label class="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            External URL
            <span class="ml-1.5 normal-case font-normal text-muted-foreground/70">(optional)</span>
          </label>
          <input v-model="externalUrl" type="url" placeholder="e.g. https://shelfmark.example.com" class="input-field w-full" />
          <p class="mt-1.5 text-xs text-muted-foreground">
            If set, this URL is used when opening a search result in a new tab instead of the Shelfmark URL above. Useful when Shelfmark is accessible
            internally but exposed under a different public address.
          </p>
        </div>

        <div class="border border-amber-500/25 bg-amber-500/10 rounded-lg p-3 flex gap-2.5 items-start">
          <HelpCircle :size="16" class="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p class="text-xs text-amber-700 dark:text-amber-300 leading-normal">
            <strong>Seamless Experience Note:</strong> You need to set up Shelfmark to download books in the same directory as the bookorbit service
            has mounted as the bookdock directory if you want a seamless experience.
          </p>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex items-center gap-3 pt-2">
        <button
          class="px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          :disabled="saving"
          @click="saveSettings"
        >
          {{ saving ? 'Saving...' : 'Save Settings' }}
        </button>
      </div>
    </div>
  </template>
</template>
