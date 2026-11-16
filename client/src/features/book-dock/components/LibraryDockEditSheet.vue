<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderPen, Loader2 } from '@lucide/vue'
import type { BookDockAutoFinalizeMetadataMode, BookDockSettings, LibraryDockAdminEntry, UpdateLibraryDockRequest } from '@bookorbit/types'
import FormSheet from '@/components/FormSheet.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { renameLibraryDockFolder, updateLibraryDock } from '../api/book-dock.api'
import { libraryDockErrorMessage } from '../lib/library-dock-error'

type Inherit = 'default'
type BooleanChoice = Inherit | 'on' | 'off'

const props = defineProps<{
  open: boolean
  entry: LibraryDockAdminEntry | null
  settings: BookDockSettings
}>()

const emit = defineEmits<{
  'update:open': [boolean]
  saved: []
}>()

const { t } = useI18n()

const enabled = ref(true)
const folderName = ref('')
const targetFolderId = ref<number | null>(null)
const autoFetch = ref<BooleanChoice>('default')
const autoFile = ref<BooleanChoice>('default')
const ownThreshold = ref(false)
const threshold = ref(85)
const metadataMode = ref<BookDockAutoFinalizeMetadataMode | ''>('')
const autoJoin = ref(false)
const keepOriginal = ref(false)
const busy = ref(false)
const renaming = ref(false)
const error = ref<string | null>(null)

const dock = computed(() => props.entry?.dock ?? null)

function toChoice(value: boolean | null): BooleanChoice {
  if (value === null) return 'default'
  return value ? 'on' : 'off'
}

function fromChoice(choice: BooleanChoice): boolean | null {
  return choice === 'default' ? null : choice === 'on'
}

/** Loads the form from the dock each time the sheet opens, so a cancelled edit leaves nothing behind. */
function reset() {
  const current = dock.value
  error.value = null
  if (!current) return
  enabled.value = current.enabled
  folderName.value = current.folderName
  targetFolderId.value = current.targetFolderId
  autoFetch.value = toChoice(current.overrides.autoFetchMetadata)
  autoFile.value = toChoice(current.overrides.autoFinalizeEnabled)
  ownThreshold.value = current.overrides.autoFinalizeThreshold !== null
  threshold.value = current.overrides.autoFinalizeThreshold ?? props.settings.autoFinalizeThreshold
  metadataMode.value = current.overrides.autoFinalizeMetadataMode ?? ''
  autoJoin.value = current.autoJoin
  keepOriginal.value = current.keepOriginal
}

/** Only what changed is sent: a rename moves files, so an untouched name must not be resent. */
const changes = computed<UpdateLibraryDockRequest>(() => {
  const current = dock.value
  if (!current) return {}
  const next: UpdateLibraryDockRequest = {}
  if (enabled.value !== current.enabled) next.enabled = enabled.value
  const name = folderName.value.trim()
  if (name && name !== current.folderName) next.folderName = name
  if (targetFolderId.value !== null && targetFolderId.value !== current.targetFolderId) next.targetFolderId = targetFolderId.value
  const fetch = fromChoice(autoFetch.value)
  if (fetch !== current.overrides.autoFetchMetadata) next.autoFetchMetadata = fetch
  const file = fromChoice(autoFile.value)
  if (file !== current.overrides.autoFinalizeEnabled) next.autoFinalizeEnabled = file
  const ownValue = ownThreshold.value ? threshold.value : null
  if (ownValue !== current.overrides.autoFinalizeThreshold) next.autoFinalizeThreshold = ownValue
  const mode = metadataMode.value === '' ? null : metadataMode.value
  if (mode !== current.overrides.autoFinalizeMetadataMode) next.autoFinalizeMetadataMode = mode
  if (autoJoin.value !== current.autoJoin) next.autoJoin = autoJoin.value
  if (keepOriginal.value !== current.keepOriginal) next.keepOriginal = keepOriginal.value
  return next
})

const dirty = computed(() => Object.keys(changes.value).length > 0)
const renamesFolder = computed(() => changes.value.folderName !== undefined)

const onOff = computed(() => [
  { value: 'on' as const, label: t('settings.reader.bookDock.docks.on') },
  { value: 'off' as const, label: t('settings.reader.bookDock.docks.off') },
])

const defaultFetchLabel = computed(() =>
  props.settings.autoFetchMetadata ? t('settings.reader.bookDock.docks.on') : t('settings.reader.bookDock.docks.off'),
)
const defaultFileLabel = computed(() =>
  props.settings.autoFinalizeEnabled ? t('settings.reader.bookDock.docks.on') : t('settings.reader.bookDock.docks.off'),
)
const defaultModeLabel = computed(() => modeLabel(props.settings.autoFinalizeMetadataMode))

