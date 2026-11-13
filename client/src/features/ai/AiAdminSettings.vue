<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { AI_SLOTS, normaliseAiBaseUrl, type AiConnection, type AiPresetId, type AiSettings, type AiSlot } from '@bookorbit/types'

import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { ApiError, errorMessage } from '@/lib/api-json'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import * as aiApi from './api/ai.api'
import AiConnectionDialog, { type AiConnectionPrefill } from './components/AiConnectionDialog.vue'
import AiFeaturesSection from './components/AiFeaturesSection.vue'
import AiModelsSection from './components/AiModelsSection.vue'
import AiProvidersSection from './components/AiProvidersSection.vue'
import AiSpendingSection from './components/AiSpendingSection.vue'
import AiStatusStrip from './components/AiStatusStrip.vue'
import AiUsageView from './components/AiUsageView.vue'
import { useAiAdmin } from './composables/useAiAdmin'
import { slotList } from './lib/ai-format'

const { t } = useI18n()

const {
  overview,
  overviewState,
  connections,
  connectionsState,
  settings,
  settingsState,
  modelLists,
  monthUsage,
  load,
  loadOverview,
  loadConnections,
  loadSettings,
  upsertConnection,
  dropConnection,
  applySettings,
  ensureModels,
} = useAiAdmin()
const { loadAppInfo } = useAppInfo()

const dialogOpen = ref(false)
const editing = ref<AiConnection | null>(null)
const prefill = ref<AiConnectionPrefill | null>(null)
const presetId = ref<AiPresetId | null>(null)
const testingId = ref<number | null>(null)
const pendingDelete = ref<AiConnection | null>(null)
const deleting = ref(false)
const inUse = ref<{ connection: AiConnection; message: string; slots: AiSlot[] } | null>(null)
const view = ref<'settings' | 'usage'>('settings')

/**
 * The row editors open on the page, keyed `slot:<id>`, `feature:<id>` or `spend:<row>`. Several can be
 * open at once, so an unsaved draft in one isn't lost by opening another.
 */
const openKeys = shallowRef<ReadonlySet<string>>(new Set())

onMounted(load)

function setOpen(key: string, open: boolean) {
  if (openKeys.value.has(key) === open) return
  const next = new Set(openKeys.value)
  if (open) next.add(key)
  else next.delete(key)
  openKeys.value = next
}

