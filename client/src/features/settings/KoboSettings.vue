<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { Plus, Trash2, Copy, Check, Pencil, X, Tablet } from '@lucide/vue'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { copyToClipboard } from '@/lib/clipboard'
import { useKoboDevices } from '@/features/kobo/composables/useKoboDevices'
import { useKoboSettings } from '@/features/kobo/composables/useKoboSettings'
import type { KoboDevice } from '@bookorbit/types'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const { devices, fetchDevices, createDevice, renameDevice, revokeDevice } = useKoboDevices()
const { settings, fetchSettings, updateSettings } = useKoboSettings()

const loading = ref(true)
const error = ref<string | null>(null)

// Create device
const showCreateForm = ref(false)
const newDeviceName = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)

// New device token display
const newDeviceToken = ref<string | null>(null)
const newDeviceSyncUrl = ref<string | null>(null)

// Rename
const renamingId = ref<number | null>(null)
const renameValue = ref('')
const renaming = ref(false)

// Settings
const readingThreshold = ref(1)
const finishedThreshold = ref(99)
const convertToKepub = ref(true)
const forceEnableHyphenation = ref(false)
const kepubConversionLimitMb = ref(100)
const twoWayProgressSync = ref(false)
const syncBookOrbitAnnotationsToKobo = ref(false)
const savingSettings = ref(false)
const settingsError = ref<string | null>(null)

function applySettingsToLocal() {
  readingThreshold.value = settings.value.readingThreshold
  finishedThreshold.value = settings.value.finishedThreshold
  convertToKepub.value = settings.value.convertToKepub
  forceEnableHyphenation.value = settings.value.forceEnableHyphenation
  kepubConversionLimitMb.value = settings.value.kepubConversionLimitMb
  twoWayProgressSync.value = settings.value.twoWayProgressSync
  syncBookOrbitAnnotationsToKobo.value = settings.value.syncBookOrbitAnnotationsToKobo
}

function formatLastSeen(date: string | null): string {
  if (!date) return 'Never'
  const d = new Date(date)
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
    await Promise.all([fetchDevices(), fetchSettings()])
    applySettingsToLocal()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load'
  } finally {
    loading.value = false
  }
})

watch(twoWayProgressSync, (enabled) => {
  if (enabled) convertToKepub.value = true
})

watch(syncBookOrbitAnnotationsToKobo, (enabled) => {
  if (enabled) convertToKepub.value = true
})

async function submitCreate() {
  if (!newDeviceName.value.trim()) return
  creating.value = true
  createError.value = null
  try {
    const device = await createDevice(newDeviceName.value.trim())
    newDeviceToken.value = device.token
    newDeviceSyncUrl.value = `${window.location.origin}/api/v1/kobo/${device.token}`
    showCreateForm.value = false
    newDeviceName.value = ''
    toast.success(`Device "${device.name}" registered`)
  } catch (e) {
    createError.value = e instanceof Error ? e.message : 'Failed to create device'
    toast.error(createError.value ?? 'Failed to create device')
  } finally {
    creating.value = false
  }
}

function cancelCreate() {
  showCreateForm.value = false
  createError.value = null
  newDeviceName.value = ''
}

function dismissToken() {
  newDeviceToken.value = null
  newDeviceSyncUrl.value = null
}

async function copyToken() {
  if (!newDeviceSyncUrl.value) return
  const copied = await copyToClipboard(newDeviceSyncUrl.value)
  if (copied) {
    toast.success('Sync URL copied to clipboard')
  } else {
    toast.error('Failed to copy sync URL')
  }
}

function startRename(device: KoboDevice) {
  renamingId.value = device.id
  renameValue.value = device.name
}

function cancelRename() {
  renamingId.value = null
  renameValue.value = ''
}

async function submitRename(device: KoboDevice) {
  if (!renameValue.value.trim()) return
  renaming.value = true
  try {
    await renameDevice(device.id, renameValue.value.trim())
    toast.success('Device renamed')
    renamingId.value = null
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to rename device')
  } finally {
    renaming.value = false
  }
}

