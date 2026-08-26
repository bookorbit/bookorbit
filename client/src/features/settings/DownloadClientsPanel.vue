<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Loader2, Pencil, Plug, Plus, Trash2, TriangleAlert } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { DOWNLOAD_CLIENT_TYPES } from '@bookorbit/types'
import type { CreateDownloadClientPayload, DownloadClientItem, DownloadClientType, IndexerColor } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import ConnectionHealth from './ConnectionHealth.vue'
import AdapterTypePicker, { type AdapterTypeOption } from './components/AdapterTypePicker.vue'
import SettingsEditorSheet from './components/SettingsEditorSheet.vue'
import SettingsEmptyPanel from './components/SettingsEmptyPanel.vue'
import SettingsField from './components/SettingsField.vue'
import SettingsSection from './components/SettingsSection.vue'
import SettingsToggleField from './components/SettingsToggleField.vue'
import SourceColorPicker from './components/SourceColorPicker.vue'
import { useSettingsDraft } from './composables/useSettingsDraft'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'
import { useDownloadClients, type DownloadClientFailure } from '@/features/book-requests/composables/useDownloadClients'
import { sourceDotClass } from '@/features/book-requests/sourceColors'

interface MappingDraft {
  remotePath: string
  localPath: string
}

interface ClientDraft {
  id: number | null
  name: string
  color: IndexerColor | null
  adapterType: DownloadClientType
  baseUrl: string
  username: string
  password: string
  /** Only sent when the operator actually typed one, so editing does not wipe a stored secret. */
  passwordTouched: boolean
  passwordCleared: boolean
  enabled: boolean
  priority: number
  category: string
  useHardlinks: boolean
  allowPrivateAddress: boolean
  pathMappings: MappingDraft[]
}

/** The fields a save can be rejected for, so the diagnosis lands on the box that caused it. */
type FieldKey = 'name' | 'baseUrl' | 'password' | 'mappings'

const { t } = useI18n()

/** Reported upwards so the page states the instance-level encryption fact once, not per panel. */
const emit = defineEmits<{ encryptionState: [configured: boolean] }>()

const { clients, encryptionConfigured, loading, saving, loadFailed, fetchClients, save, remove, test, testPathMapping } = useDownloadClients()

watch(encryptionConfigured, (configured) => emit('encryptionState', configured))

const { draft, open: editorOpen, isDirty, start: startDraft, markPristine, close: closeDraft } = useSettingsDraft<ClientDraft>()
/** The create flow starts on the type picker, because the type decides what the form even asks. */
const pickingType = ref(false)
const testingId = ref<number | null>(null)
const passwordVisible = ref(false)
const hardlinkResults = reactive<Record<string, string>>({})
const fieldErrors = reactive<Partial<Record<FieldKey, string>>>({})

/**
 * Server codes carry the copy; the English `message` is a last resort for anything unmapped, which
 * beats swallowing a diagnosis the operator needs to act on.
 */
const SAVE_ERROR_KEYS: Record<string, string> = {
  DOWNLOAD_CLIENT_NAME_TAKEN: 'settings.system.requests.errors.nameTaken',
  DOWNLOAD_CLIENT_URL_UNSAFE: 'settings.system.requests.errors.urlUnsafe',
  DOWNLOAD_CLIENT_URL_PRIVATE: 'settings.system.requests.errors.urlPrivate',
  REQUEST_ENCRYPTION_KEY_MISSING: 'settings.system.requests.errors.encryptionKeyMissing',
  REQUEST_ENCRYPTION_KEY_CHANGED: 'settings.system.requests.errors.encryptionKeyChanged',
  DOWNLOAD_CLIENT_PATH_NOT_ABSOLUTE: 'settings.system.requests.errors.pathNotAbsolute',
  DOWNLOAD_CLIENT_MAPPING_REQUIRED: 'settings.system.requests.errors.mappingRequired',
}

