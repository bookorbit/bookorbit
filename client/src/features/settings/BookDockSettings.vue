<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { BookDockAutoFinalizeMetadataMode, BookDockSettings, UpdateBookDockSettingsRequest } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { api } from '@/lib/api'
import { useLibraries } from '@/features/library/composables/useLibraries'

const { t } = useI18n()
const props = withDefaults(defineProps<{ embedded?: boolean }>(), {
  embedded: false,
})
const autoFetch = ref(true)
const autoFinalizeEnabled = ref(false)
const autoFinalizeThreshold = ref(85)
const autoFinalizeLibraryId = ref<number | null>(null)
const autoFinalizeFolderId = ref<number | null>(null)
const autoFinalizeMetadataMode = ref<BookDockAutoFinalizeMetadataMode>('safe_merge')
const bookDockPath = ref('')
const loading = ref(true)
const saving = ref(false)

const { libraries, fetchLibraries } = useLibraries()

const autoFinalizeLibrary = computed(() => libraries.value.find((l) => l.id === autoFinalizeLibraryId.value))
const autoFinalizeFolders = computed(() => autoFinalizeLibrary.value?.folders ?? [])
const isThresholdApplicable = computed(() => autoFinalizeMetadataMode.value !== 'embedded_only')

onMounted(async () => {
  try {
    const [res] = await Promise.all([api('/api/v1/book-dock/settings'), fetchLibraries()])
    if (res.ok) {
      applySettings(await res.json())
    }
  } finally {
    loading.value = false
  }
})

function applySettings(settings: BookDockSettings) {
  bookDockPath.value = settings.bookDockPath
  autoFetch.value = settings.autoFetchMetadata
  autoFinalizeEnabled.value = settings.autoFinalizeEnabled
  autoFinalizeThreshold.value = settings.autoFinalizeThreshold
  autoFinalizeLibraryId.value = settings.autoFinalizeLibraryId
  autoFinalizeFolderId.value = settings.autoFinalizeFolderId
  autoFinalizeMetadataMode.value = settings.autoFinalizeMetadataMode
}

function settingsPayload(overrides: Partial<UpdateBookDockSettingsRequest> = {}): UpdateBookDockSettingsRequest {
  return {
    autoFetchMetadata: autoFetch.value,
    autoFinalizeEnabled: autoFinalizeEnabled.value,
    autoFinalizeThreshold: autoFinalizeThreshold.value,
    autoFinalizeLibraryId: autoFinalizeLibraryId.value,
    autoFinalizeFolderId: autoFinalizeFolderId.value,
    autoFinalizeMetadataMode: autoFinalizeMetadataMode.value,
    ...overrides,
  }
}

async function saveSettings(overrides: Partial<UpdateBookDockSettingsRequest>): Promise<boolean> {
  if (saving.value) return false
  saving.value = true
  try {
    const res = await api('/api/v1/book-dock/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsPayload(overrides)),
    })
    if (!res.ok) {
      toast.error(t('settings.reader.bookDock.saveSettingFailed'))
      return false
    }
    applySettings(await res.json())
    return true
  } finally {
    saving.value = false
  }
}

async function handleAutoFetchChange(enabled: boolean) {
  if (await saveSettings({ autoFetchMetadata: enabled })) {
    toast.success(enabled ? t('settings.reader.bookDock.autoFetchEnabled') : t('settings.reader.bookDock.autoFetchDisabled'))
  }
}

async function handleAutoFinalizeChange(enabled: boolean) {
  if (await saveSettings({ autoFinalizeEnabled: enabled })) {
    toast.success(enabled ? t('settings.reader.bookDock.autoFinalizeEnabled') : t('settings.reader.bookDock.autoFinalizeDisabled'))
  }
}

async function onLibraryChange(event: Event) {
  const libraryId = Number((event.target as HTMLSelectElement).value)
  const library = libraries.value.find((candidate) => candidate.id === libraryId)
  const folderId = library?.folders?.[0]?.id ?? null
  if (await saveSettings({ autoFinalizeLibraryId: libraryId, autoFinalizeFolderId: folderId })) {
    toast.success(t('settings.reader.bookDock.destinationLibraryUpdated'))
  }
}

async function onFolderChange(event: Event) {
  const folderId = Number((event.target as HTMLSelectElement).value)
  if (await saveSettings({ autoFinalizeFolderId: folderId })) {
    toast.success(t('settings.reader.bookDock.destinationFolderUpdated'))
  }
}

async function onThresholdChange() {
  if (!isThresholdApplicable.value) return
  if (await saveSettings({ autoFinalizeThreshold: autoFinalizeThreshold.value })) {
    toast.success(t('settings.reader.bookDock.confidenceThresholdUpdated'))
  }
}

async function onMetadataModeChange(event: Event) {
  const metadataMode = (event.target as HTMLSelectElement).value as BookDockAutoFinalizeMetadataMode
  if (await saveSettings({ autoFinalizeMetadataMode: metadataMode })) {
    toast.success(t('settings.reader.bookDock.metadataModeUpdated'))
  }
}
</script>

