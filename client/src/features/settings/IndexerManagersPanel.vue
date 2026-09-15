<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloudDownload, Loader2, Magnet, RefreshCw, ServerCog } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type {
  CreateIndexerManagerPayload,
  IndexerColor,
  IndexerManagerItem,
  IndexerManagerListResult,
  IndexerManagerTestResult,
  UpdateIndexerManagerPayload,
  UpdateIndexerManagerSourcePayload,
} from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ChipInput from '@/components/ui/ChipInput.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { api } from '@/lib/api'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'
import { sourceDotClass } from '@/features/book-requests/sourceColors'
import ConnectionHealth from './ConnectionHealth.vue'
import ManagedSourceColorControl from './components/ManagedSourceColorControl.vue'
import SettingsEditorSheet from './components/SettingsEditorSheet.vue'
import SettingsField from './components/SettingsField.vue'
import SettingsSection from './components/SettingsSection.vue'
import SettingsToggleField from './components/SettingsToggleField.vue'
import SourceColorPicker from './components/SourceColorPicker.vue'

const emit = defineEmits<{
  configured: [configured: boolean]
  loaded: []
  summary: [summary: { configured: number; active: number; torrent: number; usenet: number }]
}>()
const { t } = useI18n()
const BASE_PATH = '/api/v1/admin/request-indexer-managers'

interface Draft {
  id: number | null
  name: string
  color: IndexerManagerItem['color']
  baseUrl: string
  credential: string
  enabled: boolean
  allowPrivateAddress: boolean
  syncNewIndexers: boolean
  perIndexerTimeoutSeconds: number
  overallSearchBudgetSeconds: number
  autoExpandCategories: boolean
  inheritSeedLimits: boolean
  resolvers: string[]
  proxyUrl: string
}

const managers = ref<IndexerManagerItem[]>([])
const loading = ref(true)
const busy = ref(false)
const activeManagerId = ref<number | null>(null)
const activeSourceId = ref<number | null>(null)
const draft = ref<Draft | null>(null)
const credentialVisible = ref(false)

const sheetTitle = computed(() => (draft.value?.id === null ? t('settings.system.requests.managers.add') : (draft.value?.name ?? '')))
const activeSources = computed(() =>
  managers.value.flatMap((manager) => (manager.enabled ? manager.sources.filter((source) => source.enabled && source.available) : [])),
)
const activeTorrentSources = computed(() => activeSources.value.filter((source) => source.protocol === 'torrent').length)
const activeUsenetSources = computed(() => activeSources.value.filter((source) => source.protocol === 'usenet').length)
const configuredSources = computed(() => managers.value.flatMap((manager) => manager.sources.filter((source) => source.available)).length)

watch(
  [configuredSources, activeSources, activeTorrentSources, activeUsenetSources],
  () =>
    emit('summary', {
      configured: configuredSources.value,
      active: activeSources.value.length,
      torrent: activeTorrentSources.value,
      usenet: activeUsenetSources.value,
    }),
  { immediate: true },
)

onMounted(fetchManagers)

async function fetchManagers() {
  try {
    const res = await api(BASE_PATH)
    if (!res.ok) throw new Error('load failed')
    const result = (await res.json()) as IndexerManagerListResult
    managers.value = Array.isArray(result.managers) ? result.managers : []
    emit('configured', managers.value.length > 0)
  } catch {
    toast.error(t('settings.system.requests.managers.errors.load'))
  } finally {
    loading.value = false
    emit('loaded')
  }
}

function startCreate() {
  credentialVisible.value = false
  draft.value = {
    id: null,
    name: 'Prowlarr',
    color: null,
    baseUrl: '',
    credential: '',
    enabled: true,
    allowPrivateAddress: false,
    syncNewIndexers: true,
    perIndexerTimeoutSeconds: 20,
    overallSearchBudgetSeconds: 60,
    autoExpandCategories: false,
    inheritSeedLimits: true,
    resolvers: [],
    proxyUrl: '',
  }
}