function modeLabel(mode: BookDockAutoFinalizeMetadataMode): string {
  if (mode === 'fetched_only') return t('settings.reader.bookDock.metadataModeFetchedOnly')
  if (mode === 'embedded_only') return t('settings.reader.bookDock.metadataModeEmbeddedOnly')
  return t('settings.reader.bookDock.metadataModeSafeMerge')
}

function setAutoFetch(choice: BooleanChoice) {
  autoFetch.value = choice
}
function setAutoFile(choice: BooleanChoice) {
  autoFile.value = choice
}
function fetchByDefault() {
  autoFetch.value = 'default'
}
function fileByDefault() {
  autoFile.value = 'default'
}
function useDefaultThreshold() {
  ownThreshold.value = false
}
function useOwnThreshold() {
  ownThreshold.value = true
}

function onOpenChange(open: boolean) {
  emit('update:open', open)
}

async function save() {
  if (!props.entry || busy.value) return
  if (!dirty.value) {
    emit('update:open', false)
    return
  }
  busy.value = true
  error.value = null
  const result = await updateLibraryDock(props.entry.libraryId, changes.value)
  busy.value = false
  if (!result.ok) {
    error.value = libraryDockErrorMessage(result.errorCode, t)
    return
  }
  emit('saved')
  emit('update:open', false)
}

async function renameToMatch() {
  if (!props.entry || renaming.value) return
  renaming.value = true
  error.value = null
  const result = await renameLibraryDockFolder(props.entry.libraryId)
  renaming.value = false
  if (!result.ok) {
    error.value = libraryDockErrorMessage(result.errorCode, t)
    return
  }
  folderName.value = result.data.dock?.folderName ?? folderName.value
  emit('saved')
}
</script>

