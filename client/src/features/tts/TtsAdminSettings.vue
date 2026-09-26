<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2, Plus } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { VueDraggable } from 'vue-draggable-plus'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import LoadErrorPanel from '@/components/LoadErrorPanel.vue'
import TtsAdminProviderCard from './components/TtsAdminProviderCard.vue'
import TtsAdminProviderForm from './components/TtsAdminProviderForm.vue'
import TtsOpenAiVoiceCuration from './TtsOpenAiVoiceCuration.vue'
import * as ttsApi from './api/tts.api'
import { useTtsAdminProviders, type TtsAdminProvider, type TtsAdminVoice } from './composables/useTtsAdminProviders'
import type { StaticVoiceConfig, TtsDbProvider } from './api/tts.api'

const { t } = useI18n()

const {
  loading,
  loadFailed,
  providers,
  orderedProviders,
  enabledCount,
  curatedVoiceCount,
  health,
  testingKey,
  deletingKey,
  playingVoiceKey,
  previewLoadingKey,
  load,
  setEnabled,
  testConnection,
  removeProvider,
  applyOrder,
  previewVoice,
  stopPreview,
  replaceProvider,
  dispose,
} = useTtsAdminProviders()

const expandedKeys = ref<Set<string>>(new Set())
const showAddForm = ref(false)
const editingKey = ref<string | null>(null)
const curatingProvider = ref<TtsDbProvider | null>(null)
const pendingDeletion = ref<TtsAdminProvider | null>(null)

const editingProvider = computed(() => providers.value.find((provider) => String(provider.id) === editingKey.value) ?? null)

function handleDragReorder(next: TtsAdminProvider[]) {
  void submitOrder(next.map((provider) => provider.key))
}

onMounted(async () => {
  await load()
  if (loadFailed.value) toast.error(t('settings.admin.tts.loadFailed'))
})

onBeforeUnmount(dispose)

function isExpanded(key: string) {
  return expandedKeys.value.has(key)
}