defineExpose({ startCreate })

function startEdit(manager: IndexerManagerItem) {
  credentialVisible.value = false
  draft.value = {
    id: manager.id,
    name: manager.name,
    color: manager.color,
    baseUrl: manager.baseUrl,
    credential: '',
    enabled: manager.enabled,
    allowPrivateAddress: manager.allowPrivateAddress,
    syncNewIndexers: manager.syncNewIndexers,
    perIndexerTimeoutSeconds: manager.perIndexerTimeoutSeconds,
    overallSearchBudgetSeconds: manager.overallSearchBudgetSeconds,
    autoExpandCategories: manager.autoExpandCategories,
    inheritSeedLimits: manager.inheritSeedLimits,
    resolvers: manager.networkProfile?.resolvers ?? [],
    proxyUrl: manager.networkProfile?.proxyUrl ?? '',
  }
}

function closeEditor() {
  draft.value = null
}

function toggleCredentialVisible() {
  credentialVisible.value = !credentialVisible.value
}

async function saveDraft() {
  const current = draft.value
  if (!current) return
  if (!current.name.trim() || !current.baseUrl.trim() || (current.id === null && !current.credential.trim())) {
    toast.error(t('settings.system.requests.managers.errors.required'))
    return
  }

  busy.value = true
  try {
    const common = {
      name: current.name.trim(),
      color: current.color,
      baseUrl: current.baseUrl.trim(),
      enabled: current.enabled,
      allowPrivateAddress: current.allowPrivateAddress,
      syncNewIndexers: current.syncNewIndexers,
      perIndexerTimeoutSeconds: current.perIndexerTimeoutSeconds,
      overallSearchBudgetSeconds: current.overallSearchBudgetSeconds,
      autoExpandCategories: current.autoExpandCategories,
      inheritSeedLimits: current.inheritSeedLimits,
      networkProfile:
        current.resolvers.length || current.proxyUrl.trim()
          ? {
              ...(current.resolvers.length ? { resolvers: current.resolvers } : {}),
              ...(current.proxyUrl.trim() ? { proxyUrl: current.proxyUrl.trim() } : {}),
            }
          : null,
    }
    const payload: CreateIndexerManagerPayload | UpdateIndexerManagerPayload =
      current.id === null
        ? { ...common, type: 'prowlarr', credential: current.credential }
        : {
            ...common,
            ...(current.credential ? { credential: current.credential } : {}),
          }
    const res = await api(current.id === null ? BASE_PATH : `${BASE_PATH}/${current.id}`, {
      method: current.id === null ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        message?: string
      } | null
      throw new Error(body?.message)
    }
    closeEditor()
    await fetchManagers()
    toast.success(t('settings.system.requests.managers.saved'))
  } catch (error) {
    toast.error(error instanceof Error && error.message ? error.message : t('settings.system.requests.managers.errors.save'))
  } finally {
    busy.value = false
  }
}