/** Which box a rejection belongs under. Anything unmapped stays a toast, rather than nowhere. */
const SAVE_ERROR_FIELDS: Record<string, FieldKey> = {
  DOWNLOAD_CLIENT_NAME_TAKEN: 'name',
  DOWNLOAD_CLIENT_URL_UNSAFE: 'baseUrl',
  DOWNLOAD_CLIENT_URL_PRIVATE: 'baseUrl',
  REQUEST_ENCRYPTION_KEY_MISSING: 'password',
  REQUEST_ENCRYPTION_KEY_CHANGED: 'password',
  DOWNLOAD_CLIENT_PATH_NOT_ABSOLUTE: 'mappings',
  DOWNLOAD_CLIENT_MAPPING_REQUIRED: 'mappings',
}

function describeFailure(failure: DownloadClientFailure): string {
  const key = failure.errorCode ? SAVE_ERROR_KEYS[failure.errorCode] : undefined
  if (key) return t(key)
  return failure.message ?? t('settings.system.requests.errors.saveFailed')
}

onMounted(fetchClients)

function emptyDraft(adapterType: DownloadClientType): ClientDraft {
  return {
    id: null,
    name: '',
    color: null,
    adapterType,
    baseUrl: '',
    username: '',
    password: '',
    passwordTouched: false,
    passwordCleared: false,
    enabled: true,
    priority: 1,
    category: 'bookorbit',
    useHardlinks: true,
    allowPrivateAddress: true,
    // One row to fill in rather than none: a mapping is required, and starting with an empty
    // section reads as optional right up until the save is refused.
    pathMappings: [{ remotePath: '', localPath: '' }],
  }
}

function openDraft(next: ClientDraft) {
  startDraft(next)
  passwordVisible.value = false
  clearFieldErrors()
}

function startCreate() {
  pickingType.value = hasTypeChoice
  openDraft(emptyDraft('qbittorrent'))
}

function startEdit(client: DownloadClientItem) {
  pickingType.value = false
  openDraft({
    id: client.id,
    name: client.name,
    color: client.color,
    adapterType: client.adapterType,
    baseUrl: client.baseUrl,
    username: client.username ?? '',
    password: '',
    passwordTouched: false,
    passwordCleared: false,
    enabled: client.enabled,
    priority: client.priority,
    category: client.category,
    useHardlinks: client.useHardlinks,
    allowPrivateAddress: client.allowPrivateAddress,
    pathMappings: client.pathMappings.map((mapping) => ({ remotePath: mapping.remotePath, localPath: mapping.localPath })),
  })
}

function cancelEdit() {
  closeDraft()
  pickingType.value = false
  clearFieldErrors()
}

function clearFieldErrors() {
  for (const key of Object.keys(fieldErrors) as FieldKey[]) delete fieldErrors[key]
}

function handleNameInput() {
  delete fieldErrors.name
}

function handleBaseUrlInput() {
  delete fieldErrors.baseUrl
}

function markPasswordTouched() {
  if (!draft.value) return
  draft.value.passwordTouched = draft.value.password.length > 0
  draft.value.passwordCleared = false
  delete fieldErrors.password
}

const canClearPassword = computed(() => editingClient.value?.hasPassword === true)

function toggleClearPassword() {
  const current = draft.value
  if (!current) return
  current.passwordCleared = !current.passwordCleared
  if (current.passwordCleared) {
    current.password = ''
    current.passwordTouched = false
  }
  delete fieldErrors.password
}

function togglePasswordVisible() {
  passwordVisible.value = !passwordVisible.value
}

/**
 * A choice between one thing is not a choice. Every client listed here is somebody else's program
 * that has to be reached over the network, so the picker only earns its step once there are
 * several; with one it goes straight to the form.
 */
const hasTypeChoice = DOWNLOAD_CLIENT_TYPES.length > 1

const typeOptions = computed<AdapterTypeOption[]>(() =>
  DOWNLOAD_CLIENT_TYPES.map((type) => ({
    type,
    label: t(`settings.system.requests.clientTypes.${type}`),
    description: t(`settings.system.requests.clientTypeDescriptions.${type}`),
    builtIn: false,
  })),
)