async function scrollToAnchor(id: string) {
  await nextTick()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/** A problem named elsewhere on the page opens the row that fixes it. */
function openRow(key: string, anchorId: string) {
  setOpen(key, true)
  void scrollToAnchor(anchorId)
}

function slotsUsing(connectionId: number): AiSlot[] {
  const slots = settings.value?.slots
  return slots ? AI_SLOTS.filter((slot) => slots[slot].connectionId === connectionId) : []
}

const editingSlotModel = computed(() => {
  const slots = settings.value?.slots
  const id = editing.value?.id
  if (!slots || id === undefined) return null
  return AI_SLOTS.map((slot) => slots[slot]).find((slot) => slot.connectionId === id)?.model ?? null
})

function openAdd(withPrefill: AiConnectionPrefill | null = null, withPreset: AiPresetId | null = null) {
  editing.value = null
  prefill.value = withPrefill
  presetId.value = withPreset
  dialogOpen.value = true
}

function handleAdd(preset: AiPresetId | null) {
  openAdd(null, preset)
}

function handleEdit(connection: AiConnection) {
  editing.value = connection
  prefill.value = null
  presetId.value = null
  dialogOpen.value = true
}

async function handleSaved(connection: AiConnection, testPassed: boolean) {
  upsertConnection(connection)
  toast.success(t('settings.admin.ai.sheet.saved', { name: connection.name }))
  // The dialog tested the unsaved form; testing the saved connection records the pass on its row.
  if (testPassed) {
    testingId.value = connection.id
    try {
      await aiApi.testSavedConnection(connection.id)
    } catch {
      // The row says Not tested, which is true; the admin can test again from it.
    } finally {
      testingId.value = null
    }
  }
  await Promise.all([loadConnections(), loadOverview()])
}

async function handleTest(connection: AiConnection) {
  testingId.value = connection.id
  try {
    const result = await aiApi.testSavedConnection(connection.id)
    if (result.ok) toast.success(t('settings.admin.ai.connections.testPassed', { name: connection.name }))
    else toast.error(t('settings.admin.ai.connections.testFailed', { name: connection.name }))
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.admin.ai.test.failed'))
  } finally {
    testingId.value = null
  }
  await Promise.all([loadConnections(), loadOverview()])
}

/** The status strip names a failing provider by id; its row may still be loading. */
function handleTestConnection(id: number) {
  const connection = connections.value.find((entry) => entry.id === id)
  if (connection) void handleTest(connection)
  else void scrollToAnchor(`ai-connection-${id}`)
}

function slotsMessage(slots: AiSlot[]): string {
  return t('settings.admin.ai.connections.inUseSlots', { count: slots.length, slots: slotList(slots) })
}

function handleDelete(connection: AiConnection) {
  const slots = slotsUsing(connection.id)
  if (slots.length > 0) {
    inUse.value = { connection, message: slotsMessage(slots), slots }
    return
  }
  pendingDelete.value = connection
}

async function confirmDelete() {
  const connection = pendingDelete.value
  if (!connection) return
  deleting.value = true
  try {
    await aiApi.deleteConnection(connection.id)
    dropConnection(connection.id)
    toast.success(t('settings.admin.ai.connections.deleted', { name: connection.name }))
    pendingDelete.value = null
    void loadOverview()
  } catch (reason) {
    pendingDelete.value = null
    if (reason instanceof ApiError && reason.errorCode === 'AI_CONNECTION_IN_USE') {
      const slots = String(reason.errorMeta.slots ?? '')
        .split(',')
        .filter((slot): slot is AiSlot => (AI_SLOTS as readonly string[]).includes(slot))
      inUse.value = { connection, message: slots.length > 0 ? slotsMessage(slots) : reason.message, slots }
      void loadSettings()
    } else {
      toast.error(errorMessage(reason, 'settings.admin.ai.connections.deleteFailed'))
    }
  } finally {
    deleting.value = false
  }
}

function cancelDelete() {
  pendingDelete.value = null
}

function showSlot(slot: AiSlot) {
  openRow(`slot:${slot}`, `ai-slot-${slot}`)
}

function closeInUse(goToModels: boolean) {
  const slot = inUse.value?.slots[0]
  inUse.value = null
  if (goToModels && slot) showSlot(slot)
}

function handleInUseConfirm() {
  closeInUse(true)
}

function handleInUseCancel() {
  closeInUse(false)
}

function handleRaiseLimit() {
  openRow('spend:server', 'ai-spend-server')
}

async function viewUsage() {
  view.value = 'usage'
  await nextTick()
  window.scrollTo({ top: 0 })
}

function closeUsage() {
  view.value = 'settings'
  void loadOverview()
}

/**
 * Saving settings can change what the status strip says: a limit, a slot with no prices, a feature.
 * A feature or slot also changes whether `app-info` says story guides can be built, which book pages
 * read before asking for a guide's status.
 */
function handleSettingsUpdated(next: AiSettings) {
  applySettings(next)
  void loadOverview()
  void loadAppInfo()
}

/** Try it spends money and can mark a slot failing or working again. */
function handleTried() {
  void Promise.all([loadSettings(), loadOverview()])
}

/** Claude through a proxy's OpenAI endpoint loses its schema; the same host's Messages endpoint keeps it. */
function addAnthropicConnection(connection: AiConnection) {
  openAdd({
    name: t('settings.admin.ai.models.anthropicName', { name: connection.name }),
    apiType: 'anthropic-messages',
    baseUrl: normaliseAiBaseUrl(connection.baseUrl, 'anthropic-messages'),
  })
}
</script>

<template>
  <div>
    <p class="mb-[22px] max-w-[100ch] text-sm text-muted-foreground" data-testid="ai-intro">{{ t('settings.admin.ai.mobileAppsSubtitle') }}</p>

    <AiUsageView v-if="view === 'usage'" @back="closeUsage" />

    <div v-else class="flex flex-col gap-7">
      <AiStatusStrip
        :overview="overview"
        :state="overviewState"
        :connections="connections"
        :connections-ready="connectionsState === 'ready'"
        :settings="settings"
        :testing-id="testingId"
        @retry="loadOverview"
        @view-usage="viewUsage"
        @test-connection="handleTestConnection"
        @open-slot="showSlot"
        @raise-limit="handleRaiseLimit"
      />

      <AiProvidersSection
        :connections="connections"
        :state="connectionsState"
        :testing-id="testingId"
        @retry="loadConnections"
        @add="handleAdd"
        @test="handleTest"
        @edit="handleEdit"
        @delete="handleDelete"
      />

      <AiModelsSection
        :settings="settings"
        :state="settingsState"
        :connections="connections"
        :model-lists="modelLists"
        :open-keys="openKeys"
        @retry="loadSettings"
        @updated="handleSettingsUpdated"
        @tried="handleTried"
        @need-models="ensureModels"
        @add-anthropic="addAnthropicConnection"
        @set-open="setOpen"
      />

      <AiFeaturesSection
        :settings="settings"
        :state="settingsState"
        :connections="connections"
        :overview="overview"
        :month-usage="monthUsage"
        :open-keys="openKeys"
        @retry="loadSettings"
        @updated="handleSettingsUpdated"
        @set-open="setOpen"
        @open-slot="showSlot"
      />

      <AiSpendingSection
        :settings="settings"
        :state="settingsState"
        :overview="overview"
        :month-usage="monthUsage"
        :open-keys="openKeys"
        @retry="loadSettings"
        @updated="handleSettingsUpdated"
        @set-open="setOpen"
      />
    </div>

    <AiConnectionDialog
      v-model:open="dialogOpen"
      :connection="editing"
      :prefill="prefill"
      :preset-id="presetId"
      :slot-model="editingSlotModel"
      @saved="handleSaved"
    />

    <ConfirmDialog
      v-if="pendingDelete"
      :open="pendingDelete !== null"
      :title="t('settings.admin.ai.connections.deleteTitle', { name: pendingDelete.name })"
      :description="t('settings.admin.ai.connections.deleteConfirm')"
      :confirm-label="t('settings.admin.ai.connections.delete')"
      :busy="deleting"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />

    <ConfirmDialog
      v-if="inUse"
      :open="inUse !== null"
      :title="t('settings.admin.ai.connections.inUseTitle', { name: inUse.connection.name })"
      :description="inUse.message"
      :confirm-label="inUse.slots.length > 0 ? t('settings.admin.ai.connections.goToModels') : t('common.close')"
      :destructive="false"
      @confirm="handleInUseConfirm"
      @cancel="handleInUseCancel"
    />
  </div>
</template>
