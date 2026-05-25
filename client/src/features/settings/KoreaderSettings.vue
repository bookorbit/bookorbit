<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Copy, Trash2, BookOpen, Smartphone, Check, Eye, EyeOff, RefreshCw, ChevronDown, ChevronUp } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import SettingsPageHeader from './SettingsPageHeader.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useKoreaderSync } from '@/features/koreader/composables/useKoreaderSync'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { credentials, syncStatus, loading, fetchSyncStatus, createCredentials, updateCredentials, deleteCredentials, getSyncUrl } = useKoreaderSync()

const error = ref<string | null>(null)
const showSetupForm = ref(false)
const newUsername = ref('')
const newPassword = ref('')
const creating = ref(false)
const showPassword = ref(false)
const deleteConfirmOpen = ref(false)
const helpOpen = ref(true)
const urlCopied = ref(false)

let urlCopiedTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  if (urlCopiedTimer) clearTimeout(urlCopiedTimer)
})

const syncUrl = computed(() => getSyncUrl())
const hasCredentials = computed(() => !!credentials.value)
const deviceCount = computed(() => syncStatus.value?.devices.length ?? 0)
const totalSyncedBooks = computed(() => syncStatus.value?.totalSyncedBooks ?? 0)

function formatLastSync(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

onMounted(async () => {
  try {
    await fetchSyncStatus()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load KOReader settings'
  }
})

async function handleCreate() {
  creating.value = true
  try {
    await createCredentials({ username: newUsername.value, password: newPassword.value })
    showSetupForm.value = false
    newUsername.value = ''
    newPassword.value = ''
    toast.success('KOReader sync credentials created')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to create credentials')
  } finally {
    creating.value = false
  }
}

function handleShowSetupForm() {
  showSetupForm.value = true
}

function handleCancelSetup() {
  showSetupForm.value = false
}

function handleTogglePassword() {
  showPassword.value = !showPassword.value
}

function handleOpenDeleteConfirm() {
  deleteConfirmOpen.value = true
}

function handleCloseDeleteConfirm() {
  deleteConfirmOpen.value = false
}

function handleToggleHelp() {
  helpOpen.value = !helpOpen.value
}

async function handleToggleSync(newValue: boolean) {
  try {
    await updateCredentials({ syncEnabled: newValue })
    toast.success(`KOReader sync ${newValue ? 'enabled' : 'disabled'}`)
  } catch {
    toast.error('Failed to toggle sync')
  }
}

async function handleDelete() {
  try {
    await deleteCredentials()
    deleteConfirmOpen.value = false
    toast.success('KOReader credentials deleted')
  } catch {
    toast.error('Failed to delete credentials')
  }
}

async function handleCopyUrl() {
  await navigator.clipboard.writeText(syncUrl.value)
  urlCopied.value = true
  toast.success('Sync URL copied to clipboard')
  if (urlCopiedTimer) clearTimeout(urlCopiedTimer)
  urlCopiedTimer = setTimeout(() => {
    urlCopied.value = false
    urlCopiedTimer = null
  }, 2000)
}

async function handleRefresh() {
  try {
    await fetchSyncStatus()
    toast.success('Sync status refreshed')
  } catch {
    toast.error('Failed to refresh')
  }
}
</script>

<template>
  <SettingsPageHeader
    v-if="!props.embedded"
    class="hidden md:flex"
    title="KOReader Sync"
    subtitle="Sync reading progress between KOReader devices and BookOrbit."
  />
  <div v-if="!props.embedded" class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">KOReader Sync</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      Sync reading progress between KOReader devices and BookOrbit.
    </p>
  </div>

  <div v-if="loading" class="mt-5 md:mt-0 text-sm text-muted-foreground">Loading...</div>
  <div v-else-if="error" class="text-sm text-destructive">{{ error }}</div>
  <template v-else>
    <!-- No credentials setup -->
    <template v-if="!hasCredentials">
      <div v-if="!showSetupForm" class="border border-border rounded-lg px-5 py-8 bg-card text-center shadow-xs">
        <BookOpen :size="32" class="mx-auto text-muted-foreground mb-3" />
        <p class="text-sm font-medium text-foreground mb-1">KOReader sync is not configured</p>
        <p class="text-xs text-muted-foreground mb-4">Create credentials to sync reading progress with your KOReader devices.</p>
        <button
          class="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          @click="handleShowSetupForm"
        >
          Set up KOReader Sync
        </button>
      </div>

      <!-- Setup form -->
      <div v-else class="border border-border rounded-lg p-4 md:p-5 bg-card space-y-4 shadow-xs">
        <p class="text-sm font-medium text-foreground">Create KOReader Sync Credentials</p>
        <p class="text-xs text-muted-foreground">These credentials are used by your KOReader device to authenticate with the sync server.</p>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">Username</label>
          <input v-model="newUsername" type="text" placeholder="e.g. myreader" class="input-field w-full" autocomplete="off" />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
          <div class="relative">
            <input
              v-model="newPassword"
              :type="showPassword ? 'text' : 'password'"
              placeholder="Min 6 characters"
              class="input-field w-full pr-10"
              autocomplete="new-password"
            />
            <button class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" @click="handleTogglePassword">
              <EyeOff v-if="showPassword" :size="14" />
              <Eye v-else :size="14" />
            </button>
          </div>
        </div>
        <div class="hidden md:flex items-center gap-2 pt-1">
          <button
            class="px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            :disabled="creating || !newUsername || newPassword.length < 6"
            @click="handleCreate"
          >
            {{ creating ? 'Creating...' : 'Create' }}
          </button>
          <button
            class="px-4 py-2 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
            @click="handleCancelSetup"
          >
            Cancel
          </button>
        </div>
        <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
          <div class="flex items-center gap-2">
            <button
              class="settings-btn-primary flex-1 min-h-10 justify-center"
              :disabled="creating || !newUsername || newPassword.length < 6"
              @click="handleCreate"
            >
              {{ creating ? 'Creating...' : 'Create' }}
            </button>
            <button
              class="rounded-md border border-border px-3 min-h-10 text-sm text-foreground hover:bg-muted transition-colors"
              @click="handleCancelSetup"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Credentials configured -->
    <template v-else>
      <!-- Sync Toggle -->
      <div class="mb-6">
        <p class="settings-group-label">Sync</p>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs">
          <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
            <div class="min-w-0">
              <p class="settings-label">Progress Sync</p>
              <p class="settings-hint">Automatically sync reading progress between KOReader and BookOrbit</p>
            </div>
            <ToggleSwitch :model-value="credentials?.syncEnabled ?? false" class="self-start md:self-auto" @update:model-value="handleToggleSync" />
          </div>
        </div>
      </div>

      <!-- Sync URL -->
      <div class="mb-6">
        <p class="settings-group-label">Sync Server URL</p>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs">
          <div class="flex flex-col md:flex-row md:items-center gap-2 px-4 py-3.5 md:px-5 md:py-4 bg-card">
            <BookOpen :size="14" class="text-muted-foreground shrink-0 hidden md:block" />
            <input
              :value="syncUrl"
              readonly
              class="flex-1 text-sm bg-transparent text-foreground outline-none select-all min-w-0 truncate font-mono"
            />
            <button
              class="w-full md:w-auto flex items-center justify-center gap-1.5 px-3 py-2 md:py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors shrink-0"
              @click="handleCopyUrl"
            >
              <Check v-if="urlCopied" :size="12" class="text-green-500" />
              <Copy v-else :size="12" />
              {{ urlCopied ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Account Info -->
      <div class="mb-6">
        <div class="flex items-center justify-between mb-3">
          <p class="settings-group-label mb-0">Account</p>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
            @click="handleRefresh"
          >
            <RefreshCw :size="12" />
            Refresh
          </button>
        </div>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div class="flex items-center justify-between px-4 py-3.5 bg-card md:px-5">
            <div>
              <p class="settings-label">Username</p>
              <p class="settings-hint font-mono">{{ credentials?.username }}</p>
            </div>
          </div>
          <div class="flex items-center justify-between px-4 py-3.5 bg-card md:px-5">
            <div>
              <p class="settings-label">Synced Books</p>
              <p class="settings-hint">{{ totalSyncedBooks }} {{ totalSyncedBooks === 1 ? 'book' : 'books' }}</p>
            </div>
          </div>
          <div class="flex items-center justify-between px-4 py-3.5 bg-card md:px-5">
            <div>
              <p class="settings-label">Last Sync</p>
              <p class="settings-hint">{{ formatLastSync(syncStatus?.lastSyncAt ?? null) }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- Devices -->
      <div v-if="deviceCount > 0" class="mb-6">
        <p class="settings-group-label">Devices</p>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div v-for="device in syncStatus?.devices ?? []" :key="device.deviceId" class="flex items-center gap-3 px-4 py-3.5 bg-card md:px-5">
            <Smartphone :size="16" class="text-muted-foreground shrink-0" />
            <div class="flex-1 min-w-0">
              <p class="settings-label truncate">{{ device.device }}</p>
              <p class="settings-hint">
                Last sync: {{ formatLastSync(device.lastSyncAt)
                }}<template v-if="device.lastBookTitle"> &middot; {{ device.lastBookTitle }}</template>
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="mb-6">
        <p class="settings-group-label">Danger Zone</p>
        <div class="border border-destructive/30 rounded-lg overflow-hidden shadow-xs">
          <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
            <div class="min-w-0">
              <p class="settings-label">Delete KOReader Credentials</p>
              <p class="settings-hint">Remove sync credentials and disconnect all devices. Progress data will be retained.</p>
            </div>
            <button
              class="self-start md:self-auto flex items-center gap-1.5 px-3 py-2 md:py-1.5 text-xs font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shrink-0"
              @click="handleOpenDeleteConfirm"
            >
              <Trash2 :size="12" />
              Delete
            </button>
          </div>
        </div>
      </div>

      <!-- Setup Guide -->
      <div class="border border-border rounded-lg bg-card/50 shadow-xs">
        <button class="w-full flex items-center justify-between gap-2 p-4 text-left" @click="handleToggleHelp">
          <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Setup Guide</p>
          <ChevronUp v-if="helpOpen" :size="14" class="text-muted-foreground" />
          <ChevronDown v-else :size="14" class="text-muted-foreground" />
        </button>
        <div v-if="helpOpen" class="px-4 pb-4 space-y-3 text-xs text-muted-foreground">
          <p class="font-medium text-foreground/80">To configure KOReader:</p>
          <ol class="list-decimal list-inside space-y-2 pl-1">
            <li>On your KOReader device, go to <span class="font-mono text-foreground/70">Tools > Progress sync</span></li>
            <li>Set the custom sync server to the URL shown above</li>
            <li>Enter the username and password you created</li>
            <li>Tap "Register" (first time) or "Login" to connect</li>
          </ol>
          <p class="pt-1">Reading progress will sync automatically when you open and close books.</p>
        </div>
      </div>

      <div class="mt-4">
        <p class="settings-group-label">Sync Accuracy</p>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs">
          <div class="px-4 py-3.5 bg-card md:px-5">
            <p class="settings-label">Cross-reader compatibility</p>
            <p class="settings-hint">
              KOReader and BookOrbit use different internal progress formats, so cross-reader location restore is not fully compatible. KOReader to
              BookOrbit is typically more precise, while BookOrbit to KOReader for EPUB usually resumes at chapter level.
            </p>
          </div>
        </div>
      </div>
    </template>

    <!-- Delete Confirmation Modal -->
    <div
      v-if="deleteConfirmOpen"
      class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
      @click.self="handleCloseDeleteConfirm"
    >
      <button class="absolute inset-0 bg-black/45" @click="handleCloseDeleteConfirm" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">Delete KOReader credentials?</p>
        <p class="mt-1 text-sm text-muted-foreground">
          This will remove your sync credentials and disconnect all KOReader devices. Existing progress data will be kept.
        </p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="handleCloseDeleteConfirm"
          >
            Cancel
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            @click="handleDelete"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </template>
</template>
