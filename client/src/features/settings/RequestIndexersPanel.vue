<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Plug, Plus, Server as ServerIcon, Trash2, TriangleAlert, Upload } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { BOOK_REQUEST_MEDIA_KINDS } from '@bookorbit/types'
import type { IndexerAdapterDescriptor, IndexerItem, IndexerSettingsField } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import ChipInput from '@/components/ui/ChipInput.vue'
import ConnectionHealth from './ConnectionHealth.vue'
import PluginDirectoryLink from './components/PluginDirectoryLink.vue'
import RequestSourceRow from './components/RequestSourceRow.vue'
import PluginVersionBadge from './components/PluginVersionBadge.vue'
import RequestSourcesEmpty from './components/RequestSourcesEmpty.vue'
import SettingsEditorSheet from './components/SettingsEditorSheet.vue'
import SettingsField from './components/SettingsField.vue'
import SettingsSection from './components/SettingsSection.vue'
import SettingsToggleField from './components/SettingsToggleField.vue'
import SourceColorPicker from './components/SourceColorPicker.vue'
import { isBuiltInAdapter, useIndexerDraft } from './composables/useIndexerDraft'
import { useIndexerPlugins } from './composables/useIndexerPlugins'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useIndexers } from '@/features/book-requests/composables/useIndexers'

const { t, te } = useI18n()

/** Reported upwards so the page states the instance-level encryption fact once, not per panel. */
const emit = defineEmits<{ encryptionState: [configured: boolean] }>()

const {
  indexers,
  adapters,
  pluginFailures,
  adapterFor,
  encryptionConfigured,
  loading,
  saving,
  loadFailed,
  fetchIndexers,
  save,
  remove,
  test,
  inspectPlugin,
  installPlugin,
  removePlugin,
} = useIndexers()

watch(encryptionConfigured, (configured) => emit('encryptionState', configured))

const { isSuperuser } = usePermissions()

/** Installing a plugin runs its code in the server process, so only an administrator may. */
const canInstallPlugins = isSuperuser

/** The row whose test is in flight, and the row whose enabled flag is; both go inert on their own. */
const testingId = ref<number | null>(null)
const togglingId = ref<number | null>(null)

const {
  draft,
  editorOpen,
  credentialVisible,
  fieldErrors,
  isDirty,
  currentAdapter,
  editingIndexer,
  sheetTitle,
  canScopeMediaKinds,
  describeFailure,
  startCreate,
  startCreateFor,
  startEdit,
  cancelEdit,
  handleNameInput,
  handleBaseUrlInput,
  markCredentialTouched,
  canClearCredential,
  toggleClearCredential,
  toggleCredentialVisible,
  setSetting,
  handleSettingInput,
  settingList,
  setSettingList,
  isSettingOptionSelected,
  isSettingOptionLocked,
  toggleSettingOption,
  canRestoreSettingDefault,
  restoreSettingDefault,
  normalizeCategory,
  adapterCarries,
  isMediaKindSearched,
  toggleMediaKind,
  handleSave,
} = useIndexerDraft({ indexers, adapterFor, adapterLabel, save })

/** Only while the editor is open: the record a closed sheet left behind is not being edited. */
const editingType = computed(() => (editorOpen.value ? (draft.value?.adapterType ?? null) : null))

const {
  pluginInput,
  pluginReview,
  pluginBusy,
  pluginRestartPending,
  removingPlugin,
  pluginPendingRemoval,
  pluginRows,
  torznabRows,
  nothingConfigured,
  allSourcesDisabled,
  editingPluginType,
  editingPlugin,
  pluginUseCount,
  pluginUsage,
  pendingRemovalUsage,
  askRemovePlugin,
  askRemovePluginType,
  cancelRemovePlugin,
  confirmRemovePlugin,
  handleRowPluginUpdate,
  handleRowPluginRemove,
  startPluginInstall,
  startPluginUpdate,
  handlePluginChosen,
  cancelPluginInstall,
  confirmPluginInstall,
  removeInstalledPlugin,
} = useIndexerPlugins({
  indexers,
  adapters,
  pluginFailures,
  adapterFor,
  inspectPlugin,
  installPlugin,
  removePlugin,
  fetchIndexers,
  editingType,
  cancelEdit,
  startCreateFor,
})

onMounted(fetchIndexers)

