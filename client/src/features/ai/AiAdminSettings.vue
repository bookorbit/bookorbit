<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2, Plus } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { AI_SLOTS, normaliseAiBaseUrl, type AiConnection, type AiSettings, type AiSlot } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import { ApiError, errorMessage } from '@/lib/api-json'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import * as aiApi from './api/ai.api'
import AiConnectionCard from './components/AiConnectionCard.vue'
import AiConnectionDialog, { type AiConnectionPrefill } from './components/AiConnectionDialog.vue'
import AiBudgetSection from './components/AiBudgetSection.vue'
import AiFeaturesSection from './components/AiFeaturesSection.vue'
import AiModelsSection from './components/AiModelsSection.vue'
import AiOverviewSection from './components/AiOverviewSection.vue'
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
const testingId = ref<number | null>(null)
const pendingDelete = ref<AiConnection | null>(null)
const deleting = ref(false)
const inUse = ref<{ connection: AiConnection; message: string; slots: AiSlot[] } | null>(null)
const view = ref<'settings' | 'usage'>('settings')

onMounted(load)

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

function openAdd(withPrefill: AiConnectionPrefill | null = null) {
  editing.value = null
  prefill.value = withPrefill
  dialogOpen.value = true
}

function openEdit(connection: AiConnection) {
  editing.value = connection
  prefill.value = null
  dialogOpen.value = true
}

async function handleSaved(connection: AiConnection, testPassed: boolean) {
  upsertConnection(connection)
  toast.success(t('settings.admin.ai.sheet.saved', { name: connection.name }))
  // The dialog tested the unsaved form; testing the saved connection records the pass on its card.
  if (testPassed) {
    testingId.value = connection.id
    try {
      await aiApi.testSavedConnection(connection.id)
    } catch {
      // The card says Not tested, which is true; the admin can test again from it.
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

async function scrollToAnchor(id: string) {
  await nextTick()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function showConnection(id: number) {
  void scrollToAnchor(`ai-connection-${id}`)
}

function showSlot(slot: AiSlot) {
  void scrollToAnchor(`ai-slot-${slot}`)
}

function closeInUse(goToModels: boolean) {
  const slot = inUse.value?.slots[0]
  inUse.value = null
  if (goToModels && slot) showSlot(slot)
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
 * Saving settings can change what the overview says: a budget, a slot with no prices, a feature.
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
    <SettingsPageHeader :title="t('settings.admin.ai.title')" :subtitle="t('settings.admin.ai.mobileAppsSubtitle')" />

    <AiUsageView v-if="view === 'usage'" @back="closeUsage" />

    <div v-else class="flex flex-col gap-8">
      <AiOverviewSection
        :overview="overview"
        :state="overviewState"
        @retry="loadOverview"
        @view-usage="viewUsage"
        @show-connection="showConnection"
        @show-slot="showSlot"
      />

      <section aria-labelledby="ai-connections-title" class="flex flex-col gap-3" data-testid="ai-connections">
        <div class="flex items-center justify-between gap-4">
          <h3 id="ai-connections-title" class="settings-group-label mb-0">{{ t('settings.admin.ai.connections.title') }}</h3>
          <Button v-if="connectionsState === 'ready' && connections.length > 0" size="sm" @click="openAdd()">
            <Plus class="size-3.5" />
            {{ t('settings.admin.ai.connections.add') }}
          </Button>
        </div>

        <div v-if="connectionsState === 'loading'" class="settings-loading-state">
          <Loader2 class="size-5 animate-spin" aria-hidden="true" />
          <span class="sr-only">{{ t('settings.admin.ai.loading') }}</span>
        </div>

        <div v-else-if="connectionsState === 'error'" class="settings-card">
          <LoadErrorPanel :message="t('settings.admin.ai.connections.loadFailed')" @retry="loadConnections" />
        </div>

        <div v-else-if="connections.length === 0" class="settings-empty-state" data-testid="ai-connections-empty">
          <p class="text-sm font-medium text-foreground">{{ t('settings.admin.ai.connections.emptyTitle') }}</p>
          <p class="mx-auto mt-1 max-w-[52ch] text-xs text-muted-foreground">{{ t('settings.admin.ai.connections.emptyBrief') }}</p>
          <Button class="mt-4" @click="openAdd()">
            <Plus class="size-4" />
            {{ t('settings.admin.ai.connections.add') }}
          </Button>
        </div>

        <div v-else class="flex flex-col gap-3">
          <AiConnectionCard
            v-for="connection in connections"
            :key="connection.id"
            :connection="connection"
            :testing="testingId === connection.id"
            @test="handleTest(connection)"
            @edit="openEdit(connection)"
            @delete="handleDelete(connection)"
          />
        </div>
      </section>

      <AiModelsSection
        :settings="settings"
        :state="settingsState"
        :connections="connections"
        :model-lists="modelLists"
        @retry="loadSettings"
        @updated="handleSettingsUpdated"
        @tried="handleTried"
        @need-models="ensureModels"
        @add-anthropic="addAnthropicConnection"
      />

      <AiFeaturesSection :settings="settings" :state="settingsState" @retry="loadSettings" @updated="handleSettingsUpdated" @show-slot="showSlot" />

      <AiBudgetSection
        :settings="settings"
        :state="settingsState"
        :usage="overview?.budget ?? null"
        @retry="loadSettings"
        @updated="handleSettingsUpdated"
      />
    </div>

    <AiConnectionDialog v-model:open="dialogOpen" :connection="editing" :prefill="prefill" :slot-model="editingSlotModel" @saved="handleSaved" />

    <ConfirmDialog
      v-if="pendingDelete"
      :open="pendingDelete !== null"
      :title="t('settings.admin.ai.connections.deleteTitle', { name: pendingDelete.name })"
      :description="t('settings.admin.ai.connections.deleteConfirm')"
      :confirm-label="t('settings.admin.ai.connections.delete')"
      :busy="deleting"
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />

    <ConfirmDialog
      v-if="inUse"
      :open="inUse !== null"
      :title="t('settings.admin.ai.connections.inUseTitle', { name: inUse.connection.name })"
      :description="inUse.message"
      :confirm-label="inUse.slots.length > 0 ? t('settings.admin.ai.connections.goToModels') : t('common.close')"
      :destructive="false"
      @confirm="closeInUse(true)"
      @cancel="closeInUse(false)"
    />
  </div>
</template>