async function removeCurrent() {
  const id = draft.value?.id
  if (id === null || id === undefined) return
  busy.value = true
  try {
    const res = await api(`${BASE_PATH}/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('delete failed')
    closeEditor()
    await fetchManagers()
    toast.success(t('settings.system.requests.managers.deleted'))
  } catch {
    toast.error(t('settings.system.requests.managers.errors.delete'))
  } finally {
    busy.value = false
  }
}

async function testManager(manager: IndexerManagerItem) {
  activeManagerId.value = manager.id
  try {
    const res = await api(`${BASE_PATH}/${manager.id}/test`, {
      method: 'POST',
    })
    const result = (await res.json().catch(() => ({}))) as IndexerManagerTestResult & { message?: string }
    if (!res.ok || !result.success) throw new Error(result.error ?? result.message)
    toast.success(
      t('settings.system.requests.managers.testOk', {
        version: result.version ?? t('settings.system.requests.managers.unknown'),
        count: result.sourceCount ?? 0,
      }),
    )
    await fetchManagers()
  } catch (error) {
    toast.error(error instanceof Error && error.message ? error.message : t('settings.system.requests.managers.errors.test'))
  } finally {
    activeManagerId.value = null
  }
}

async function syncManager(manager: IndexerManagerItem) {
  activeManagerId.value = manager.id
  try {
    const res = await api(`${BASE_PATH}/${manager.id}/sync`, {
      method: 'POST',
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        message?: string
      } | null
      throw new Error(body?.message)
    }
    await fetchManagers()
    toast.success(t('settings.system.requests.managers.synced'))
  } catch (error) {
    toast.error(error instanceof Error && error.message ? error.message : t('settings.system.requests.managers.errors.sync'))
  } finally {
    activeManagerId.value = null
  }
}

async function updateSource(manager: IndexerManagerItem, sourceId: number, payload: UpdateIndexerManagerSourcePayload) {
  activeSourceId.value = sourceId
  try {
    const res = await api(`${BASE_PATH}/${manager.id}/sources/${sourceId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error('toggle failed')
    const updated = (await res.json()) as IndexerManagerItem
    managers.value = managers.value.map((entry) => (entry.id === manager.id ? updated : entry))
  } catch {
    toast.error(t('settings.system.requests.managers.errors.source'))
  } finally {
    activeSourceId.value = null
  }
}

function toggleSource(manager: IndexerManagerItem, sourceId: number, enabled: boolean) {
  return updateSource(manager, sourceId, { enabled })
}

function setSourceColor(manager: IndexerManagerItem, sourceId: number, color: IndexerColor | null) {
  return updateSource(manager, sourceId, { color })
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="loading" class="settings-loading-state">
      <Loader2 class="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      <span class="sr-only">{{ t('settings.system.requests.managers.loading') }}</span>
    </div>

    <ul v-if="!loading && managers.length" class="space-y-2">
      <li v-for="manager in managers" :key="manager.id" class="settings-card overflow-hidden bg-card">
        <div class="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5 md:px-5 md:py-4">
          <div class="flex min-w-0 flex-1 gap-3">
            <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary" aria-hidden="true">
              <ServerCog :size="17" />
            </span>
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  v-if="manager.color"
                  class="size-2 shrink-0 rounded-full"
                  :class="sourceDotClass(manager.color)"
                  :aria-label="t(`settings.system.requests.indexers.color.options.${manager.color}`)"
                  role="img"
                ></span>
                <p class="settings-label">{{ manager.name }}</p>
                <ConnectionHealth :last-tested-at="manager.lastTestedAt" :last-test-ok="manager.lastTestOk" :enabled="manager.enabled" />
                <span v-if="manager.version" class="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {{ manager.version }}
                </span>
              </div>
              <p class="mt-1 font-mono text-xs break-all text-muted-foreground">
                {{ manager.baseUrl }}
              </p>
              <p v-if="manager.lastSyncError" class="mt-1 text-xs text-destructive">
                {{ manager.lastSyncError }}
              </p>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" :disabled="activeManagerId === manager.id" @click="testManager(manager)">
              <Loader2 v-if="activeManagerId === manager.id" class="animate-spin" aria-hidden="true" />
              {{ t('settings.system.requests.managers.test') }}
            </Button>
            <Button size="sm" variant="outline" :disabled="activeManagerId === manager.id" @click="syncManager(manager)">
              <RefreshCw :size="14" aria-hidden="true" />
              {{ t('settings.system.requests.managers.sync') }}
            </Button>
            <Button size="sm" variant="outline" @click="startEdit(manager)">{{ t('common.edit') }}</Button>
          </div>
        </div>

        <details v-if="manager.sources.length" open class="border-t border-border">
          <summary class="cursor-pointer bg-muted/45 px-4 py-2.5 text-xs font-medium text-muted-foreground marker:text-muted-foreground md:px-5">
            {{
              t('settings.system.requests.managers.managedSources', {
                count: manager.sources.length,
              })
            }}
          </summary>
          <div class="grid gap-px bg-border sm:grid-cols-2">
            <div v-for="source in manager.sources" :key="source.id" class="flex items-center justify-between gap-3 bg-card px-4 py-3 md:px-5">
              <div class="flex min-w-0 items-center gap-3">
                <span class="shrink-0 text-muted-foreground" aria-hidden="true">
                  <CloudDownload v-if="source.protocol === 'usenet'" :size="16" />
                  <Magnet v-else :size="16" />
                </span>
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <ManagedSourceColorControl
                      :source-id="source.id"
                      :source-name="source.name"
                      :color="source.color"
                      :busy="activeSourceId === source.id"
                      @change="setSourceColor(manager, source.id, $event)"
                    />
                    <span class="text-sm font-medium text-foreground">{{ source.name }}</span>
                    <span v-if="!source.available" class="text-xs text-destructive">{{ t('settings.system.requests.managers.unavailable') }}</span>
                  </div>
                  <p class="mt-0.5 text-xs text-muted-foreground">
                    {{ t(`settings.system.requests.managers.protocol.${source.protocol}`) }}
                    <span v-if="source.priority !== null">
                      ·
                      {{
                        t('settings.system.requests.managers.priority', {
                          priority: source.priority,
                        })
                      }}</span
                    >
                  </p>
                </div>
              </div>
              <ToggleSwitch
                :model-value="source.enabled"
                :disabled="activeSourceId === source.id"
                :aria-label="
                  t('settings.system.requests.managers.toggleSource', {
                    name: source.name,
                  })
                "
                @update:model-value="toggleSource(manager, source.id, $event)"
              />
            </div>
          </div>
        </details>
        <p v-else class="border-t border-border px-4 py-3 text-sm text-muted-foreground md:px-5">
          {{ t('settings.system.requests.managers.noSources') }}
        </p>
      </li>
    </ul>

    <SettingsEditorSheet
      v-if="draft"
      :open="true"
      :title="sheetTitle"
      :description="t('settings.system.requests.managers.editorDescription')"
      :busy="busy"
      :removable="draft.id !== null"
      :remove-confirm="t('settings.system.requests.managers.confirmDelete')"
      :remove-consequence="t('settings.system.requests.managers.deleteConsequence')"
      @save="saveDraft"
      @cancel="closeEditor"
      @remove="removeCurrent"
    >
      <SettingsSection :title="t('settings.system.requests.sections.connection')">
        <SettingsField :label="t('settings.system.requests.managers.fields.name')" input-id="manager-name" required>
          <template #default="{ describedBy }">
            <input id="manager-name" v-model="draft.name" class="settings-control" :aria-describedby="describedBy" />
          </template>
        </SettingsField>
        <SourceColorPicker
          v-model="draft.color"
          input-name="manager-color"
          :label="t('settings.system.requests.managers.fields.color')"
          :hint="t('settings.system.requests.managers.fields.colorHint')"
        />
        <SettingsField :label="t('settings.system.requests.managers.fields.baseUrl')" input-id="manager-url" required>
          <template #default="{ describedBy }">
            <input
              id="manager-url"
              v-model="draft.baseUrl"
              type="url"
              class="settings-control font-mono text-[13px]"
              placeholder="http://prowlarr:9696"
              :aria-describedby="describedBy"
            />
          </template>
        </SettingsField>
        <SettingsField
          :label="t('settings.system.requests.managers.fields.apiKey')"
          input-id="manager-key"
          :required="draft.id === null"
          :brief="t('settings.system.requests.managers.fields.apiKeyHint')"
        >
          <template #default="{ describedBy }">
            <div class="flex gap-2">
              <input
                id="manager-key"
                v-model="draft.credential"
                v-bind="SECRET_INPUT_ATTRS"
                type="text"
                class="settings-control"
                :class="{ 'input-secret': !credentialVisible }"
                :placeholder="draft.id === null ? '' : t('settings.system.requests.indexers.fields.credentialKeep')"
                :aria-describedby="describedBy"
              />
              <Button size="sm" variant="outline" class="h-9 shrink-0" @click="toggleCredentialVisible">
                {{ credentialVisible ? t('common.hide') : t('common.show') }}
              </Button>
            </div>
          </template>
        </SettingsField>
        <SettingsToggleField
          v-model="draft.allowPrivateAddress"
          :label="t('settings.system.requests.indexers.fields.allowPrivateAddress')"
          input-id="manager-private"
          :brief="t('settings.system.requests.indexers.fields.allowPrivateAddressBrief')"
        />
      </SettingsSection>
      <SettingsSection :title="t('settings.system.requests.sections.search')">
        <SettingsToggleField v-model="draft.enabled" :label="t('settings.system.requests.indexers.fields.enabled')" input-id="manager-enabled" />
        <SettingsToggleField
          v-model="draft.syncNewIndexers"
          :label="t('settings.system.requests.managers.fields.syncNew')"
          input-id="manager-sync-new"
          :brief="t('settings.system.requests.managers.fields.syncNewHint')"
        />
        <SettingsToggleField
          v-model="draft.autoExpandCategories"
          :label="t('settings.system.requests.managers.fields.autoExpand')"
          input-id="manager-auto-expand"
          :brief="t('settings.system.requests.managers.fields.autoExpandHint')"
        />
        <SettingsToggleField
          v-model="draft.inheritSeedLimits"
          :label="t('settings.system.requests.managers.fields.inheritSeedLimits')"
          input-id="manager-seed-limits"
          :brief="t('settings.system.requests.managers.fields.inheritSeedLimitsHint')"
        />
        <div class="grid gap-4 sm:grid-cols-2">
          <SettingsField
            :label="t('settings.system.requests.managers.fields.perIndexerTimeout')"
            input-id="manager-indexer-timeout"
            :brief="t('settings.system.requests.managers.fields.perIndexerTimeoutHint')"
          >
            <template #default="{ describedBy }">
              <input
                id="manager-indexer-timeout"
                v-model.number="draft.perIndexerTimeoutSeconds"
                type="number"
                min="5"
                max="180"
                class="settings-control"
                :aria-describedby="describedBy"
              />
            </template>
          </SettingsField>
          <SettingsField
            :label="t('settings.system.requests.managers.fields.overallBudget')"
            input-id="manager-search-budget"
            :brief="t('settings.system.requests.managers.fields.overallBudgetHint')"
          >
            <template #default="{ describedBy }">
              <input
                id="manager-search-budget"
                v-model.number="draft.overallSearchBudgetSeconds"
                type="number"
                min="5"
                max="300"
                class="settings-control"
                :aria-describedby="describedBy"
              />
            </template>
          </SettingsField>
        </div>
      </SettingsSection>
      <details class="border-t border-border pt-4" :open="Boolean(draft.resolvers.length || draft.proxyUrl)">
        <summary class="settings-label cursor-pointer rounded focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none">
          {{ t('settings.system.requests.indexers.network.title') }}
        </summary>
        <p class="settings-hint mt-1">
          {{ t('settings.system.requests.indexers.network.brief') }}
        </p>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <SettingsField
            :label="t('settings.system.requests.indexers.network.resolvers')"
            input-id="manager-resolvers"
            :brief="t('settings.system.requests.indexers.network.resolversBrief')"
          >
            <template #default="{ describedBy }">
              <ChipInput
                v-model="draft.resolvers"
                input-id="manager-resolvers"
                control-class="min-h-9"
                :described-by="describedBy"
                placeholder="1.1.1.1"
              />
            </template>
          </SettingsField>
          <SettingsField
            :label="t('settings.system.requests.indexers.network.proxyUrl')"
            input-id="manager-proxy"
            :brief="t('settings.system.requests.indexers.network.proxyHint')"
          >
            <template #default="{ describedBy }">
              <input
                id="manager-proxy"
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
    </SettingsEditorSheet>
  </div>
</template>
