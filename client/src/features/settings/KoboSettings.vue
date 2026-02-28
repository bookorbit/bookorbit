<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Plus, Trash2, Copy, Check, Pencil, X, Tablet } from 'lucide-vue-next'
import { useKoboDevices } from '@/features/kobo/composables/useKoboDevices'
import { useKoboSettings } from '@/features/kobo/composables/useKoboSettings'
import type { KoboDevice } from '@projectx/types'

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
const tokenCopied = ref(false)

// Rename
const renamingId = ref<number | null>(null)
const renameValue = ref('')
const renaming = ref(false)

// Settings
const readingThreshold = ref(1)
const finishedThreshold = ref(99)
const convertToKepub = ref(true)
const twoWayProgressSync = ref(false)
const forceEnableHyphenation = ref(false)
const kepubConversionLimitMb = ref(100)
const savingSettings = ref(false)
const settingsError = ref<string | null>(null)

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
    readingThreshold.value = settings.value.readingThreshold
    finishedThreshold.value = settings.value.finishedThreshold
    convertToKepub.value = settings.value.convertToKepub
    twoWayProgressSync.value = settings.value.twoWayProgressSync
    forceEnableHyphenation.value = settings.value.forceEnableHyphenation
    kepubConversionLimitMb.value = settings.value.kepubConversionLimitMb
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load'
  } finally {
    loading.value = false
  }
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
  } catch (e) {
    createError.value = e instanceof Error ? e.message : 'Failed to create device'
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
  tokenCopied.value = false
}

async function copyToken() {
  if (!newDeviceSyncUrl.value) return
  await navigator.clipboard.writeText(newDeviceSyncUrl.value)
  tokenCopied.value = true
  setTimeout(() => (tokenCopied.value = false), 2000)
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
    renamingId.value = null
  } finally {
    renaming.value = false
  }
}

async function revoke(device: KoboDevice) {
  if (!confirm(`Revoke access for "${device.name}"? The device will not be able to sync until re-paired.`)) return
  await revokeDevice(device.id)
}