<template>
  <FormSheet
    :open="props.open"
    :title="t('settings.reader.bookDock.docks.editTitle', { library: props.entry?.libraryName ?? '' })"
    :description="t('settings.reader.bookDock.docks.editDescription', { library: props.entry?.libraryName ?? '' })"
    :busy="busy"
    :dirty="dirty"
    :error="error"
    submit-test-id="library-dock-edit-save"
    content-class="sm:max-w-md"
    data-testid="library-dock-edit-sheet"
    @update:open="onOpenChange"
    @opened="reset"
    @submit="save"
  >
    <div v-if="dock" class="flex-1 space-y-5 overflow-y-auto px-4 py-4">
      <div class="flex items-center justify-between gap-3">
        <span class="text-sm font-medium text-foreground">{{ t('settings.reader.bookDock.docks.dockOnLabel') }}</span>
        <ToggleSwitch v-model="enabled" :aria-label="t('settings.reader.bookDock.docks.dockOn', { library: props.entry?.libraryName ?? '' })" />
      </div>

      <div
        v-if="props.entry?.suggestedFolderName"
        role="status"
        class="flex gap-2.5 rounded-lg border border-amber-500/35 bg-amber-500/7 p-3 text-[13px] text-foreground"
      >
        <FolderPen class="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        <div class="grid gap-2">
          <span>{{ t('settings.reader.bookDock.docks.renamedCallout', { library: props.entry.libraryName, folder: dock.folderName }) }}</span>
          <button
            type="button"
            data-testid="library-dock-rename-to-match"
            class="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            :disabled="renaming || busy"
            @click="renameToMatch"
          >
            <Loader2 v-if="renaming" class="size-3.5 animate-spin" aria-hidden="true" />
            <FolderPen v-else class="size-3.5" aria-hidden="true" />
            {{ t('settings.reader.bookDock.docks.renameToMatch', { folder: props.entry.suggestedFolderName }) }}
          </button>
        </div>
      </div>

      <label class="grid gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.docks.folder') }}</span>
        <span class="flex h-9 items-center overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
          <span class="flex h-full items-center border-e border-input bg-muted px-2.5 font-mono text-xs text-muted-foreground">_libraries/</span>
          <input
            v-model="folderName"
            data-testid="library-dock-folder-name"
            spellcheck="false"
            maxlength="255"
            class="h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm text-foreground outline-none"
          />
        </span>
        <span class="text-xs" :class="renamesFolder ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'">{{
          t('settings.reader.bookDock.docks.folderHint')
        }}</span>
      </label>

      <label class="grid gap-1.5">
        <span class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.docks.filesInto') }}</span>
        <select v-model="targetFolderId" class="select-field w-full" data-testid="library-dock-target-folder">
          <option :value="null" disabled>{{ t('settings.reader.bookDock.selectFolder') }}</option>
          <option v-for="folder in props.entry?.folders ?? []" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
        </select>
      </label>

      <fieldset class="grid gap-3.5">
        <legend class="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {{ t('settings.reader.bookDock.docks.fetchAndFile') }}
        </legend>

        <div class="grid gap-1.5">
          <span id="dock-auto-fetch" class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.docks.autoFetch') }}</span>
          <div role="group" aria-labelledby="dock-auto-fetch" class="segmented">
            <button type="button" :aria-pressed="autoFetch === 'default'" @click="fetchByDefault">
              {{ t('settings.reader.bookDock.docks.defaultValue', { value: defaultFetchLabel }) }}
            </button>
            <button
              v-for="option in onOff"
              :key="option.value"
              type="button"
              :aria-pressed="autoFetch === option.value"
              @click="setAutoFetch(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="grid gap-1.5">
          <span id="dock-auto-file" class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.docks.autoFile') }}</span>
          <div role="group" aria-labelledby="dock-auto-file" class="segmented" data-testid="library-dock-auto-file">
            <button type="button" :aria-pressed="autoFile === 'default'" @click="fileByDefault">
              {{ t('settings.reader.bookDock.docks.defaultValue', { value: defaultFileLabel }) }}
            </button>
            <button
              v-for="option in onOff"
              :key="option.value"
              type="button"
              :aria-pressed="autoFile === option.value"
              @click="setAutoFile(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="grid gap-1.5">
          <span id="dock-threshold" class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.docks.matchNeeded') }}</span>
          <div role="group" aria-labelledby="dock-threshold" class="segmented">
            <button type="button" :aria-pressed="!ownThreshold" @click="useDefaultThreshold">
              {{ t('settings.reader.bookDock.docks.defaultValue', { value: `${props.settings.autoFinalizeThreshold}%` }) }}
            </button>
            <button type="button" data-testid="library-dock-own-threshold" :aria-pressed="ownThreshold" @click="useOwnThreshold">
              {{ t('settings.reader.bookDock.docks.ownValue') }}
            </button>
          </div>
          <label v-if="ownThreshold" class="flex items-center gap-3">
            <input
              v-model.number="threshold"
              type="range"
              min="50"
              max="100"
              step="5"
              class="flex-1 accent-primary"
              :aria-label="t('settings.reader.bookDock.docks.matchNeeded')"
            />
            <span class="w-10 text-end text-sm font-semibold tabular-nums text-foreground">{{ threshold }}%</span>
          </label>
        </div>

        <label class="grid gap-1.5">
          <span class="text-xs font-medium text-muted-foreground">{{ t('settings.reader.bookDock.metadataMode') }}</span>
          <select v-model="metadataMode" class="select-field w-full">
            <option value="">{{ t('settings.reader.bookDock.docks.defaultValue', { value: defaultModeLabel }) }}</option>
            <option value="safe_merge">{{ t('settings.reader.bookDock.metadataModeSafeMerge') }}</option>
            <option value="fetched_only">{{ t('settings.reader.bookDock.metadataModeFetchedOnly') }}</option>
            <option value="embedded_only">{{ t('settings.reader.bookDock.metadataModeEmbeddedOnly') }}</option>
          </select>
        </label>
      </fieldset>

      <fieldset class="grid gap-3">
        <legend class="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {{ t('settings.reader.bookDock.docks.thisDockOnly') }}
        </legend>
        <div class="flex items-start justify-between gap-3">
          <div class="grid gap-0.5">
            <span class="text-sm font-medium text-foreground">{{ t('settings.reader.bookDock.docks.autoJoin') }}</span>
            <span class="text-xs text-muted-foreground">{{ t('settings.reader.bookDock.docks.autoJoinHint') }}</span>
          </div>
          <ToggleSwitch v-model="autoJoin" :aria-label="t('settings.reader.bookDock.docks.autoJoin')" />
        </div>
        <div class="flex items-start justify-between gap-3">
          <div class="grid gap-0.5">
            <span class="text-sm font-medium text-foreground">{{ t('settings.reader.bookDock.docks.keepOriginal') }}</span>
            <span class="text-xs text-muted-foreground">{{ t('settings.reader.bookDock.docks.keepOriginalHint') }}</span>
          </div>
          <ToggleSwitch v-model="keepOriginal" :aria-label="t('settings.reader.bookDock.docks.keepOriginal')" />
        </div>
      </fieldset>
    </div>
  </FormSheet>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  width: fit-content;
  border-radius: 8px;
  background: var(--muted);
}
.segmented button {
  height: 28px;
  padding-inline: 10px;
  border-radius: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--muted-foreground);
}
.segmented button:hover {
  color: var(--foreground);
}
.segmented button:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 1px;
}
.segmented button[aria-pressed='true'] {
  background: var(--background);
  color: var(--foreground);
  box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
}
</style>