<template>
  <SettingsPageHeader
    v-if="!props.embedded"
    class="hidden md:flex"
    :title="t('settings.reader.bookDock.title')"
    :subtitle="t('settings.reader.bookDock.subtitle')"
  />
  <div v-if="!props.embedded" class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">
      {{ t('settings.reader.bookDock.title') }}
    </h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      {{ t('settings.reader.bookDock.subtitle') }}
    </p>
  </div>

  <div v-if="loading" class="mt-5 md:mt-0 flex items-center justify-center py-8">
    <Loader2 class="size-5 animate-spin text-muted-foreground" />
  </div>

  <div v-else class="mt-5 md:mt-0 space-y-6">
    <div>
      <p class="settings-group-label">
        {{ t('settings.reader.bookDock.dropFolder') }}
      </p>
      <div class="mt-4 border border-border rounded-lg overflow-hidden shadow-xs">
        <div class="px-4 py-3.5 bg-card md:px-5 md:py-4">
          <p class="settings-label">
            {{ t('settings.reader.bookDock.containerPath') }}
          </p>
          <p class="settings-hint mb-2">
            {{ t('settings.reader.bookDock.containerPathHint') }}
          </p>
          <code
            v-if="bookDockPath"
            data-testid="book-dock-path"
            class="block mt-1 px-3 py-2 rounded-md bg-muted text-foreground text-xs font-mono break-all select-all"
            >{{ bookDockPath }}</code
          >
          <p class="settings-hint mt-2">
            {{ t('settings.reader.bookDock.changePathPrefix') }}
            <code class="text-xs font-mono">BOOK_DOCK_PATH</code>
            {{ t('settings.reader.bookDock.changePathMiddle') }}
            <code class="text-xs font-mono">.env</code>
            {{ t('settings.reader.bookDock.changePathSuffix') }}
          </p>
        </div>
      </div>
    </div>

    <p class="settings-group-label">
      {{ t('settings.reader.bookDock.metadata') }}
    </p>

    <div class="settings-card">
      <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
        <div class="min-w-0">
          <p class="settings-label">
            {{ t('settings.reader.bookDock.autoFetch') }}
          </p>
          <p class="settings-hint">
            {{ t('settings.reader.bookDock.autoFetchHint') }}
          </p>
        </div>
        <ToggleSwitch
          :model-value="autoFetch"
          :disabled="saving"
          class="self-start md:self-auto md:ml-4"
          @update:model-value="handleAutoFetchChange"
        />
      </div>
    </div>

    <div class="mt-6 space-y-4">
      <p class="settings-group-label">
        {{ t('settings.reader.bookDock.autoFinalize') }}
      </p>
      <div class="settings-card">
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">
              {{ t('settings.reader.bookDock.enableAutoFinalize') }}
            </p>
            <p class="settings-hint">
              {{ t('settings.reader.bookDock.enableAutoFinalizeHint') }}
            </p>
          </div>
          <ToggleSwitch
            :model-value="autoFinalizeEnabled"
            :disabled="saving"
            class="self-start md:self-auto md:ml-4"
            @update:model-value="handleAutoFinalizeChange"
          />
        </div>

        <div v-if="autoFinalizeEnabled" class="px-4 py-3.5 bg-card space-y-4 md:px-5 md:py-4">
          <label class="block">
            <span class="text-xs font-medium text-muted-foreground">
              {{
                t('settings.reader.bookDock.confidenceThreshold', {
                  value: autoFinalizeThreshold,
                })
              }}
              <span v-if="!isThresholdApplicable"> {{ t('settings.reader.bookDock.thresholdIgnored') }}</span>
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
            <span class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.destinationLibrary') }}</span>
            <select class="select-field mt-1 w-full" :value="autoFinalizeLibraryId ?? ''" @change="onLibraryChange">
              <option value="" disabled>
                {{ t('settings.reader.bookDock.selectLibrary') }}
              </option>
              <option v-for="lib in libraries" :key="lib.id" :value="lib.id">
                {{ lib.name }}
              </option>
            </select>
          </label>

          <label class="block">
            <span class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.metadataMode') }}</span>
            <select class="select-field mt-1 w-full" :value="autoFinalizeMetadataMode" @change="onMetadataModeChange">
              <option value="safe_merge">
                {{ t('settings.reader.bookDock.metadataModeSafeMerge') }}
              </option>
              <option value="fetched_only">
                {{ t('settings.reader.bookDock.metadataModeFetchedOnly') }}
              </option>
              <option value="embedded_only">
                {{ t('settings.reader.bookDock.metadataModeEmbeddedOnly') }}
              </option>
            </select>
          </label>

          <label class="block">
            <span class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.destinationFolder') }}</span>
            <select class="select-field mt-1 w-full" :value="autoFinalizeFolderId ?? ''" @change="onFolderChange">
              <option value="" disabled>
                {{ t('settings.reader.bookDock.selectFolder') }}
              </option>
              <option v-for="folder in autoFinalizeFolders" :key="folder.id" :value="folder.id">
                {{ folder.path }}
              </option>
            </select>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