async function saveSettings() {
  if (readingThreshold.value >= finishedThreshold.value) {
    settingsError.value = 'Reading threshold must be less than finished threshold'
    return
  }
  savingSettings.value = true
  settingsError.value = null
  try {
    await updateSettings({
      readingThreshold: readingThreshold.value,
      finishedThreshold: finishedThreshold.value,
      convertToKepub: convertToKepub.value,
      twoWayProgressSync: twoWayProgressSync.value,
      forceEnableHyphenation: forceEnableHyphenation.value,
      kepubConversionLimitMb: kepubConversionLimitMb.value,
    })
  } catch (e) {
    settingsError.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    savingSettings.value = false
  }
}
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl mx-auto">
    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">Kobo Sync</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Pair your Kobo device to sync your library. Enable "Sync to Kobo" on any collection to push those books to your device.
      </p>
    </div>

    <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>
    <div v-else-if="error" class="text-sm text-destructive">{{ error }}</div>
    <template v-else>
      <!-- New device token display -->
      <div v-if="newDeviceSyncUrl" class="mb-6 border border-primary/30 rounded-lg p-5 bg-primary/5">
        <div class="flex items-start justify-between gap-3 mb-3">
          <div>
            <p class="text-sm font-semibold text-foreground">Device paired successfully</p>
            <p class="text-xs text-muted-foreground mt-0.5">
              Copy this URL and enter it on your Kobo device under Settings - Account - Add account - Other.
            </p>
          </div>
          <button @click="dismissToken()" class="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            <X :size="16" />
          </button>
        </div>
        <div class="flex items-center gap-2 px-3 py-2.5 rounded-md border border-border bg-background">
          <Tablet :size="14" class="text-muted-foreground shrink-0" />
          <span class="flex-1 text-sm text-foreground font-mono select-all truncate min-w-0">{{ newDeviceSyncUrl }}</span>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors shrink-0"
            @click="copyToken()"
          >
            <component :is="tokenCopied ? Check : Copy" :size="12" />
            {{ tokenCopied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <p class="mt-2 text-xs text-muted-foreground">This URL will not be shown again. Keep it private.</p>
      </div>

      <!-- Devices -->
      <div class="mb-6">
        <div class="flex items-center justify-between mb-3">
          <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Devices</p>
          <button
            v-if="!showCreateForm"
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            @click="showCreateForm = true"
          >
            <Plus :size="12" />
            Add device
          </button>
        </div>

        <!-- Create form -->
        <div v-if="showCreateForm" class="border border-border rounded-lg p-5 bg-card mb-4 space-y-4">
          <div>
            <label class="block text-xs font-medium text-muted-foreground mb-1.5">Device name</label>
            <input
              v-model="newDeviceName"
              type="text"
              placeholder="e.g. Kobo Libra 2"
              autofocus
              class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div v-if="createError" class="text-xs text-destructive">{{ createError }}</div>
          <div class="flex items-center gap-2">
            <button
              class="px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              :disabled="creating || !newDeviceName.trim()"
              @click="submitCreate()"
            >
              {{ creating ? 'Creating...' : 'Create' }}
            </button>
            <button
              class="px-4 py-2 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
              @click="cancelCreate()"
            >
              Cancel
            </button>
          </div>
        </div>

        <div v-if="devices.length === 0 && !showCreateForm" class="border border-border rounded-lg px-5 py-8 bg-card text-center">
          <p class="text-sm text-muted-foreground">No devices yet. Add a device to start syncing your library.</p>
        </div>

        <div v-else-if="devices.length > 0" class="border border-border rounded-lg overflow-hidden divide-y divide-border">
          <div v-for="device in devices" :key="device.id" class="px-5 py-3.5 bg-card">
            <div v-if="renamingId === device.id" class="flex items-center gap-2">
              <input
                v-model="renameValue"
                type="text"
                class="flex-1 h-8 px-2.5 text-sm border border-primary rounded-md bg-background text-foreground focus:outline-none"
                @keydown.enter="submitRename(device)"
                @keydown.esc="cancelRename()"
              />
              <button
                class="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                :disabled="renaming || !renameValue.trim()"
                @click="submitRename(device)"
              >
                Save
              </button>
              <button class="text-muted-foreground hover:text-foreground transition-colors" @click="cancelRename()">
                <X :size="14" />
              </button>
            </div>
            <div v-else class="flex items-center gap-3">
              <Tablet :size="16" class="text-muted-foreground shrink-0" />
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-foreground truncate">{{ device.name }}</p>
                <p class="text-xs text-muted-foreground mt-0.5">Last seen: {{ formatLastSeen(device.lastSeenAt) }}</p>
              </div>
              <button
                class="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                @click="startRename(device)"
              >
                <Pencil :size="13" />
              </button>
              <button
                class="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                @click="revoke(device)"
              >
                <Trash2 :size="14" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Sync settings -->
      <div class="mb-6">
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Progress Thresholds</p>
        <div class="border border-border rounded-lg p-5 bg-card space-y-5">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-foreground">Convert EPUB to KEPUB</p>
              <p class="text-xs text-muted-foreground mt-0.5">Optimizes ebooks for Kobo devices. Requires kepubify on first use.</p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="convertToKepub"
              class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              :class="convertToKepub ? 'bg-primary' : 'bg-muted'"
              @click="convertToKepub = !convertToKepub"
            >
              <span
                class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
                :class="convertToKepub ? 'translate-x-4' : 'translate-x-0'"
              />
            </button>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-foreground">Force hyphenation</p>
              <p class="text-xs text-muted-foreground mt-0.5">Passes --hyphenate to kepubify. Cached files are regenerated.</p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="forceEnableHyphenation"
              class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              :class="forceEnableHyphenation ? 'bg-primary' : 'bg-muted'"
              @click="forceEnableHyphenation = !forceEnableHyphenation"
            >
              <span
                class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
                :class="forceEnableHyphenation ? 'translate-x-4' : 'translate-x-0'"
              />
            </button>
          </div>

          <div class="flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-foreground">Two-way progress sync</p>
              <p class="text-xs text-muted-foreground mt-0.5">Pushes web reader progress to your Kobo device on sync.</p>
            </div>
            <button
              type="button"
              role="switch"
              :aria-checked="twoWayProgressSync"
              class="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              :class="twoWayProgressSync ? 'bg-primary' : 'bg-muted'"
              @click="twoWayProgressSync = !twoWayProgressSync"
            >
              <span
                class="pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
                :class="twoWayProgressSync ? 'translate-x-4' : 'translate-x-0'"
              />
            </button>
          </div>

          <p class="text-xs text-muted-foreground">Define when Kobo reading progress marks a book as "Reading" or "Finished" in your library.</p>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-xs font-medium text-muted-foreground mb-1.5">Mark as Reading (%)</label>
              <input
                v-model.number="readingThreshold"
                type="number"
                min="0"
                max="99"
                class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-muted-foreground mb-1.5">Mark as Finished (%)</label>
              <input
                v-model.number="finishedThreshold"
                type="number"
                min="1"
                max="100"
                class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label class="block text-xs font-medium text-muted-foreground mb-1.5">KEPUB conversion limit (MB)</label>
              <input
                v-model.number="kepubConversionLimitMb"
                type="number"
                min="1"
                class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div v-if="settingsError" class="text-xs text-destructive">{{ settingsError }}</div>

          <button
            class="px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            :disabled="savingSettings"
            @click="saveSettings()"
          >
            {{ savingSettings ? 'Saving...' : 'Save' }}
          </button>
        </div>
      </div>

      <!-- Help -->
      <div class="border border-border rounded-lg p-5 bg-card">
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">How to sync</p>
        <ol class="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Add a device above and copy the sync URL.</li>
          <li>On your Kobo device, go to Settings - Account - Add account - Other.</li>
          <li>Enter the sync URL and any username/password (both are ignored).</li>
          <li>Enable "Sync to Kobo" on any collection from the Collections view.</li>
          <li>Sync your Kobo device.</li>
        </ol>
      </div>
    </template>
  </div>
</template>
