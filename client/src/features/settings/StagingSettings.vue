<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { api } from '@/lib/api'
import { useLibraries } from '@/features/library/composables/useLibraries'

const autoFetch = ref(true)
const autoFinalizeEnabled = ref(false)
const autoFinalizeThreshold = ref(85)
const autoFinalizeLibraryId = ref<number | null>(null)
const autoFinalizeFolderId = ref<number | null>(null)
const loading = ref(true)
const saving = ref(false)

const { libraries, fetchLibraries } = useLibraries()

const autoFinalizeLibrary = computed(() => libraries.value.find((l) => l.id === autoFinalizeLibraryId.value))
const autoFinalizeFolders = computed(() => autoFinalizeLibrary.value?.folders ?? [])

onMounted(async () => {
  try {
    const [res] = await Promise.all([api('/api/v1/app-settings'), fetchLibraries()])
    if (res.ok) {
      const settings: { key: string; value: string }[] = await res.json()
      const get = (key: string) => settings.find((s) => s.key === key)?.value
      autoFetch.value = get('staging_auto_fetch_metadata') !== 'false'
      autoFinalizeEnabled.value = get('staging_auto_finalize_enabled') === 'true'
      autoFinalizeThreshold.value = parseInt(get('staging_auto_finalize_threshold') ?? '85', 10)
      const libId = parseInt(get('staging_auto_finalize_library_id') ?? '', 10)
      const folderId = parseInt(get('staging_auto_finalize_folder_id') ?? '', 10)
      autoFinalizeLibraryId.value = isNaN(libId) ? null : libId
      autoFinalizeFolderId.value = isNaN(folderId) ? null : folderId
    }
  } finally {
    loading.value = false
  }
})

async function saveSetting(key: string, value: string) {
  await api(`/api/v1/app-settings/${key}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
}

async function toggle() {
  if (saving.value) return
  const newVal = !autoFetch.value
  saving.value = true
  try {
    const res = await api('/api/v1/app-settings/staging_auto_fetch_metadata', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(newVal) }),
    })
    if (res.ok) autoFetch.value = newVal
  } finally {
    saving.value = false
  }
}

async function toggleAutoFinalize() {
  if (saving.value) return
  const newVal = !autoFinalizeEnabled.value
  saving.value = true
  try {
    const res = await api('/api/v1/app-settings/staging_auto_finalize_enabled', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(newVal) }),
    })
    if (res.ok) autoFinalizeEnabled.value = newVal
  } finally {
    saving.value = false
  }
}

async function onLibraryChange(event: Event) {
  const id = Number((event.target as HTMLSelectElement).value)
  autoFinalizeLibraryId.value = id
  const lib = libraries.value.find((l) => l.id === id)
  autoFinalizeFolderId.value = lib?.folders?.[0]?.id ?? null
  await Promise.all([
    saveSetting('staging_auto_finalize_library_id', String(id)),
    saveSetting('staging_auto_finalize_folder_id', String(autoFinalizeFolderId.value ?? '')),
  ])
}

async function onFolderChange(event: Event) {
  autoFinalizeFolderId.value = Number((event.target as HTMLSelectElement).value)
  await saveSetting('staging_auto_finalize_folder_id', String(autoFinalizeFolderId.value))
}

async function onThresholdChange() {
  await saveSetting('staging_auto_finalize_threshold', String(autoFinalizeThreshold.value))
}
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl mx-auto">
    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">Staging</h2>
      <p class="mt-1 text-sm text-muted-foreground">Configure how files are processed when they enter the staging area.</p>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-8">
      <Loader2 class="size-5 animate-spin text-muted-foreground" />
    </div>

    <div v-else class="space-y-6">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Metadata</p>

      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <label class="flex items-center justify-between px-5 py-4 bg-card cursor-pointer select-none group" @click="toggle">
          <div>
            <p class="text-sm font-medium text-foreground">Auto-fetch metadata from providers</p>
            <p class="text-xs text-muted-foreground mt-0.5">
              Automatically fetch metadata from configured providers (Google Books, Open Library, etc.) after a file is added to staging.
            </p>
          </div>
          <span
            class="relative ml-4 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
            :class="autoFetch ? 'bg-primary' : 'bg-muted'"
          >
            <span
              class="inline-block size-4 rounded-full bg-white shadow transition-transform"
              :class="autoFetch ? 'translate-x-6' : 'translate-x-1'"
            />
          </span>
        </label>
      </div>

      <div class="mt-6 space-y-4">
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Auto-finalize</p>
        <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
          <label class="flex items-center justify-between px-5 py-4 bg-card cursor-pointer select-none" @click="toggleAutoFinalize">
            <div>
              <p class="text-sm font-medium text-foreground">Enable auto-finalize</p>
              <p class="text-xs text-muted-foreground mt-0.5">
                Files with a metadata confidence score at or above the threshold will be finalized automatically.
              </p>
            </div>
            <span
              class="relative ml-4 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
              :class="autoFinalizeEnabled ? 'bg-primary' : 'bg-muted'"
            >
              <span
                class="inline-block size-4 rounded-full bg-white shadow transition-transform"
                :class="autoFinalizeEnabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </span>
          </label>

          <div v-if="autoFinalizeEnabled" class="px-5 py-4 bg-card space-y-4">
            <label class="block">
              <span class="text-xs font-medium text-muted-foreground">Confidence threshold: {{ autoFinalizeThreshold }}%</span>
              <input
                v-model.number="autoFinalizeThreshold"
                type="range"
                min="50"
                max="100"
                step="5"
                class="mt-1 w-full accent-primary"
                @change="onThresholdChange"
              />
              <div class="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                <span>50%</span>
                <span>100%</span>
              </div>
            </label>

            <label class="block">
              <span class="text-xs font-medium text-muted-foreground">Destination library</span>
              <select
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                :value="autoFinalizeLibraryId ?? ''"
                @change="onLibraryChange"
              >
                <option value="" disabled>Select a library...</option>
                <option v-for="lib in libraries" :key="lib.id" :value="lib.id">{{ lib.name }}</option>
              </select>
            </label>

            <label class="block">
              <span class="text-xs font-medium text-muted-foreground">Destination folder</span>
              <select
                class="mt-1 w-full h-8 rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                :value="autoFinalizeFolderId ?? ''"
                @change="onFolderChange"
              >
                <option value="" disabled>Select a folder...</option>
                <option v-for="folder in autoFinalizeFolders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