function handleTypePicked(type: string) {
  if (draft.value) draft.value.adapterType = type as DownloadClientType
}

/** Leaves the picker for the form the chosen client actually needs. */
function confirmType() {
  pickingType.value = false
  markPristine()
}

function addMapping() {
  draft.value?.pathMappings.push({ remotePath: '', localPath: '' })
  delete fieldErrors.mappings
}

function removeMapping(index: number) {
  draft.value?.pathMappings.splice(index, 1)
  delete fieldErrors.mappings
}

/** What the server will actually store, which is what both the save and its validation act on. */
function filledMappings(current: ClientDraft): MappingDraft[] {
  return current.pathMappings
    .filter((mapping) => mapping.remotePath.trim() && mapping.localPath.trim())
    .map((mapping) => ({ remotePath: mapping.remotePath.trim(), localPath: mapping.localPath.trim() }))
}

function toPayload(current: ClientDraft): CreateDownloadClientPayload {
  return {
    name: current.name.trim(),
    color: current.color,
    adapterType: current.adapterType,
    baseUrl: current.baseUrl.trim(),
    username: current.username.trim(),
    ...(current.passwordCleared ? { password: '' } : current.passwordTouched ? { password: current.password } : {}),
    enabled: current.enabled,
    priority: current.priority,
    category: current.category.trim(),
    useHardlinks: current.useHardlinks,
    allowPrivateAddress: current.allowPrivateAddress,
    pathMappings: filledMappings(current),
  }
}

const editingClient = computed(() => (draft.value?.id === null ? null : (clients.value.find((row) => row.id === draft.value?.id) ?? null)))

const sheetTitle = computed(() => {
  if (draft.value === null) return ''
  if (pickingType.value) return t('settings.system.requests.addClient')
  return draft.value.id === null ? t('settings.system.requests.addClient') : draft.value.name || t('settings.system.requests.editClient')
})

async function handleSave() {
  const current = draft.value
  if (!current) return

  clearFieldErrors()
  if (!current.name.trim()) fieldErrors.name = t('settings.system.requests.errors.nameRequired')
  if (!current.baseUrl.trim()) fieldErrors.baseUrl = t('settings.system.requests.errors.urlRequired')
  if (filledMappings(current).length === 0) fieldErrors.mappings = t('settings.system.requests.errors.mappingRequired')
  if (Object.keys(fieldErrors).length > 0) return

  const failure = await save(current.id, toPayload(current))
  if (failure) {
    const field = failure.errorCode ? SAVE_ERROR_FIELDS[failure.errorCode] : undefined
    if (field) fieldErrors[field] = describeFailure(failure)
    else toast.error(describeFailure(failure))
    return
  }
  toast.success(t('settings.system.requests.saved'))
  cancelEdit()
}

async function handleDelete() {
  const client = editingClient.value
  if (!client) return

  const removed = await remove(client.id)
  if (!removed) {
    toast.error(t('settings.system.requests.errors.deleteFailed'))
    return
  }
  toast.success(t('settings.system.requests.deleted'))
  if (draft.value?.id === client.id) cancelEdit()
}

async function handleTest(client: DownloadClientItem) {
  testingId.value = client.id
  try {
    const result = await test(client.id)
    const clientLabel = t(`settings.system.requests.clientTypes.${client.adapterType}`)
    // A separate message rather than an empty placeholder: interpolating "" leaves the trailing
    // space the version would have followed, and a message ending in a space reads as truncated.
    if (result.success)
      toast.success(
        result.version
          ? t('settings.system.requests.testOk', { client: clientLabel, version: result.version })
          : t('settings.system.requests.testOkNoVersion', { client: clientLabel }),
      )
    else toast.error(result.error ?? t('settings.system.requests.errors.testFailed'))
  } finally {
    testingId.value = null
  }
}

