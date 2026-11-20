<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import { Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { BookDockAutoFinalizeMetadataMode, BookDockSettings, LibraryDockAdminEntry, UpdateBookDockSettingsRequest } from '@bookorbit/types'
import FormSheet from '@/components/FormSheet.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { api } from '@/lib/api'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { updateLibraryDock } from '@/features/book-dock/api/book-dock.api'
import { useLibraryDocks } from '@/features/book-dock/composables/useLibraryDocks'
import { libraryDockErrorMessage } from '@/features/book-dock/lib/library-dock-error'
import LibraryDocksTable from '@/features/book-dock/components/LibraryDocksTable.vue'
import LibraryDockEditSheet from '@/features/book-dock/components/LibraryDockEditSheet.vue'
import LibraryDockTurnOnDialog from '@/features/book-dock/components/LibraryDockTurnOnDialog.vue'
import BookDockAttention from '@/features/book-dock/components/BookDockAttention.vue'

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
const unsortedAutoJoin = ref(false)
const unsortedKeepOriginal = ref(false)
const bookDockPath = ref('')
const loading = ref(true)
const saving = ref(false)
const settings = ref<BookDockSettings | null>(null)

const { libraries, fetchLibraries } = useLibraries()
const { admin, filing, refreshDocks, refreshFiling } = useLibraryDocks()
const route = useRoute()

const isThresholdApplicable = computed(() => autoFinalizeMetadataMode.value !== 'embedded_only')
const metadataModeHint = computed(() => {
  switch (autoFinalizeMetadataMode.value) {
    case 'fetched_only':
      return t('settings.reader.bookDock.metadataModeHint.fetched_only')
    case 'embedded_only':
      return t('settings.reader.bookDock.metadataModeHint.embedded_only')
    default:
      return t('settings.reader.bookDock.metadataModeHint.safe_merge')
  }
})

const editingLibraryId = ref<number | null>(null)
const editOpen = ref(false)
const editingEntry = computed(() => admin.value?.libraries.find((entry) => entry.libraryId === editingLibraryId.value) ?? null)
const turningOn = ref<LibraryDockAdminEntry | null>(null)
const matchingFolder = computed(
  () => admin.value?.unrecognisedFolders.find((folder) => folder.matchesLibraryId === turningOn.value?.libraryId) ?? null,
)
const togglingLibraryId = ref<number | null>(null)

onMounted(async () => {
  try {
    const [res] = await Promise.all([api('/api/v1/book-dock/settings'), fetchLibraries(), refreshDocks(true)])
    if (res.ok) {
      applySettings(await res.json())
    }
  } finally {
    loading.value = false
  }
  void refreshFiling()
  // "Choose a folder" on the dock page opens this dock's panel.
  const linked = Number(route.query.dock)
  if (Number.isInteger(linked) && admin.value?.libraries.some((entry) => entry.libraryId === linked && entry.dock)) openEdit(linked)
})

function applySettings(next: BookDockSettings) {
  settings.value = next
  unsortedAutoJoin.value = next.unsortedAutoJoin ?? false
  unsortedKeepOriginal.value = next.unsortedKeepOriginal ?? false
  bookDockPath.value = next.bookDockPath
  autoFetch.value = next.autoFetchMetadata
  autoFinalizeEnabled.value = next.autoFinalizeEnabled
  autoFinalizeThreshold.value = next.autoFinalizeThreshold
  autoFinalizeLibraryId.value = next.autoFinalizeLibraryId
  autoFinalizeFolderId.value = next.autoFinalizeFolderId
  autoFinalizeMetadataMode.value = next.autoFinalizeMetadataMode
}

function settingsPayload(overrides: Partial<UpdateBookDockSettingsRequest> = {}): UpdateBookDockSettingsRequest {
  return {
    autoFetchMetadata: autoFetch.value,
    autoFinalizeEnabled: autoFinalizeEnabled.value,
    autoFinalizeThreshold: autoFinalizeThreshold.value,
    autoFinalizeLibraryId: autoFinalizeLibraryId.value,
    autoFinalizeFolderId: autoFinalizeFolderId.value,
    autoFinalizeMetadataMode: autoFinalizeMetadataMode.value,
    unsortedAutoJoin: unsortedAutoJoin.value,
    unsortedKeepOriginal: unsortedKeepOriginal.value,
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

function openEdit(libraryId: number) {
  editingLibraryId.value = libraryId
  editOpen.value = true
}

async function onDockSaved() {
  await refreshDocks(true)
  void refreshFiling()
}

async function onToggleDock(entry: LibraryDockAdminEntry, enabled: boolean) {
  if (!entry.dock) {
    if (enabled) turningOn.value = entry
    return
  }
  togglingLibraryId.value = entry.libraryId
  const result = await updateLibraryDock(entry.libraryId, { enabled })
  togglingLibraryId.value = null
  if (!result.ok) {
    toast.error(libraryDockErrorMessage(result.errorCode, t))
    return
  }
  await refreshDocks(true)
}

async function onTurnedOn() {
  turningOn.value = null
  await onDockSaved()
}

function cancelTurnOn() {
  turningOn.value = null
}

/* The Unsorted panel: where files dropped in the root go, and the two Unsorted-only switches. */
const unsortedOpen = ref(false)
const unsortedLibraryId = ref<number | null>(null)
const unsortedFolderId = ref<number | null>(null)
const unsortedJoin = ref(false)
const unsortedKeep = ref(false)
const unsortedFolders = computed(() => libraries.value.find((library) => library.id === unsortedLibraryId.value)?.folders ?? [])
const unsortedDirty = computed(
  () =>
    unsortedLibraryId.value !== autoFinalizeLibraryId.value ||
    unsortedFolderId.value !== autoFinalizeFolderId.value ||
    unsortedJoin.value !== unsortedAutoJoin.value ||
    unsortedKeep.value !== unsortedKeepOriginal.value,
)

function openUnsorted() {
  unsortedOpen.value = true
}

function resetUnsorted() {
  unsortedLibraryId.value = autoFinalizeLibraryId.value
  unsortedFolderId.value = autoFinalizeFolderId.value
  unsortedJoin.value = unsortedAutoJoin.value
  unsortedKeep.value = unsortedKeepOriginal.value
}

function onUnsortedLibraryChange() {
  unsortedFolderId.value = unsortedFolders.value[0]?.id ?? null
}

async function saveUnsorted() {
  const saved = await saveSettings({
    autoFinalizeLibraryId: unsortedLibraryId.value,
    autoFinalizeFolderId: unsortedLibraryId.value === null ? null : unsortedFolderId.value,
    unsortedAutoJoin: unsortedJoin.value,
    unsortedKeepOriginal: unsortedKeep.value,
  })
  if (saved) {
    unsortedOpen.value = false
    toast.success(t('settings.reader.bookDock.docks.unsortedSaved'))
  }
}
</script>

<template>
  <SettingsPageHeader
    v-if="!props.embedded"
    class="hidden md:flex"
    :title="t('settings.reader.bookDock.title')"
    :subtitle="t('settings.reader.bookDock.docks.subtitle')"
  />
  <div v-if="!props.embedded" class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">
      {{ t('settings.reader.bookDock.title') }}
    </h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      {{ t('settings.reader.bookDock.docks.subtitle') }}
    </p>
  </div>

  <div v-if="loading" class="settings-loading-state" :class="{ 'mt-5 md:mt-0': !props.embedded }">
    <Loader2 class="size-5 animate-spin text-muted-foreground" />
  </div>

  <div v-else class="space-y-4" :class="{ 'mt-5 md:mt-0': !props.embedded }">
    <section aria-labelledby="book-dock-folder-heading" class="space-y-2">
      <h2 id="book-dock-folder-heading" class="settings-group-label">
        {{ t('settings.reader.bookDock.dropFolder') }}
      </h2>
      <div class="settings-card">
        <div class="px-4 py-3.5 bg-card md:px-5 md:py-4">
          <p class="settings-label">
            {{ t('settings.reader.bookDock.containerPath') }}
          </p>
          <p class="settings-hint mb-2">
            {{ t('settings.reader.bookDock.docks.containerPathHint') }}
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
    </section>

    <section aria-labelledby="book-dock-defaults-heading" class="space-y-2">
      <h2 id="book-dock-defaults-heading" class="settings-group-label">
        {{ t('settings.reader.bookDock.docks.defaults') }}
      </h2>

      <div class="settings-card">
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">
              {{ t('settings.reader.bookDock.autoFetch') }}
            </p>
            <p class="settings-hint">
              {{ t('settings.reader.bookDock.docks.autoFetchDefaultHint') }}
            </p>
          </div>
          <ToggleSwitch
            :model-value="autoFetch"
            :disabled="saving"
            :aria-label="t('settings.reader.bookDock.autoFetch')"
            class="self-start md:self-auto md:ml-4"
            @update:model-value="handleAutoFetchChange"
          />
        </div>

        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">
              {{ t('settings.reader.bookDock.docks.autoFile') }}
            </p>
            <p class="settings-hint">
              {{ t('settings.reader.bookDock.docks.autoFileDefaultHint') }}
            </p>
          </div>
          <ToggleSwitch
            :model-value="autoFinalizeEnabled"
            :disabled="saving"
            :aria-label="t('settings.reader.bookDock.docks.autoFile')"
            class="self-start md:self-auto md:ml-4"
            @update:model-value="handleAutoFinalizeChange"
          />
        </div>

        <div class="px-4 py-3.5 bg-card space-y-4 md:px-5 md:py-4">
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

          <div>
            <label class="block">
              <span class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.metadataMode') }}</span>
              <select
                class="select-field mt-1 w-full"
                :value="autoFinalizeMetadataMode"
                aria-describedby="book-dock-metadata-mode-hint"
                @change="onMetadataModeChange"
              >
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
            <p id="book-dock-metadata-mode-hint" class="settings-hint mt-1.5">{{ metadataModeHint }}</p>
          </div>
        </div>
      </div>
    </section>

    <section v-if="admin && settings" aria-labelledby="book-dock-docks-heading" class="space-y-2">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="book-dock-docks-heading" class="settings-group-label">
          {{ t('settings.reader.bookDock.docks.title') }}
        </h2>
        <span class="settings-hint">{{ t('settings.reader.bookDock.docks.defaultExplained') }}</span>
      </div>
      <LibraryDocksTable
        :libraries="admin.libraries"
        :settings="settings"
        :filing="filing"
        :busy-library-id="togglingLibraryId"
        @edit="openEdit"
        @edit-unsorted="openUnsorted"
        @toggle="onToggleDock"
      />
    </section>

    <section
      v-if="admin && (admin.unrecognisedFolders.length || admin.strayFiles.length)"
      aria-labelledby="book-dock-folders-heading"
      class="space-y-2"
    >
      <h2 id="book-dock-folders-heading" class="settings-group-label">
        {{ t('settings.reader.bookDock.docks.unownedFolders') }}
      </h2>
      <BookDockAttention :admin="admin" @changed="onDockSaved" />
    </section>

    <LibraryDockEditSheet v-if="settings" v-model:open="editOpen" :entry="editingEntry" :settings="settings" @saved="onDockSaved" />

    <LibraryDockTurnOnDialog v-if="turningOn" :entry="turningOn" :matching-folder="matchingFolder" @done="onTurnedOn" @cancel="cancelTurnOn" />

    <FormSheet
      v-model:open="unsortedOpen"
      :title="t('bookDock.switcher.unsorted')"
      :description="t('settings.reader.bookDock.docks.unsortedDescription')"
      :busy="saving"
      :dirty="unsortedDirty"
      content-class="sm:max-w-md"
      data-testid="library-dock-unsorted-sheet"
      @opened="resetUnsorted"
      @submit="saveUnsorted"
    >
      <div class="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <label class="grid gap-1.5">
          <span class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.docks.unsortedLibrary') }}</span>
          <select
            v-model="unsortedLibraryId"
            class="select-field w-full"
            data-testid="library-dock-unsorted-library"
            @change="onUnsortedLibraryChange"
          >
            <option :value="null">{{ t('settings.reader.bookDock.noDefaultLibrary') }}</option>
            <option v-for="lib in libraries" :key="lib.id" :value="lib.id">{{ lib.name }}</option>
          </select>
          <span class="text-xs text-muted-foreground">{{ t('settings.reader.bookDock.defaultLibraryHint') }}</span>
        </label>
        <label v-if="unsortedLibraryId !== null" class="grid gap-1.5">
          <span class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.destinationFolder') }}</span>
          <select v-model="unsortedFolderId" class="select-field w-full">
            <option :value="null" disabled>{{ t('settings.reader.bookDock.selectFolder') }}</option>
            <option v-for="folder in unsortedFolders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
          </select>
        </label>
        <fieldset class="grid gap-3">
          <legend class="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            {{ t('settings.reader.bookDock.docks.unsortedOnly') }}
          </legend>
          <div class="flex items-start justify-between gap-3">
            <div class="grid gap-0.5">
              <span class="text-sm font-medium text-foreground">{{ t('settings.reader.bookDock.docks.autoJoin') }}</span>
              <span class="text-xs text-muted-foreground">{{ t('settings.reader.bookDock.docks.autoJoinHint') }}</span>
            </div>
            <ToggleSwitch v-model="unsortedJoin" :aria-label="t('settings.reader.bookDock.docks.autoJoin')" />
          </div>
          <div class="flex items-start justify-between gap-3">
            <div class="grid gap-0.5">
              <span class="text-sm font-medium text-foreground">{{ t('settings.reader.bookDock.docks.keepOriginal') }}</span>
              <span class="text-xs text-muted-foreground">{{ t('settings.reader.bookDock.docks.keepOriginalHint') }}</span>
            </div>
            <ToggleSwitch v-model="unsortedKeep" :aria-label="t('settings.reader.bookDock.docks.keepOriginal')" />
          </div>
        </fieldset>
      </div>
    </FormSheet>
  </div>
</template>
