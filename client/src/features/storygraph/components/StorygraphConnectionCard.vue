<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { Link, Save, CheckCircle2, AlertCircle, Info, Loader2, Unlink } from '@lucide/vue'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useStorygraphSettings } from '../composables/useStorygraphSettings'

const { settings, saving, validating, error, fetchSettings, saveSettings, disconnect, validateCookies } = useStorygraphSettings()

const sessionCookieInput = ref('')
const rememberTokenInput = ref('')
const cookiesVisible = ref(false)
const validationResult = ref<{ valid: boolean } | null>(null)

const form = reactive({
  enabled: true,
  bookSyncMode: 'all_eligible' as 'all_eligible' | 'selected_only',
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
})

onMounted(async () => {
  await fetchSettings()
  if (settings.value) {
    form.enabled = settings.value.enabled
    form.bookSyncMode = settings.value.bookSyncMode
    form.autoSyncOnStatusChange = settings.value.autoSyncOnStatusChange
    form.autoSyncOnProgressUpdate = settings.value.autoSyncOnProgressUpdate
  }
})

// A lingering result would misrepresent edited values, so any input change resets it.
watch([sessionCookieInput, rememberTokenInput], () => {
  validationResult.value = null
})

async function handleValidateCookies() {
  if (!sessionCookieInput.value.trim() || !rememberTokenInput.value.trim()) {
    toast.error('Enter both cookie values first')
    return
  }
  const result = await validateCookies(sessionCookieInput.value.trim(), rememberTokenInput.value.trim())
  validationResult.value = result
}

async function handleSave() {
  const hasNewCookies = sessionCookieInput.value.trim() && rememberTokenInput.value.trim()
  if (!hasNewCookies && (sessionCookieInput.value.trim() || rememberTokenInput.value.trim())) {
    toast.error('Enter both cookie values to update the connection')
    return
  }
  const ok = await saveSettings({
    ...(hasNewCookies ? { sessionCookie: sessionCookieInput.value.trim(), rememberToken: rememberTokenInput.value.trim() } : {}),
    enabled: form.enabled,
    bookSyncMode: form.bookSyncMode,
    autoSyncOnStatusChange: form.autoSyncOnStatusChange,
    autoSyncOnProgressUpdate: form.autoSyncOnProgressUpdate,
  })
  if (ok) {
    sessionCookieInput.value = ''
    rememberTokenInput.value = ''
    toast.success('StoryGraph settings saved')
  } else {
    toast.error(error.value ?? 'Failed to save settings')
  }
}

async function handleDisconnect() {
  await disconnect()
  sessionCookieInput.value = ''
  rememberTokenInput.value = ''
  validationResult.value = null
  toast.success('StoryGraph disconnected')
}

function toggleCookiesVisible() {
  cookiesVisible.value = !cookiesVisible.value
}

const bookSyncModeOptions = [
  {
    id: 'all_eligible' as const,
    label: 'All eligible books',
    description: 'StoryGraph sync runs for every eligible book unless you exclude it on the book details page.',
  },
  {
    id: 'selected_only' as const,
    label: 'Selected books only',
    description: 'StoryGraph sync only runs for books you turn on from the book details page.',
  },
]

function selectBookSyncMode(mode: 'all_eligible' | 'selected_only') {
  form.bookSyncMode = mode
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs space-y-5">
    <div class="flex items-center gap-3">
      <Link class="size-5 text-primary shrink-0" />
      <div>
        <p class="font-medium text-sm">Connection</p>
        <p class="text-xs text-muted-foreground mt-0.5">Connect your StoryGraph account to sync reading data.</p>
      </div>
      <div v-if="settings?.cookiesConfigured" class="ml-auto flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle2 class="size-3.5" />
        Connected
      </div>
    </div>

    <div class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
      <Info class="size-3.5 shrink-0 text-amber-600 mt-0.5" />
      <p class="text-xs text-amber-700 leading-relaxed">
        StoryGraph has no public API. This integration works by reusing two cookies from your own logged-in browser session, the same approach used by
        community KOReader plugins. It can break if StoryGraph changes their site, and you may occasionally need to re-paste fresh cookie values.
      </p>
    </div>

    <div class="space-y-3">
      <ol class="text-xs text-muted-foreground leading-relaxed list-decimal list-inside space-y-1">
        <li>
          Log in at
          <a href="https://app.thestorygraph.com" target="_blank" rel="noopener" class="text-primary underline underline-offset-2"
            >app.thestorygraph.com</a
          >
          in your browser.
        </li>
        <li>Open Developer Tools (F12) and go to Application/Storage &rarr; Cookies for that site.</li>
        <li>
          Copy the values of the <code class="px-1 rounded bg-muted">_storygraph_session</code> and
          <code class="px-1 rounded bg-muted">remember_user_token</code> cookies below.
        </li>
      </ol>

      <div class="space-y-2">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">_storygraph_session</label>
        <div class="flex gap-2">
          <input
            v-model="sessionCookieInput"
            :type="cookiesVisible ? 'text' : 'password'"
            placeholder="Paste the _storygraph_session cookie value"
            class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            autocomplete="off"
          />
        </div>
      </div>

      <div class="space-y-2">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">remember_user_token</label>
        <div class="flex gap-2">
          <input
            v-model="rememberTokenInput"
            :type="cookiesVisible ? 'text' : 'password'"
            placeholder="Paste the remember_user_token cookie value"
            class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            autocomplete="off"
          />
          <button
            type="button"
            class="px-3 py-2 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
            @click="toggleCookiesVisible"
          >
            {{ cookiesVisible ? 'Hide' : 'Show' }}
          </button>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button
        type="button"
        :disabled="validating || !sessionCookieInput.trim() || !rememberTokenInput.trim()"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        @click="handleValidateCookies"
      >
        <Loader2 v-if="validating" class="size-3 animate-spin" />
        Validate cookies
      </button>
      <span
        v-if="validationResult !== null"
        class="flex items-center gap-1 text-xs"
        :class="validationResult.valid ? 'text-green-600' : 'text-destructive'"
      >
        <CheckCircle2 v-if="validationResult.valid" class="size-3.5" />
        <AlertCircle v-else class="size-3.5" />
        {{ validationResult.valid ? 'Valid' : 'Invalid or expired cookies' }}
      </span>
    </div>

    <div v-if="settings?.cookiesConfigured" class="space-y-3 pt-2 border-t border-border">
      <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sync options</p>
      <div class="flex items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-2">
        <Info class="size-3.5 shrink-0 text-muted-foreground mt-0.5" />
        <p class="text-xs text-muted-foreground leading-relaxed">
          Sync runs only for books that are not unread. This applies to status and progress triggers. These switches control when a sync runs.
        </p>
      </div>

      <div class="space-y-2">
        <div>
          <p class="text-sm">Book sync scope</p>
          <p class="text-xs text-muted-foreground mt-0.5">Choose whether StoryGraph sync starts broadly or only for books you pick.</p>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="option in bookSyncModeOptions"
            :key="option.id"
            type="button"
            class="rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!form.enabled"
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
          <p class="text-sm">Enable sync</p>
          <p class="text-xs text-muted-foreground mt-0.5">Pause all StoryGraph syncing without disconnecting.</p>
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
          <p class="text-xs text-muted-foreground mt-0.5">Push reading progress when BookOrbit or KOReader progress changes.</p>
        </div>
        <ToggleSwitch v-model="form.autoSyncOnProgressUpdate" :disabled="!form.enabled" />
      </div>
    </div>

    <div class="flex items-center justify-between pt-2 border-t border-border gap-2">
      <button
        v-if="settings?.cookiesConfigured"
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