/**
 * A built-in adapter has translated copy keyed on its type; a plugin can only supply untranslated
 * English, because plugin text cannot go through the translation workflow. So a message key is
 * preferred where one exists and the descriptor string is the fallback.
 */
function adapterLabel(adapter: IndexerAdapterDescriptor): string {
  const key = `settings.system.requests.indexers.types.${adapter.type}`
  return adapter.builtIn && te(key) ? t(key) : adapter.label
}

function baseUrlHint(type: string): string {
  const adapter = adapterFor(type)
  const key = `settings.system.requests.indexers.fields.baseUrlHint.${type}`
  if (adapter?.builtIn && te(key)) return t(key)
  return adapter?.baseUrlHint ?? ''
}

/**
 * A row whose adapter is not part of this build, which happens after an upgrade drops one or a
 * plugin fails to load. It is kept rather than deleted so an encrypted credential is not silently
 * lost, so the list has to say why it will not work.
 */
function isAvailable(type: string) {
  return adapters.value.some((adapter) => adapter.type === type)
}

/** Plugin field labels are untranslated English; a built-in prefers its own message key. */
function settingLabel(field: IndexerSettingsField): string {
  const key = `settings.system.requests.indexers.fields.${field.key}`
  return te(key) ? t(key) : field.label
}

/** Deleting the last source built on a plugin is deleting the plugin; the sheet says so first. */
async function handleDelete() {
  const indexer = editingIndexer.value
  if (!indexer) return

  if (!isBuiltInAdapter(indexer.adapterType)) {
    await removeInstalledPlugin(indexer.adapterType)
    return
  }

  const removed = await remove(indexer.id)
  if (!removed) {
    toast.error(t('settings.system.requests.indexers.errors.deleteFailed'))
    return
  }
  toast.success(t('settings.system.requests.indexers.deleted'))
  if (draft.value?.id === indexer.id) cancelEdit()
}

async function handleTest(indexer: IndexerItem) {
  testingId.value = indexer.id
  try {
    const result = await test(indexer.id)
    if (result.success) toast.success(t('settings.system.requests.indexers.testOk', { name: result.indexerName ?? indexer.name }))
    else toast.error(result.error ?? t('settings.system.requests.indexers.errors.testFailed'))
  } finally {
    testingId.value = null
  }
}

/**
 * Turning a source off from its row. The same `enabled` flag the editor writes, sent on its own so
 * a row with a stored credential is not round-tripped through a form to be silenced for an hour.
 */
async function handleToggleEnabled(indexer: IndexerItem, enabled: boolean) {
  togglingId.value = indexer.id
  try {
    const failure = await save(indexer.id, { enabled })
    if (failure) {
      toast.error(describeFailure(failure))
      return
    }
    const key = enabled ? 'settings.system.requests.indexers.enabledNotice' : 'settings.system.requests.indexers.disabledNotice'
    toast.success(t(key, { name: indexer.name }))
  } finally {
    togglingId.value = null
  }
}

const testLabel = computed(() => (isDirty.value ? t('settings.system.requests.indexers.testSaveFirst') : t('settings.system.requests.indexers.test')))

function handleTestCurrent() {
  const indexer = editingIndexer.value
  if (indexer && !isDirty.value) void handleTest(indexer)
}
</script>