async function revoke(device: KoboDevice) {
  if (!confirm(`Revoke access for "${device.name}"? The device will not be able to sync until re-paired.`)) return
  try {
    await revokeDevice(device.id)
    toast.success(`Access revoked for "${device.name}"`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to revoke access')
  }
}

async function saveSettings() {
  if (readingThreshold.value >= finishedThreshold.value) {
    settingsError.value = 'Reading threshold must be less than finished threshold'
    toast.error(settingsError.value ?? 'Failed to save settings')
    return
  }
  savingSettings.value = true
  settingsError.value = null
  try {
    await updateSettings({
      readingThreshold: readingThreshold.value,
      finishedThreshold: finishedThreshold.value,
      convertToKepub: convertToKepub.value,
      forceEnableHyphenation: forceEnableHyphenation.value,
      kepubConversionLimitMb: kepubConversionLimitMb.value,
      twoWayProgressSync: twoWayProgressSync.value,
      syncBookOrbitAnnotationsToKobo: syncBookOrbitAnnotationsToKobo.value,
    })
    applySettingsToLocal()
    toast.success('Kobo sync settings saved')
  } catch (e) {
    settingsError.value = e instanceof Error ? e.message : 'Failed to save'
    toast.error(settingsError.value ?? 'Failed to save settings')
  } finally {
    savingSettings.value = false
  }
}
</script>

<template>
  <SettingsPageHeader v-if="!props.embedded" title="Kobo Sync" subtitle="Pair your Kobo device to sync your library." />

  <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>
  <div v-else-if="error" class="text-sm text-destructive">{{ error }}</div>
  <template v-else>
    <!-- New device token display -->
    <div v-if="newDeviceSyncUrl" class="mb-8 border-2 border-primary/30 rounded-lg p-4 bg-primary/5 shadow-xs">
      <div class="flex items-start justify-between gap-4 mb-3">
        <div class="flex items-center gap-2.5">
          <div class="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary shrink-0">
            <Check :size="13" stroke-width="3" />
          </div>
          <div>
            <p class="settings-label leading-none mb-0.5">Device paired successfully</p>
            <p class="settings-hint">You're ready to set up your Kobo. Follow the instructions below.</p>
          </div>
        </div>
        <button @click="dismissToken()" class="text-muted-foreground hover:text-foreground transition-colors p-1 shrink-0">
          <X :size="18" />
        </button>
      </div>

      <div class="space-y-4">
        <div class="bg-background rounded-lg border border-border p-4">
          <p class="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-2.5">Sync URL</p>
          <div class="flex items-center gap-2 px-3 py-2.5 rounded-md border border-border bg-muted/30">
            <Tablet :size="14" class="text-muted-foreground shrink-0" />
            <span class="flex-1 text-sm text-foreground font-mono select-all truncate min-w-0">{{ newDeviceSyncUrl }}</span>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors shrink-0"
              @click="copyToken()"
            >
              <Copy :size="12" />
              Copy
            </button>
          </div>
        </div>
        <div
          class="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-md border border-amber-200 dark:border-amber-900/50"
        >
          <X :size="14" class="shrink-0" />
          This URL will not be shown again. Keep it private.
        </div>
      </div>
    </div>

    <!-- Devices -->
    <div class="mb-8">
      <div class="flex items-center justify-between mb-3">
        <p class="settings-group-label mb-0">Registered Devices</p>
        <button v-if="!showCreateForm" class="settings-btn-primary" @click="showCreateForm = true">
          <Plus :size="12" />
          Add device
        </button>
      </div>

      <!-- Create form -->
      <div v-if="showCreateForm" class="border border-border rounded-lg p-5 bg-card mb-4 space-y-4 shadow-xs">
        <div>
          <label class="settings-label block mb-1.5">Device name</label>
          <input v-model="newDeviceName" type="text" placeholder="e.g. My Kobo Libra" autofocus class="input-field w-full" />
        </div>
        <div v-if="createError" class="text-xs text-destructive">{{ createError }}</div>
        <div class="flex items-center gap-2 pt-1">
          <button class="settings-btn-primary" :disabled="creating || !newDeviceName.trim()" @click="submitCreate()">
            {{ creating ? 'Creating...' : 'Create device' }}
          </button>
          <button class="settings-btn-outline" @click="cancelCreate()">Cancel</button>
        </div>
      </div>

      <div v-if="devices.length === 0 && !showCreateForm" class="border border-border rounded-lg px-5 py-10 bg-card text-center shadow-xs">
        <div class="w-10 h-10 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
          <Tablet :size="18" class="text-muted-foreground/70" />
        </div>
        <p class="text-sm font-medium text-foreground">No devices yet</p>
        <p class="text-xs text-muted-foreground mt-1 max-w-[240px] mx-auto">Add a device to start syncing your books to your Kobo.</p>
      </div>

      <div v-else-if="devices.length > 0" class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div v-for="device in devices" :key="device.id" class="px-5 py-4 bg-card transition-colors hover:bg-muted/30">
          <div v-if="renamingId === device.id" class="flex items-center gap-2">
            <input v-model="renameValue" type="text" class="flex-1 input-field" @keydown.enter="submitRename(device)" @keydown.esc="cancelRename()" />
            <button class="settings-btn-primary" :disabled="renaming || !renameValue.trim()" @click="submitRename(device)">Save</button>
            <button class="settings-btn-outline h-9 w-9 p-0 flex items-center justify-center" @click="cancelRename()">
              <X :size="14" />
            </button>
          </div>
          <div v-else class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0 border border-border">
              <Tablet :size="16" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="settings-label truncate leading-none mb-1.5">{{ device.name }}</p>
              <p class="settings-hint leading-none">Last sync: {{ formatLastSeen(device.lastSeenAt) }}</p>
            </div>
            <div class="flex items-center gap-1">
              <button
                class="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                @click="startRename(device)"
                title="Rename device"
              >
                <Pencil :size="14" />
              </button>
              <button
                class="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                @click="revoke(device)"
                title="Revoke access"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Sync settings -->
    <div class="mb-8">
      <p class="settings-group-label">Sync Preferences</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">Two-way progress sync</p>
            <p class="settings-hint">
              Sync reading position between BookOrbit and Kobo. Requires KEPUB delivery for precise locations and reliable page restore.
            </p>
          </div>
          <ToggleSwitch v-model="twoWayProgressSync" />
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">Sync BookOrbit highlights to Kobo</p>
            <p class="settings-hint">
              Send highlights made in BookOrbit or KOReader to your Kobo. Kobo highlights are imported into BookOrbit even when this is off. Linked
              annotations sync edits and deletes both ways. Requires KEPUB delivery; the book on Kobo must be the KEPUB downloaded from BookOrbit.
            </p>
          </div>
          <ToggleSwitch v-model="syncBookOrbitAnnotationsToKobo" />
        </div>

        <div class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">Convert to KEPUB</p>
            <p class="settings-hint">
              Send eligible EPUBs as KEPUB. This stays on when progress sync or BookOrbit-to-Kobo highlights are enabled. On the next Kobo sync,
              affected books are offered again as KEPUB downloads; remove any old EPUB copy if Kobo keeps opening it.
            </p>
          </div>
          <ToggleSwitch v-model="convertToKepub" :disabled="twoWayProgressSync || syncBookOrbitAnnotationsToKobo" />
        </div>

        <div v-if="convertToKepub" class="flex items-center justify-between px-5 py-4 bg-card">
          <div class="pr-8">
            <p class="settings-label">Force hyphenation</p>
            <p class="settings-hint">Ensures consistent text justification. This will regenerate cached KEPUBs.</p>
          </div>
          <ToggleSwitch v-model="forceEnableHyphenation" />
        </div>

        <div class="px-5 py-5 bg-card space-y-5">
          <div>
            <p class="settings-label mb-1">Progress Thresholds</p>
            <p class="settings-hint">Define when Kobo reading progress updates your library status.</p>
          </div>

          <div class="grid sm:grid-cols-2 gap-6">
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">Mark as Reading</label>
                <span class="text-xs font-mono text-primary font-bold">{{ readingThreshold }}%</span>
              </div>
              <input v-model.number="readingThreshold" type="range" min="0.5" max="10" step="0.5" class="w-full accent-primary cursor-pointer" />
              <p class="text-[12px] text-muted-foreground leading-tight">Minimum percentage to move a book to "Reading".</p>
            </div>
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <label class="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">Mark as Finished</label>
                <span class="text-xs font-mono text-primary font-bold">{{ finishedThreshold }}%</span>
              </div>
              <input v-model.number="finishedThreshold" type="range" min="75" max="100" step="1" class="w-full accent-primary cursor-pointer" />
              <p class="text-[12px] text-muted-foreground leading-tight">Percentage threshold to mark a book as "Finished".</p>
            </div>
          </div>

          <div>
            <div class="flex items-center justify-between mb-2">
              <label class="text-[12px] font-bold text-muted-foreground uppercase tracking-widest">KEPUB conversion limit</label>
              <span class="text-xs font-mono text-primary font-bold">{{ kepubConversionLimitMb }} MB</span>
            </div>
            <input v-model.number="kepubConversionLimitMb" type="range" min="1" max="500" step="5" class="w-full accent-primary cursor-pointer" />
            <p class="text-[12px] text-muted-foreground mt-2">
              Books above this limit are sent as regular EPUBs, so BookOrbit will not sync their reader position back to Kobo.
            </p>
          </div>
        </div>

        <div class="px-5 py-4 bg-muted/30 flex items-center justify-between">
          <div v-if="settingsError" class="text-xs text-destructive font-medium flex items-center gap-1.5"><X :size="14" /> {{ settingsError }}</div>
          <div v-else class="text-[12px] text-muted-foreground italic">Changes must be saved to take effect.</div>

          <button class="settings-btn-primary" :disabled="savingSettings" @click="saveSettings()">
            {{ savingSettings ? 'Saving...' : 'Save Sync Settings' }}
          </button>
        </div>
      </div>
    </div>
  </template>
</template>