const testLabel = computed(() => (isDirty.value ? t('settings.system.requests.testSaveFirst') : t('settings.system.requests.test')))

function handleTestCurrent() {
  const client = editingClient.value
  if (client && !isDirty.value) void handleTest(client)
}

async function handleHardlinkTest(client: DownloadClientItem, mappingId: number) {
  const key = `${client.id}:${mappingId}`
  hardlinkResults[key] = t('settings.system.requests.hardlink.checking')
  const result = await testPathMapping(client.id, mappingId)

  if (result.error) hardlinkResults[key] = result.error
  else if (!result.localPathExists) hardlinkResults[key] = t('settings.system.requests.hardlink.localMissing')
  else if (!result.bookDockPathExists) hardlinkResults[key] = t('settings.system.requests.hardlink.dockMissing')
  else if (result.hardlinkWorks) hardlinkResults[key] = t('settings.system.requests.hardlink.works')
  else if (result.failure) hardlinkResults[key] = t(`settings.system.requests.hardlink.${result.failure}`, { code: result.errorCode ?? '' })
  else hardlinkResults[key] = t('settings.system.requests.hardlink.unavailable')
}

function hardlinkResultFor(client: DownloadClientItem, mappingId: number): string | undefined {
  return hardlinkResults[`${client.id}:${mappingId}`]
}
</script>