<template>
  <div v-if="loading" class="settings-loading-state">
    <Loader2 class="size-5 animate-spin text-muted-foreground" />
    <span class="sr-only">{{ t('settings.system.requests.indexers.loading') }}</span>
  </div>

  <div v-else class="space-y-4">
    <p v-if="loadFailed" role="alert" class="text-sm text-destructive">{{ t('settings.system.requests.indexers.errors.loadFailed') }}</p>

    <!--
      Kept outside both groups. It is how a plugin is chosen from the empty panel too, and that
      panel replaces the section this input used to live in.
    -->
    <input
      v-if="canInstallPlugins"
      ref="pluginInput"
      type="file"
      accept=".mjs"
      class="sr-only"
      :aria-label="t('settings.system.requests.indexers.plugins.install')"
      @change="handlePluginChosen"
    />

    <!--
      Said once, above the list rather than on any row. BookOrbit bundles no source: every row here
      is an address or a plugin somebody added, and the page that names Prowlarr and Jackett is the
      one place where whose responsibility that is has to be stated plainly.
    -->
    <p class="settings-hint">{{ t('settings.system.requests.indexers.posture') }}</p>

    <p v-if="pluginRestartPending" role="status" class="settings-hint text-primary">
      {{ t('settings.system.requests.indexers.plugins.restartRequired') }}
    </p>

    <!--
      A list of rows that are all switched off looks configured, and this page is where somebody
      comes to find out why nothing is being searched. Stated above the groups rather than on each
      row, because the fact is about the set rather than about any one source.
    -->
    <p v-if="allSourcesDisabled" role="status" class="settings-hint text-warning">
      {{ t('settings.system.requests.indexers.allDisabled') }}
    </p>

    <RequestSourcesEmpty
      v-if="nothingConfigured"
      :can-install-plugins="canInstallPlugins"
      @install-plugin="startPluginInstall"
      @add-indexer="startCreate"
    />

    <!--
      Two things, added two ways. A plugin is a file you install and then fill in; a Torznab indexer
      is an address you already have. Everything else on this page used to be the seam between those
      two being explained rather than shown.
    -->
    <!-- A wider gap than anything inside a group takes, so the two labels read as a boundary. -->
    <div v-else class="space-y-6">
      <section aria-labelledby="request-plugins-heading" class="space-y-3">
        <!-- Label and hint are one block, and the row keeps a button's height whether it has one or
             not, so both groups read at the same rhythm. -->
        <div>
          <div class="flex min-h-8 items-center justify-between gap-2">
            <h2 id="request-plugins-heading" class="settings-group-label mb-0">{{ t('settings.system.requests.indexers.plugins.title') }}</h2>
            <!-- Only while the group has rows. With none, the one call to action lives in the slot
                 below rather than twice on the same line of the page. -->
            <Button v-if="canInstallPlugins && pluginRows.length" size="sm" variant="outline" :disabled="pluginBusy" @click="startPluginInstall">
              <Upload :size="14" aria-hidden="true" />
              {{ t('settings.system.requests.indexers.plugins.install') }}
            </Button>
          </div>

          <p class="settings-hint settings-prose mt-1.5">
            {{ t('settings.system.requests.indexers.plugins.hint') }}
            <PluginDirectoryLink v-if="canInstallPlugins" />
          </p>
        </div>

        <div v-if="!pluginRows.length" class="settings-empty-state flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 text-start md:px-5">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
            <Plug :size="17" />
          </span>
          <p role="status" class="min-w-56 flex-1 text-sm text-muted-foreground">
            {{ t('settings.system.requests.indexers.plugins.none') }}
          </p>
          <Button v-if="canInstallPlugins" size="sm" variant="outline" :disabled="pluginBusy" @click="startPluginInstall">
            <Upload :size="14" aria-hidden="true" />
            {{ t('settings.system.requests.indexers.plugins.install') }}
          </Button>
        </div>

        <ul v-else class="space-y-2">
          <li v-for="row in pluginRows" :key="row.key" class="settings-card">
            <!-- Known by its directory, not its type: it never loaded, so it declared nothing. -->
            <div
              v-if="row.kind === 'broken'"
              role="status"
              class="flex flex-wrap items-start justify-between gap-3 rounded-[inherit] bg-card px-4 py-3.5 ring-1 ring-destructive/40 md:px-5 md:py-4"
            >
              <div class="flex min-w-0 flex-1 basis-72 gap-3">
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/12 text-destructive" aria-hidden="true">
                  <TriangleAlert :size="17" />
                </span>
                <div class="min-w-0">
                  <p class="settings-label">{{ t('settings.system.requests.indexers.plugins.brokenTitle') }}</p>
                  <p class="mt-1 text-xs break-words text-destructive">
                    {{ t('settings.system.requests.indexers.pluginFailed', { directory: row.failure.directory, reason: row.failure.reason }) }}
                  </p>
                </div>
              </div>
              <Button
                v-if="canInstallPlugins"
                size="sm"
                variant="destructive-outline"
                :disabled="pluginBusy || removingPlugin === row.failure.directory"
                @click="askRemovePluginType(row.failure.directory, row.failure.directory)"
              >
                <Loader2 v-if="removingPlugin === row.failure.directory" class="animate-spin" aria-hidden="true" />
                <Trash2 v-else :size="15" aria-hidden="true" />
                {{ t('settings.system.requests.indexers.plugins.removeAction') }}
              </Button>
            </div>

            <!-- Installed, never filled in. The row it will become, with the step that gets it there. -->
            <div v-else-if="row.kind === 'pending'" class="flex flex-wrap items-start justify-between gap-3 bg-card px-4 py-3.5 md:px-5 md:py-4">
              <div class="flex min-w-0 flex-1 basis-72 gap-3">
                <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
                  <Plug :size="17" />
                </span>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="settings-label">{{ row.adapter.label }}</p>
                    <PluginVersionBadge :version="row.adapter.version" />
                    <span class="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {{ t('settings.system.requests.indexers.plugins.notSetUp') }}
                    </span>
                  </div>
                  <p class="mt-1 font-mono text-xs break-all text-muted-foreground">{{ row.adapter.type }}</p>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  :aria-label="t('settings.system.requests.indexers.plugins.configureAria', { label: row.adapter.label })"
                  @click="startCreateFor(row.adapter.type)"
                >
                  {{ t('settings.system.requests.indexers.plugins.configure') }}
                </Button>

                <TooltipProvider v-if="canInstallPlugins" :delay-duration="0">
                  <span class="mx-0.5 h-5 w-px bg-border" aria-hidden="true"></span>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        :disabled="pluginBusy || removingPlugin === row.adapter.type"
                        :aria-label="t('settings.system.requests.indexers.plugins.update')"
                        @click="startPluginUpdate(row.adapter)"
                      >
                        <Upload :size="15" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{{ t('settings.system.requests.indexers.plugins.update') }}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        size="icon-sm"
                        variant="destructive-outline"
                        :disabled="pluginBusy || removingPlugin === row.adapter.type"
                        :aria-label="t('settings.system.requests.indexers.plugins.removeAction')"
                        @click="askRemovePlugin(row.adapter)"
                      >
                        <Loader2 v-if="removingPlugin === row.adapter.type" class="animate-spin" aria-hidden="true" />
                        <Trash2 v-else :size="15" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{{ t('settings.system.requests.indexers.plugins.removeAction') }}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>

            <RequestSourceRow
              v-else
              plugin
              :indexer="row.indexer"
              :testing="testingId === row.indexer.id"
              :busy="togglingId === row.indexer.id"
              :available="isAvailable(row.indexer.adapterType)"
              :plugin-version="adapterFor(row.indexer.adapterType)?.version"
              :manage-plugin="canInstallPlugins"
              :plugin-busy="pluginBusy || removingPlugin === row.indexer.adapterType"
              @test="handleTest(row.indexer)"
              @edit="startEdit(row.indexer)"
              @toggle="handleToggleEnabled(row.indexer, $event)"
              @update-plugin="handleRowPluginUpdate(row.indexer.adapterType)"
              @remove-plugin="handleRowPluginRemove(row.indexer.adapterType)"
            />
          </li>
        </ul>
      </section>

      <section aria-labelledby="request-indexers-heading" class="space-y-3">
        <div>
          <div class="flex min-h-8 items-center justify-between gap-2">
            <h2 id="request-indexers-heading" class="settings-group-label mb-0">{{ t('settings.system.requests.indexers.title') }}</h2>
            <Button v-if="torznabRows.length" size="sm" variant="outline" @click="startCreate">
              <Plus :size="14" aria-hidden="true" />
              {{ t('settings.system.requests.indexers.add') }}
            </Button>
          </div>

          <p class="settings-hint settings-prose mt-1.5">{{ t('settings.system.requests.indexers.hint') }}</p>
        </div>

        <div v-if="!torznabRows.length" class="settings-empty-state flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 text-start md:px-5">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
            <ServerIcon :size="17" />
          </span>
          <p role="status" class="min-w-56 flex-1 text-sm text-muted-foreground">
            {{ t('settings.system.requests.indexers.none') }}
          </p>
          <Button size="sm" variant="outline" @click="startCreate">
            <Plus :size="14" aria-hidden="true" />
            {{ t('settings.system.requests.indexers.add') }}
          </Button>
        </div>

        <ul v-else class="space-y-2">
          <li v-for="indexer in torznabRows" :key="indexer.id" class="settings-card">
            <RequestSourceRow
              :indexer="indexer"
              :testing="testingId === indexer.id"
              :busy="togglingId === indexer.id"
              :available="isAvailable(indexer.adapterType)"
              @test="handleTest(indexer)"
              @edit="startEdit(indexer)"
              @toggle="handleToggleEnabled(indexer, $event)"
            />
          </li>
        </ul>
      </section>
    </div>

    <SettingsEditorSheet
      v-if="draft"
      :open="editorOpen"
      :title="sheetTitle"
      :description="t('settings.system.requests.indexers.editorDescription')"
      :dirty="isDirty"
      :busy="saving || removingPlugin !== null"
      :removable="draft.id !== null && (editingPluginType === null || canInstallPlugins)"
      :remove-label="
        editingPluginType ? t('settings.system.requests.indexers.plugins.removeAction') : t('settings.system.requests.indexers.confirmDelete.confirm')
      "
      :remove-confirm="
        editingPluginType
          ? t('settings.system.requests.indexers.plugins.confirmRemove', { label: editingPlugin?.label ?? draft.name })
          : t('settings.system.requests.indexers.confirmDelete.title')
      "
      :remove-consequence="
        editingPluginType
          ? t('settings.system.requests.indexers.plugins.removeWarning', { count: pluginUseCount })
          : t('settings.system.requests.indexers.confirmDelete.description', { name: draft.name })
      "
      @save="handleSave"
      @cancel="cancelEdit"
      @remove="handleDelete"
    >
      <template #badge>
        <span class="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {{ draft.adapterType }}
        </span>
        <PluginVersionBadge v-if="currentAdapter && !currentAdapter.builtIn" :version="currentAdapter.version" />
      </template>

      <template #status>
        <ConnectionHealth
          v-if="editingIndexer"
          :last-tested-at="editingIndexer.lastTestedAt"
          :last-test-ok="editingIndexer.lastTestOk"
          :enabled="editingIndexer.enabled"
        />
      </template>

      <template #actions>
        <TooltipProvider v-if="editingIndexer" :delay-duration="0">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                size="icon-sm"
                variant="outline"
                class="aria-disabled:pointer-events-auto aria-disabled:opacity-50"
                :disabled="testingId === editingIndexer.id"
                :aria-disabled="isDirty || undefined"
                :aria-label="testLabel"
                @click="handleTestCurrent"
              >
                <Loader2 v-if="testingId === editingIndexer.id" class="animate-spin" aria-hidden="true" />
                <Plug v-else :size="15" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ testLabel }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </template>

      <template #default>
        <SettingsSection :title="t('settings.system.requests.sections.connection')">
          <!-- The type is settled in the picker before this form exists, and is fixed afterwards:
               a row carries that adapter's base URL, categories and settings, so swapping it here
               would leave every one of them describing an adapter that no longer applies. It is
               stated in the header badge instead. -->
          <SettingsField :label="t('settings.system.requests.indexers.fields.name')" input-id="indexer-name" required :error="fieldErrors.name">
            <template #default="{ describedBy, invalid }">
              <input
                id="indexer-name"
                v-model="draft.name"
                type="text"
                class="settings-control"
                autocomplete="off"
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
                @input="handleNameInput"
              />
            </template>
          </SettingsField>

          <SourceColorPicker v-model="draft.color" input-name="indexer-color" />

          <SettingsField
            :label="t('settings.system.requests.indexers.fields.baseUrl')"
            input-id="indexer-url"
            required
            :brief="baseUrlHint(draft.adapterType)"
            :error="fieldErrors.baseUrl"
          >
            <template #default="{ describedBy, invalid }">
              <input
                id="indexer-url"
                v-model="draft.baseUrl"
                type="url"
                class="settings-control font-mono text-[13px]"
                placeholder="https://indexer.example.com"
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
                @input="handleBaseUrlInput"
              />
            </template>
          </SettingsField>

          <SettingsField
            v-if="currentAdapter?.credentialKind"
            :label="t(`settings.system.requests.indexers.fields.credential.${currentAdapter.credentialKind}`)"
            input-id="indexer-credential"
            :brief="t('settings.system.requests.indexers.fields.credentialBrief')"
            :error="fieldErrors.credential"
          >
            <template #default="{ describedBy, invalid }">
              <div class="flex gap-2">
                <!-- A tracker credential is not the BookOrbit login, so it must not be an
                     input[type=password]: see `@/lib/secret-input`. -->
                <input
                  id="indexer-credential"
                  v-model="draft.credential"
                  v-bind="SECRET_INPUT_ATTRS"
                  type="text"
                  class="settings-control"
                  :class="{ 'input-secret': !credentialVisible }"
                  :disabled="draft.credentialCleared"
                  :placeholder="
                    draft.credentialCleared
                      ? t('settings.system.requests.indexers.fields.credentialWillClear')
                      : draft.id === null
                        ? ''
                        : t('settings.system.requests.indexers.fields.credentialKeep')
                  "
                  :aria-describedby="describedBy"
                  :aria-invalid="invalid || undefined"
                  @input="markCredentialTouched"
                />
                <Button v-if="!draft.credentialCleared" size="sm" variant="outline" class="h-9 shrink-0" @click="toggleCredentialVisible">
                  {{ credentialVisible ? t('common.hide') : t('common.show') }}
                </Button>
                <Button v-if="canClearCredential" size="sm" variant="outline" class="h-9 shrink-0" @click="toggleClearCredential">
                  {{
                    draft.credentialCleared
                      ? t('settings.system.requests.indexers.fields.credentialKeepAction')
                      : t('settings.system.requests.indexers.fields.credentialClear')
                  }}
                </Button>
              </div>
            </template>
          </SettingsField>
        </SettingsSection>

        <SettingsSection :title="t('settings.system.requests.sections.search')">
          <fieldset v-if="canScopeMediaKinds">
            <legend class="settings-label">{{ t('settings.system.requests.indexers.mediaKinds.label') }}</legend>
            <p class="settings-hint">{{ t('settings.system.requests.indexers.mediaKinds.hint') }}</p>

            <div class="mt-3 grid gap-3 sm:grid-cols-3">
              <SettingsToggleField
                v-for="mediaKind in BOOK_REQUEST_MEDIA_KINDS"
                :key="mediaKind"
                :model-value="isMediaKindSearched(mediaKind)"
                :label="t(`bookRequests.mediaKind.${mediaKind}`)"
                :input-id="`indexer-media-${mediaKind}`"
                :disabled="!adapterCarries(mediaKind)"
                :brief="adapterCarries(mediaKind) ? undefined : t('settings.system.requests.indexers.mediaKinds.notCarried')"
                @update:model-value="toggleMediaKind(mediaKind)"
              />
            </div>
          </fieldset>

          <SettingsToggleField
            v-if="currentAdapter?.supportsIsbnSearch"
            v-model="draft.searchByIsbn"
            :label="t('settings.system.requests.indexers.fields.searchByIsbn')"
            input-id="indexer-search-by-isbn"
            :brief="t('settings.system.requests.indexers.fields.searchByIsbnBrief')"
          />

          <div v-if="currentAdapter?.usesCategories" class="grid gap-4 sm:grid-cols-3">
            <SettingsField
              v-for="mediaKind in BOOK_REQUEST_MEDIA_KINDS"
              :key="mediaKind"
              class="sm:[&_.settings-hint]:whitespace-nowrap"
              :label="t(`bookRequests.mediaKind.${mediaKind}`)"
              :input-id="`indexer-categories-${mediaKind}`"
              :brief="mediaKind === 'ebook' ? t('settings.system.requests.indexers.categories.brief') : undefined"
            >
              <template #default="{ describedBy }">
                <ChipInput
                  v-model="draft.categories[mediaKind]"
                  :input-id="`indexer-categories-${mediaKind}`"
                  :normalize="normalizeCategory"
                  input-mode="numeric"
                  control-class="min-h-9"
                  :described-by="describedBy"
                  placeholder="7020"
                />
              </template>
            </SettingsField>
          </div>
        </SettingsSection>

        <SettingsSection v-if="currentAdapter?.settingsFields.length" :title="t('settings.system.requests.sections.access')">
          <template v-for="field in currentAdapter.settingsFields" :key="field.key">
            <SettingsToggleField
              v-if="field.type === 'boolean'"
              :model-value="Boolean(draft.settings[field.key])"
              :label="settingLabel(field)"
              :input-id="`indexer-setting-${field.key}`"
              :brief="field.hint"
              @update:model-value="setSetting(field.key, $event)"
            />

            <SettingsField
              v-else-if="field.format === 'list'"
              :label="settingLabel(field)"
              :input-id="`indexer-setting-${field.key}`"
              :brief="field.hint"
              :required="Boolean(field.minItems)"
            >
              <template #default="{ describedBy }">
                <div v-if="field.options" class="space-y-2">
                  <div
                    :id="`indexer-setting-${field.key}`"
                    role="group"
                    class="flex flex-wrap gap-2"
                    :aria-label="settingLabel(field)"
                    :aria-describedby="describedBy"
                  >
                    <button
                      v-for="option in field.options"
                      :key="option"
                      type="button"
                      class="rounded-full border px-3 py-1.5 font-mono text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      :class="
                        isSettingOptionSelected(field, option)
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                      "
                      :aria-pressed="isSettingOptionSelected(field, option)"
                      :disabled="isSettingOptionLocked(field, option)"
                      @click="toggleSettingOption(field, option)"
                    >
                      {{ option }}
                    </button>
                  </div>
                  <button
                    v-if="canRestoreSettingDefault(field)"
                    type="button"
                    class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    @click="restoreSettingDefault(field)"
                  >
                    {{ t('settings.system.requests.indexers.settings.restoreDefault') }}
                  </button>
                </div>
                <ChipInput
                  v-else
                  :model-value="settingList(field)"
                  :input-id="`indexer-setting-${field.key}`"
                  control-class="min-h-9"
                  :described-by="describedBy"
                  @update:model-value="setSettingList(field, $event)"
                />
              </template>
            </SettingsField>

            <SettingsField v-else :label="settingLabel(field)" :input-id="`indexer-setting-${field.key}`" :brief="field.hint">
              <template #default="{ describedBy }">
                <input
                  :id="`indexer-setting-${field.key}`"
                  :type="field.type === 'number' ? 'number' : 'text'"
                  :value="draft.settings[field.key] ?? ''"
                  class="settings-control"
                  :class="field.type === 'number' ? 'max-w-32' : ''"
                  :aria-describedby="describedBy"
                  @input="handleSettingInput(field, $event)"
                />
              </template>
            </SettingsField>
          </template>
        </SettingsSection>

        <SettingsSection :title="t('settings.system.requests.sections.availability')">
          <div class="grid gap-4 sm:grid-cols-2">
            <SettingsToggleField v-model="draft.enabled" :label="t('settings.system.requests.indexers.fields.enabled')" input-id="indexer-enabled" />
            <SettingsToggleField
              v-model="draft.allowPrivateAddress"
              :label="t('settings.system.requests.indexers.fields.allowPrivateAddress')"
              input-id="indexer-allow-private"
              :brief="t('settings.system.requests.indexers.fields.allowPrivateAddressBrief')"
            />
          </div>
        </SettingsSection>

        <details class="border-t border-border pt-4" :open="Boolean(draft.resolvers.length || draft.proxyUrl)">
          <summary class="settings-label cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
            {{ t('settings.system.requests.indexers.network.title') }}
          </summary>
          <p class="settings-hint mt-1">{{ t('settings.system.requests.indexers.network.brief') }}</p>

          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <SettingsField
              :label="t('settings.system.requests.indexers.network.resolvers')"
              input-id="indexer-resolvers"
              :brief="t('settings.system.requests.indexers.network.resolversBrief')"
            >
              <template #default="{ describedBy }">
                <ChipInput
                  v-model="draft.resolvers"
                  input-id="indexer-resolvers"
                  control-class="min-h-9"
                  :described-by="describedBy"
                  placeholder="1.1.1.1"
                />
              </template>
            </SettingsField>

            <SettingsField
              :label="t('settings.system.requests.indexers.network.proxyUrl')"
              input-id="indexer-proxy"
              :brief="t('settings.system.requests.indexers.network.proxyHint')"
            >
              <template #default="{ describedBy }">
                <input
                  id="indexer-proxy"
                  v-model="draft.proxyUrl"
                  type="url"
                  class="settings-control font-mono text-[13px]"
                  placeholder="http://proxy.example.com:8080"
                  :aria-describedby="describedBy"
                />
              </template>
            </SettingsField>
          </div>
        </details>

        <SettingsSection v-if="editingPluginType" :title="t('settings.system.requests.indexers.plugins.sectionTitle')">
          <p class="text-xs">
            <span class="font-mono break-all text-foreground">{{ editingPluginType }}</span>
            <span class="ms-1 text-muted-foreground">&middot; {{ pluginUsage }}</span>
          </p>
          <p class="settings-hint">
            {{
              editingPlugin ? t('settings.system.requests.indexers.plugins.managedHint') : t('settings.system.requests.indexers.plugins.missingHint')
            }}
          </p>
        </SettingsSection>
      </template>
    </SettingsEditorSheet>

    <ConfirmDialog
      :open="pluginPendingRemoval !== null"
      :title="t('settings.system.requests.indexers.plugins.confirmRemove', { label: pluginPendingRemoval?.label ?? '' })"
      :description="
        pendingRemovalUsage > 0
          ? t('settings.system.requests.indexers.plugins.removeWarning', { count: pendingRemovalUsage })
          : t('settings.system.requests.indexers.plugins.removeUnusedWarning')
      "
      :confirm-label="t('settings.system.requests.indexers.plugins.removeAction')"
      :busy="removingPlugin !== null"
      @confirm="confirmRemovePlugin"
      @cancel="cancelRemovePlugin"
    />

    <!--
      The source is shown rather than summarised. Installing a plugin runs its code in the server
      process, and one dependency-free file is what makes reading it first a realistic thing to ask.
    -->
    <SettingsEditorSheet
      :open="pluginReview !== null"
      :title="
        pluginReview?.replaces
          ? t('settings.system.requests.indexers.plugins.replaceTitle')
          : t('settings.system.requests.indexers.plugins.reviewTitle')
      "
      :description="t('settings.system.requests.indexers.plugins.reviewDescription')"
      :busy="pluginBusy"
      @save="confirmPluginInstall"
      @cancel="cancelPluginInstall"
    >
      <template v-if="pluginReview" #default>
        <SettingsSection :title="t('settings.system.requests.indexers.plugins.declares')">
          <dl class="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt class="settings-hint">{{ t('settings.system.requests.indexers.fields.name') }}</dt>
              <dd class="text-foreground">{{ pluginReview.label }}</dd>
            </div>
            <div>
              <dt class="settings-hint">{{ t('settings.system.requests.indexers.plugins.type') }}</dt>
              <dd class="text-foreground">{{ pluginReview.type }}</dd>
            </div>
            <div>
              <dt class="settings-hint">{{ t('settings.system.requests.indexers.plugins.version') }}</dt>
              <dd class="text-foreground">
                {{ pluginReview.version ?? t('settings.system.requests.indexers.plugins.versionUnknownValue') }}
              </dd>
            </div>
            <div>
              <dt class="settings-hint">{{ t('settings.system.requests.indexers.plugins.media') }}</dt>
              <dd class="text-foreground">{{ pluginReview.mediaKinds.join(', ') }}</dd>
            </div>
            <div>
              <dt class="settings-hint">{{ t('settings.system.requests.indexers.plugins.credential') }}</dt>
              <dd class="text-foreground">
                {{
                  pluginReview.requiresCredential
                    ? t('settings.system.requests.indexers.plugins.credentialRequired')
                    : t('settings.system.requests.indexers.plugins.credentialNone')
                }}
              </dd>
            </div>
          </dl>

          <p role="alert" class="settings-hint text-destructive">
            {{ t('settings.system.requests.indexers.plugins.trustWarning') }}
          </p>
          <p v-if="pluginReview.replaces" role="status" class="settings-hint text-primary">
            {{ t('settings.system.requests.indexers.plugins.replaces', { type: pluginReview.type }) }}
          </p>
        </SettingsSection>

        <SettingsSection :title="t('settings.system.requests.indexers.plugins.source')">
          <pre
            class="max-h-96 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground"
          ><code>{{ pluginReview.source }}</code></pre>
        </SettingsSection>
      </template>

      <!-- This step runs code rather than saving a form, so the action says which of the two it is. -->
      <template #footer="{ requestClose }">
        <div class="flex items-center gap-2">
          <Button size="sm" :disabled="pluginBusy" @click="confirmPluginInstall">
            <Loader2 v-if="pluginBusy" class="animate-spin" aria-hidden="true" />
            {{
              pluginReview?.replaces
                ? t('settings.system.requests.indexers.plugins.replace')
                : t('settings.system.requests.indexers.plugins.confirmInstall')
            }}
          </Button>
          <Button size="sm" variant="outline" :disabled="pluginBusy" @click="requestClose">{{ t('common.cancel') }}</Button>
        </div>
      </template>
    </SettingsEditorSheet>
  </div>
</template>
