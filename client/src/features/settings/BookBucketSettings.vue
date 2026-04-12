<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { BookBucketAutoFinalizeMetadataMode } from '@projectx/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { api } from '@/lib/api'
import { useLibraries } from '@/features/library/composables/useLibraries'

const autoFetch = ref(true)
const autoFinalizeEnabled = ref(false)
const autoFinalizeThreshold = ref(85)
const autoFinalizeLibraryId = ref<number | null>(null)
const autoFinalizeFolderId = ref<number | null>(null)
const autoFinalizeMetadataMode = ref<BookBucketAutoFinalizeMetadataMode>('safe_merge')
const loading = ref(true)
const saving = ref(false)

const { libraries, fetchLibraries } = useLibraries()

const autoFinalizeLibrary = computed(() => libraries.value.find((l) => l.id === autoFinalizeLibraryId.value))
const autoFinalizeFolders = computed(() => autoFinalizeLibrary.value?.folders ?? [])
const isThresholdApplicable = computed(() => autoFinalizeMetadataMode.value !== 'embedded_only')

onMounted(async () => {
  try {
    const [res] = await Promise.all([api('/api/v1/app-settings'), fetchLibraries()])
    if (res.ok) {
      const settings: { key: string; value: string }[] = await res.json()
      const get = (key: string) => settings.find((s) => s.key === key)?.value
      autoFetch.value = get('book_bucket_auto_fetch_metadata') !== 'false'
      autoFinalizeEnabled.value = get('book_bucket_auto_finalize_enabled') === 'true'
      autoFinalizeThreshold.value = parseInt(get('book_bucket_auto_finalize_threshold') ?? '85', 10)
      const libId = parseInt(get('book_bucket_auto_finalize_library_id') ?? '', 10)
      const folderId = parseInt(get('book_bucket_auto_finalize_folder_id') ?? '', 10)
      const metadataMode = get('book_bucket_auto_finalize_metadata_mode')
      autoFinalizeLibraryId.value = isNaN(libId) ? null : libId
      autoFinalizeFolderId.value = isNaN(folderId) ? null : folderId
      autoFinalizeMetadataMode.value = metadataMode === 'fetched_only' || metadataMode === 'embedded_only' ? metadataMode : 'safe_merge'
    }
  } finally {
    loading.value = false
  }
})