<template>
  <div v-if="loading" class="settings-loading-state">
    <Loader2 class="size-5 animate-spin text-muted-foreground" />
    <span class="sr-only">{{ t('settings.system.requests.loading') }}</span>
  </div>

  <div v-else class="space-y-4">
    <p v-if="loadFailed" role="alert" class="text-sm text-destructive">{{ t('settings.system.requests.errors.loadFailed') }}</p>

    <!--
      With no client at all the heading heads nothing, so the panel takes its place and says what
      is actually missing: a direct download still works, a torrent has nowhere to go.
    -->
    <SettingsEmptyPanel
      v-if="clients.length === 0"
      :title="t('settings.system.requests.clientsEmpty.title')"
      :body="t('settings.system.requests.clientsEmpty.body')"
      :note="t('settings.system.requests.clientsEmpty.note')"
    >
      <template #icon>
        <Download :size="18" />
      </template>

      <Button size="sm" @click="startCreate">
        <Plus :size="15" aria-hidden="true" />
        {{ t('settings.system.requests.addClient') }}
      </Button>
    </SettingsEmptyPanel>

    <section v-else aria-labelledby="download-clients-heading" class="space-y-2">
      <div class="flex items-center justify-between">
        <h2 id="download-clients-heading" class="settings-group-label">{{ t('settings.system.requests.clients') }}</h2>
        <Button size="sm" variant="outline" @click="startCreate">
          <Plus :size="14" aria-hidden="true" />
          {{ t('settings.system.requests.addClient') }}
        </Button>
      </div>

      <ul class="space-y-2">
        <li v-for="client in clients" :key="client.id" class="settings-card">
          <div
            class="px-4 py-3.5 bg-card md:px-5 md:py-4"
            :class="client.enabled && client.lastTestOk === false ? 'rounded-[inherit] ring-1 ring-destructive/40' : ''"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="flex min-w-0 flex-1 basis-72 gap-3">
                <span
                  class="flex size-8 shrink-0 items-center justify-center rounded-lg"
                  :class="client.enabled && client.lastTestOk === false ? 'bg-destructive/12 text-destructive' : 'bg-muted text-muted-foreground'"
                  aria-hidden="true"
                >
                  <TriangleAlert v-if="client.enabled && client.lastTestOk === false" :size="17" />
                  <Download v-else :size="17" />
                </span>

                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span
                      v-if="client.color"
                      class="size-2 shrink-0 rounded-full"
                      :class="sourceDotClass(client.color)"
                      :aria-label="t(`settings.system.requests.indexers.color.options.${client.color}`)"
                      role="img"
                    ></span>
                    <p class="settings-label">{{ client.name }}</p>
                    <ConnectionHealth :last-tested-at="client.lastTestedAt" :last-test-ok="client.lastTestOk" :enabled="client.enabled" />
                  </div>

                  <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span v-if="client.baseUrl" class="font-mono break-all">{{ client.baseUrl }}</span>
                    <span v-if="client.baseUrl" class="size-[3px] rounded-full bg-border" aria-hidden="true"></span>
                    <span>{{ client.adapterType }}</span>
                    <span class="size-[3px] rounded-full bg-border" aria-hidden="true"></span>
                    <span>{{ t('settings.system.requests.categoryLabel', { category: client.category }) }}</span>
                    <span class="size-[3px] rounded-full bg-border" aria-hidden="true"></span>
                    <span>{{ t('settings.system.requests.priorityLabel', { priority: client.priority }) }}</span>
                  </div>

                  <p v-if="client.enabled && client.lastTestOk === false && client.lastErrorMessage" class="mt-1.5 text-xs text-destructive">
                    {{ client.lastErrorMessage }}
                  </p>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-1.5">
                <Button size="sm" variant="outline" :disabled="testingId === client.id" @click="handleTest(client)">
                  <Plug :size="14" aria-hidden="true" />
                  {{ t('settings.system.requests.test') }}
                </Button>
                <Button size="sm" variant="outline" @click="startEdit(client)">
                  <Pencil :size="14" aria-hidden="true" />
                  <span class="sr-only">{{ t('settings.system.requests.editClientName', { name: client.name }) }}</span>
                </Button>
              </div>
            </div>

            <ul v-if="client.pathMappings.length" class="mt-3 space-y-2 border-t border-border pt-3">
              <li v-for="mapping in client.pathMappings" :key="mapping.id" class="text-xs">
                <p class="font-mono break-all text-foreground">{{ mapping.remotePath }} &rarr; {{ mapping.localPath }}</p>
                <div class="mt-1 flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" @click="handleHardlinkTest(client, mapping.id)">
                    {{ t('settings.system.requests.hardlink.test') }}
                  </Button>
                  <span v-if="hardlinkResultFor(client, mapping.id)" role="status" class="text-muted-foreground">
                    {{ hardlinkResultFor(client, mapping.id) }}
                  </span>
                </div>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </section>

    <SettingsEditorSheet
      v-if="draft"
      :open="editorOpen"
      :title="sheetTitle"
      :description="t('settings.system.requests.editorDescription')"
      :dirty="isDirty"
      :busy="saving"
      :removable="draft.id !== null"
      :remove-label="t('settings.system.requests.confirmDelete.confirm')"
      :remove-confirm="t('settings.system.requests.confirmDelete.title')"
      :remove-consequence="t('settings.system.requests.confirmDelete.description', { name: draft.name })"
      @save="handleSave"
      @cancel="cancelEdit"
      @remove="handleDelete"
    >
      <template #badge>
        <span v-if="!pickingType" class="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {{ draft.adapterType }}
        </span>
      </template>

      <template #status>
        <ConnectionHealth
          v-if="editingClient"
          :last-tested-at="editingClient.lastTestedAt"
          :last-test-ok="editingClient.lastTestOk"
          :enabled="editingClient.enabled"
        />
      </template>

      <template #actions>
        <TooltipProvider v-if="editingClient" :delay-duration="0">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                size="icon-sm"
                variant="outline"
                class="aria-disabled:pointer-events-auto aria-disabled:opacity-50"
                :disabled="testingId === editingClient.id"
                :aria-disabled="isDirty || undefined"
                :aria-label="testLabel"
                @click="handleTestCurrent"
              >
                <Loader2 v-if="testingId === editingClient.id" class="animate-spin" aria-hidden="true" />
                <Plug v-else :size="15" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ testLabel }}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </template>

      <SettingsSection
        v-if="pickingType"
        :title="t('settings.system.requests.chooseClientType')"
        :brief="t('settings.system.requests.chooseClientTypeHint')"
      >
        <AdapterTypePicker
          :options="typeOptions"
          :selected="draft.adapterType"
          :legend="t('settings.system.requests.chooseClientType')"
          name="download-client-type"
          :built-in-label="t('settings.system.requests.indexers.builtIn')"
          :plugin-label="t('settings.system.requests.external')"
          @select="handleTypePicked"
        />
      </SettingsSection>

      <template v-else>
        <SettingsSection :title="t('settings.system.requests.sections.connection')">
          <div class="grid gap-4 sm:grid-cols-2">
            <SettingsField :label="t('settings.system.requests.fields.name')" input-id="download-client-name" required :error="fieldErrors.name">
              <template #default="{ describedBy, invalid }">
                <input
                  id="download-client-name"
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

            <SettingsField v-if="hasTypeChoice" :label="t('settings.system.requests.fields.type')" input-id="download-client-type">
              <select id="download-client-type" v-model="draft.adapterType" class="settings-control">
                <option v-for="type in DOWNLOAD_CLIENT_TYPES" :key="type" :value="type">
                  {{ t(`settings.system.requests.clientTypes.${type}`) }}
                </option>
              </select>
            </SettingsField>
          </div>

          <SettingsField :label="t('settings.system.requests.fields.baseUrl')" input-id="download-client-url" required :error="fieldErrors.baseUrl">
            <template #default="{ describedBy, invalid }">
              <input
                id="download-client-url"
                v-model="draft.baseUrl"
                type="url"
                class="settings-control font-mono text-[13px]"
                placeholder="http://localhost:8080"
                :aria-describedby="describedBy"
                :aria-invalid="invalid || undefined"
                @input="handleBaseUrlInput"
              />
            </template>
          </SettingsField>

          <SettingsField class="sm:max-w-80" :label="t('settings.system.requests.fields.username')" input-id="download-client-username">
            <input id="download-client-username" v-model="draft.username" type="text" class="settings-control" autocomplete="off" />
          </SettingsField>

          <!-- Full width like the indexer credential: the Show button and a "keep the stored
               password" placeholder do not both fit in half a row. -->
          <SettingsField
            :label="t('settings.system.requests.fields.password')"
            input-id="download-client-password"
            :brief="t('settings.system.requests.fields.passwordBrief')"
            :error="fieldErrors.password"
          >
            <template #default="{ describedBy, invalid }">
              <div class="flex gap-2">
                <!-- A download client credential is not the BookOrbit login, so it must not be an
                     input[type=password]: see `@/lib/secret-input`. -->
                <input
                  id="download-client-password"
                  v-model="draft.password"
                  v-bind="SECRET_INPUT_ATTRS"
                  type="text"
                  class="settings-control"
                  :class="{ 'input-secret': !passwordVisible }"
                  :disabled="draft.passwordCleared"
                  :placeholder="
                    draft.passwordCleared
                      ? t('settings.system.requests.fields.passwordWillClear')
                      : draft.id === null
                        ? ''
                        : t('settings.system.requests.fields.passwordKeep')
                  "
                  :aria-describedby="describedBy"
                  :aria-invalid="invalid || undefined"
                  @input="markPasswordTouched"
                />
                <Button v-if="!draft.passwordCleared" size="sm" variant="outline" class="h-9 shrink-0" @click="togglePasswordVisible">
                  {{ passwordVisible ? t('common.hide') : t('common.show') }}
                </Button>
                <Button v-if="canClearPassword" size="sm" variant="outline" class="h-9 shrink-0" @click="toggleClearPassword">
                  {{
                    draft.passwordCleared
                      ? t('settings.system.requests.fields.passwordKeepAction')
                      : t('settings.system.requests.fields.passwordClear')
                  }}
                </Button>
              </div>
            </template>
          </SettingsField>
        </SettingsSection>

        <SettingsSection :title="t('settings.system.requests.sections.behaviour')">
          <SourceColorPicker
            v-model="draft.color"
            input-name="download-client-color"
            :label="t('settings.system.requests.color.label')"
            :hint="t('settings.system.requests.color.hint')"
            :none-label="t('settings.system.requests.color.none')"
          />

          <!-- Widths belong to the boxes, not to a column count that strands a hint in whatever
               fraction is left over. -->
          <div class="flex flex-wrap gap-x-8 gap-y-4">
            <SettingsField
              class="basis-full sm:basis-80"
              :label="t('settings.system.requests.fields.category')"
              input-id="download-client-category"
              :brief="t('settings.system.requests.fields.categoryHint')"
            >
              <template #default="{ describedBy }">
                <input id="download-client-category" v-model="draft.category" type="text" class="settings-control" :aria-describedby="describedBy" />
              </template>
            </SettingsField>

            <SettingsField class="basis-full sm:basis-40" :label="t('settings.system.requests.fields.priority')" input-id="download-client-priority">
              <input
                id="download-client-priority"
                v-model.number="draft.priority"
                type="number"
                min="1"
                max="100"
                class="settings-control max-w-28"
              />
            </SettingsField>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <SettingsToggleField v-model="draft.enabled" :label="t('settings.system.requests.fields.enabled')" input-id="download-client-enabled" />
            <SettingsToggleField
              v-model="draft.useHardlinks"
              :label="t('settings.system.requests.fields.useHardlinks')"
              input-id="download-client-hardlinks"
              :brief="t('settings.system.requests.fields.useHardlinksBrief')"
            />
            <SettingsToggleField
              v-model="draft.allowPrivateAddress"
              :label="t('settings.system.requests.fields.allowPrivateAddress')"
              input-id="download-client-allow-private"
              :brief="t('settings.system.requests.fields.allowPrivateAddressHint')"
            />
          </div>
        </SettingsSection>

        <SettingsSection :title="t('settings.system.requests.mappings.title')" :brief="t('settings.system.requests.mappings.brief')">
          <p v-if="fieldErrors.mappings" role="alert" class="text-xs text-destructive">{{ fieldErrors.mappings }}</p>
          <p class="text-xs text-muted-foreground">{{ t('settings.system.requests.mappings.identityExample') }}</p>

          <div v-for="(mapping, index) in draft.pathMappings" :key="index" class="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <SettingsField :label="t('settings.system.requests.mappings.remotePath')" :input-id="`mapping-remote-${index}`">
              <input
                :id="`mapping-remote-${index}`"
                v-model="mapping.remotePath"
                type="text"
                class="settings-control font-mono text-[13px]"
                placeholder="/downloads"
              />
            </SettingsField>
            <SettingsField :label="t('settings.system.requests.mappings.localPath')" :input-id="`mapping-local-${index}`">
              <input
                :id="`mapping-local-${index}`"
                v-model="mapping.localPath"
                type="text"
                class="settings-control font-mono text-[13px]"
                placeholder="/data/downloads"
              />
            </SettingsField>
            <Button size="sm" variant="destructive-outline" class="h-9" @click="removeMapping(index)">
              <Trash2 :size="14" aria-hidden="true" />
              <span class="sr-only">{{ t('settings.system.requests.mappings.remove') }}</span>
            </Button>
          </div>

          <div>
            <Button size="sm" variant="outline" @click="addMapping">
              <Plus :size="14" aria-hidden="true" />
              {{ t('settings.system.requests.mappings.add') }}
            </Button>
          </div>
        </SettingsSection>
      </template>

      <template v-if="pickingType" #footer="{ requestClose }">
        <div class="flex items-center gap-2">
          <Button size="sm" @click="confirmType">{{ t('settings.system.requests.continueWithType') }}</Button>
          <Button size="sm" variant="outline" @click="requestClose">{{ t('common.cancel') }}</Button>
        </div>
      </template>
    </SettingsEditorSheet>
  </div>
</template>