function toggleExpanded(key: string) {
  const next = new Set(expandedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedKeys.value = next
}

async function submitOrder(keys: string[]) {
  try {
    await applyOrder(keys)
  } catch {
    toast.error(t('settings.admin.tts.reorderFailed'))
  }
}

function handleMove(provider: TtsAdminProvider, offset: number) {
  const keys = orderedProviders.value.map((entry) => entry.key)
  const from = keys.indexOf(provider.key)
  const to = from + offset
  if (from === -1 || to < 0 || to >= keys.length) return
  keys.splice(to, 0, ...keys.splice(from, 1))
  void submitOrder(keys)
}

async function handleSetEnabled(provider: TtsAdminProvider, enabled: boolean) {
  if (!enabled) stopPreview()
  try {
    await setEnabled(provider, enabled)
  } catch {
    toast.error(t('settings.admin.tts.enableFailed', { name: provider.name }))
  }
}

async function handlePreview(provider: TtsAdminProvider, voice: TtsAdminVoice) {
  try {
    await previewVoice(provider, voice.id)
  } catch {
    toast.error(t('settings.admin.tts.previewFailed', { name: voice.name }))
  }
}

function handleManageVoices(provider: TtsAdminProvider) {
  stopPreview()
  curatingProvider.value = providers.value.find((entry) => entry.id === provider.id) ?? null
}

function handleEdit(provider: TtsAdminProvider) {
  editingKey.value = provider.key
  showAddForm.value = false
}

function handleCancelEdit() {
  editingKey.value = null
}

function handleShowAddForm() {
  showAddForm.value = true
  editingKey.value = null
}

function handleCancelAdd() {
  showAddForm.value = false
}

function handleProviderSaved(provider: TtsDbProvider) {
  replaceProvider(provider)
  showAddForm.value = false
  editingKey.value = null
}

function handleRequestDelete(provider: TtsAdminProvider) {
  pendingDeletion.value = provider
}

function handleCancelDelete() {
  pendingDeletion.value = null
}

async function handleConfirmDelete() {
  const provider = pendingDeletion.value
  if (!provider) return
  try {
    await removeProvider(provider)
    toast.success(t('settings.admin.tts.deleted'))
  } catch {
    toast.error(t('settings.admin.tts.deleteFailed', { name: provider.name }))
  } finally {
    pendingDeletion.value = null
  }
}

function handleCloseProviderCuration() {
  curatingProvider.value = null
}

async function handleProviderCurationSave(voices: StaticVoiceConfig[]) {
  const provider = curatingProvider.value
  if (!provider) return
  try {
    const updated = await ttsApi.updateProvider(provider.id, { staticVoices: voices })
    replaceProvider(updated)
    curatingProvider.value = updated
  } catch {
    toast.error(t('settings.admin.tts.saveFailed', { name: provider.name }))
  }
}

async function handleTest(provider: TtsAdminProvider) {
  await testConnection(provider)
}

async function handleRetry() {
  await load()
}
</script>

<template>
  <div>
    <div v-if="loading" class="flex items-center justify-center py-16">
      <Loader2 class="size-6 animate-spin text-muted-foreground" />
    </div>

    <LoadErrorPanel v-else-if="loadFailed" :message="t('settings.admin.tts.loadFailed')" @retry="handleRetry" />

    <template v-else>
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <h2 class="text-lg font-semibold text-foreground">{{ t('settings.admin.tts.title') }}</h2>
          <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.admin.tts.subtitle') }}</p>
          <p class="mt-2 text-xs text-muted-foreground">
            {{
              t('settings.admin.tts.summary', {
                providers: orderedProviders.length,
                enabled: enabledCount,
                voices: curatedVoiceCount,
              })
            }}
          </p>
        </div>
        <Button @click="handleShowAddForm">
          <Plus class="size-4" />
          {{ t('settings.admin.tts.addProvider') }}
        </Button>
      </header>

      <TtsAdminProviderForm v-if="showAddForm" class="mt-5" @saved="handleProviderSaved" @cancel="handleCancelAdd" />
      <TtsAdminProviderForm
        v-else-if="editingProvider"
        :key="editingProvider.id"
        class="mt-5"
        :provider="editingProvider"
        @saved="handleProviderSaved"
        @cancel="handleCancelEdit"
      />

      <VueDraggable
        :model-value="orderedProviders"
        class="mt-5 flex flex-col gap-3.5"
        handle=".tts-provider-drag-handle"
        :animation="180"
        @update:model-value="handleDragReorder"
      >
        <div v-for="(provider, index) in orderedProviders" :key="provider.key">
          <TtsAdminProviderCard
            :provider="provider"
            :expanded="isExpanded(provider.key)"
            :health="health[provider.key]"
            :testing="testingKey === provider.key"
            :deleting="deletingKey === provider.key"
            :playing-voice-key="playingVoiceKey"
            :preview-loading-key="previewLoadingKey"
            :can-move-up="index > 0"
            :can-move-down="index < orderedProviders.length - 1"
            @toggle-expanded="toggleExpanded(provider.key)"
            @set-enabled="handleSetEnabled(provider, $event)"
            @test="handleTest(provider)"
            @edit="handleEdit(provider)"
            @manage-voices="handleManageVoices(provider)"
            @remove="handleRequestDelete(provider)"
            @preview="handlePreview(provider, $event)"
            @move-up="handleMove(provider, -1)"
            @move-down="handleMove(provider, 1)"
          />
        </div>
      </VueDraggable>

      <p class="mt-3 text-xs text-muted-foreground">{{ t('settings.admin.tts.reorderHint') }}</p>
    </template>

    <TtsOpenAiVoiceCuration
      v-if="curatingProvider"
      :provider="curatingProvider"
      @save="handleProviderCurationSave"
      @close="handleCloseProviderCuration"
    />

    <ConfirmDialog
      :open="pendingDeletion !== null"
      :title="t('settings.admin.tts.delete')"
      :description="pendingDeletion ? t('settings.admin.tts.deleteConfirm', { name: pendingDeletion.name }) : ''"
      :confirm-label="t('settings.admin.tts.delete')"
      :busy="deletingKey !== null"
      @confirm="handleConfirmDelete"
      @cancel="handleCancelDelete"
    />
  </div>
</template>