async function saveSetting(key: string, value: string) {
  const res = await api(`/api/v1/app-settings/${key}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  })
  if (!res.ok) {
    toast.error('Failed to save setting')
  }
}

async function toggle() {
  if (saving.value) return
  const newVal = !autoFetch.value
  saving.value = true
  try {
    const res = await api('/api/v1/app-settings/book_bucket_auto_fetch_metadata', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(newVal) }),
    })
    if (res.ok) {
      autoFetch.value = newVal
      toast.success(newVal ? 'Auto-fetch enabled' : 'Auto-fetch disabled')
    } else {
      toast.error('Failed to update setting')
    }
  } finally {
    saving.value = false
  }
}

async function toggleAutoFinalize() {
  if (saving.value) return
  const newVal = !autoFinalizeEnabled.value
  saving.value = true
  try {
    const res = await api('/api/v1/app-settings/book_bucket_auto_finalize_enabled', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(newVal) }),
    })
    if (res.ok) {
      autoFinalizeEnabled.value = newVal
      toast.success(newVal ? 'Auto-finalize enabled' : 'Auto-finalize disabled')
    } else {
      toast.error('Failed to update setting')
    }
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
    saveSetting('book_bucket_auto_finalize_library_id', String(id)),
    saveSetting('book_bucket_auto_finalize_folder_id', String(autoFinalizeFolderId.value ?? '')),
  ])
  toast.success('Destination library updated')
}

async function onFolderChange(event: Event) {
  autoFinalizeFolderId.value = Number((event.target as HTMLSelectElement).value)
  await saveSetting('book_bucket_auto_finalize_folder_id', String(autoFinalizeFolderId.value))
  toast.success('Destination folder updated')
}

async function onThresholdChange() {
  if (!isThresholdApplicable.value) return
  await saveSetting('book_bucket_auto_finalize_threshold', String(autoFinalizeThreshold.value))
  toast.success('Confidence threshold updated')
}

async function onMetadataModeChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value as BookBucketAutoFinalizeMetadataMode
  autoFinalizeMetadataMode.value = value
  await saveSetting('book_bucket_auto_finalize_metadata_mode', value)
  toast.success('Metadata mode updated')
}
</script>

<template>
  <SettingsPageHeader class="hidden md:flex" title="Book Bucket" subtitle="Configure how files are processed when they enter Book Bucket." />
  <div class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">Book Bucket</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      Configure how files are processed when they enter Book Bucket.
    </p>
  </div>

  <div v-if="loading" class="mt-5 md:mt-0 flex items-center justify-center py-8">
    <Loader2 class="size-5 animate-spin text-muted-foreground" />
  </div>

  <div v-else class="mt-5 md:mt-0 space-y-6">
    <p class="settings-group-label">Metadata</p>

    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
        <div class="min-w-0">
          <p class="settings-label">Auto-fetch metadata from providers</p>
          <p class="settings-hint">
            Automatically fetch metadata from configured providers (Google Books, iTunes, Open Library, etc.) after a file is added to Book Bucket.
          </p>
        </div>
        <ToggleSwitch :model-value="autoFetch" :disabled="saving" class="self-start md:self-auto md:ml-4" @update:model-value="() => toggle()" />
      </div>
    </div>

    <div class="mt-6 space-y-4">
      <p class="settings-group-label">Auto-finalize</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">Enable auto-finalize</p>
            <p class="settings-hint">Files with a metadata confidence score at or above the threshold will be finalized automatically.</p>
          </div>
          <ToggleSwitch
            :model-value="autoFinalizeEnabled"
            :disabled="saving"
            class="self-start md:self-auto md:ml-4"
            @update:model-value="() => toggleAutoFinalize()"
          />
        </div>

        <div v-if="autoFinalizeEnabled" class="px-4 py-3.5 bg-card space-y-4 md:px-5 md:py-4">
          <label class="block">
            <span class="text-xs font-medium text-muted-foreground">
              Confidence threshold: {{ autoFinalizeThreshold }}%
              <span v-if="!isThresholdApplicable"> (ignored in Embedded only mode)</span>
            </span>
            <input
              v-model.number="autoFinalizeThreshold"
              type="range"
              min="50"
              max="100"
              step="5"
              class="mt-1 w-full accent-primary"
              :disabled="!isThresholdApplicable"
              @change="onThresholdChange"
            />
            <div class="flex justify-between settings-hint">
              <span>50%</span>
              <span>100%</span>
            </div>
          </label>

          <label class="block">
            <span class="text-xs font-medium text-muted-foreground">Destination library</span>
            <select class="select-field mt-1 w-full" :value="autoFinalizeLibraryId ?? ''" @change="onLibraryChange">
              <option value="" disabled>Select a library...</option>
              <option v-for="lib in libraries" :key="lib.id" :value="lib.id">{{ lib.name }}</option>
            </select>
          </label>

          <label class="block">
            <span class="text-xs font-medium text-muted-foreground">Metadata mode</span>
            <select class="select-field mt-1 w-full" :value="autoFinalizeMetadataMode" @change="onMetadataModeChange">
              <option value="safe_merge">Safe merge (recommended)</option>
              <option value="fetched_only">Fetched only</option>
              <option value="embedded_only">Embedded only</option>
            </select>
          </label>

          <label class="block">
            <span class="text-xs font-medium text-muted-foreground">Destination folder</span>
            <select class="select-field mt-1 w-full" :value="autoFinalizeFolderId ?? ''" @change="onFolderChange">
              <option value="" disabled>Select a folder...</option>
              <option v-for="folder in autoFinalizeFolders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
