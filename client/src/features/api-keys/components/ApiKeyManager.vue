<script setup lang="ts">
import { computed, nextTick, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { KeyRound, Pencil, Plus, RefreshCw, Trash2, TriangleAlert } from '@lucide/vue'
import { API_KEY_MAX_ACTIVE_PER_USER, API_KEY_NAME_MAX_LENGTH, Permission, type ApiKeySummary, type CreateApiKeyRequest } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import StatusPill from '@/features/admin/components/StatusPill.vue'
import type { StatusPillTone } from '@/features/admin/lib/status-pill-styles'
import { permissionLabel } from '@/features/admin/lib/permission-labels'
import { formatDate, formatList, formatNumber, formatRelativeTimeFromNow } from '@/i18n/formatters'
import { errorMessage } from '@/lib/api-json'
import { useApiKeys } from '../composables/useApiKeys'
import { apiKeyState, maskedToken, type ApiKeyState } from '../lib/api-key-options'
import ApiKeyCreateDialog from './ApiKeyCreateDialog.vue'
import ApiKeyRevealDialog from './ApiKeyRevealDialog.vue'

interface LibraryOption {
  id: number
  name: string
}

const props = withDefaults(
  defineProps<{
    /** Set when an administrator manages another person's keys; omitted for the signed-in user's own. */
    ownerId?: number | null
    ownerIsSuperuser: boolean
    ownerPermissions: readonly string[]
    libraries: readonly LibraryOption[]
  }>(),
  { ownerId: null },
)

const { t } = useI18n()
const { keys, settings, loading, loaded, error, load, loadSettings, create, rename, regenerate, revoke, revokeAll } = useApiKeys(
  toRef(props, 'ownerId'),
)

const SUMMARY_LIMIT = 3

const issuing = computed(() => props.ownerId !== null)
const ownerPermitted = computed(() => props.ownerIsSuperuser || props.ownerPermissions.includes(Permission.ApiKeys))
const enabled = computed(() => settings.value?.enabled !== false)

const liveKeys = computed(() => keys.value.filter((key) => !key.revokedAt))
const revokedKeys = computed(() => keys.value.filter((key) => key.revokedAt))
const activeCount = computed(() => liveKeys.value.filter((key) => apiKeyState(key) !== 'expired').length)
const atLimit = computed(() => activeCount.value >= API_KEY_MAX_ACTIVE_PER_USER)
const canCreate = computed(() => enabled.value && ownerPermitted.value && !atLimit.value)

const libraryNames = computed(() => new Map(props.libraries.map((library) => [library.id, library.name])))

interface KeyRow {
  key: ApiKeySummary
  state: ApiKeyState
  stateLabel: string
  stateTone: StatusPillTone
  token: string
  accessLabel: string
  permissions: string
  libraries: string
  created: string
  lastUsed: string
  expiry: string
}

const STATE_TONES: Record<ApiKeyState, StatusPillTone> = { active: 'success', expiring: 'warning', expired: 'danger', revoked: 'neutral' }

function summarize(labels: string[], countKey: string): string {
  return labels.length <= SUMMARY_LIMIT ? formatList(labels) : t(countKey, { count: labels.length })
}

function describePermissions(key: ApiKeySummary): string {
  if (key.admin) return t('apiKeys.list.permissionsAdmin')
  if (key.permissions.length === 0) return t('apiKeys.list.permissionsNone')
  return summarize(
    key.permissions.map((permission) => permissionLabel(permission as Permission, t)),
    'apiKeys.list.permissionsCount',
  )
}

function describeLibraries(key: ApiKeySummary): string {
  if (key.libraryIds === null) return t('apiKeys.list.librariesAll')
  if (key.libraryIds.length === 0) return t('apiKeys.list.librariesNone')
  const names = key.libraryIds.map((id) => libraryNames.value.get(id) ?? t('apiKeys.list.libraryUnknown', { id: formatNumber(id) }))
  return summarize(names, 'apiKeys.list.librariesCount')
}

function describeCreated(key: ApiKeySummary): string {
  const date = formatDate(new Date(key.createdAt), { dateStyle: 'medium' })
  return key.createdBy ? t('apiKeys.list.createdBy', { date, username: key.createdBy.username }) : date
}

function describeLastUsed(key: ApiKeySummary): string {
  if (!key.lastUsedAt) return t('apiKeys.list.neverUsed')
  const time = formatRelativeTimeFromNow(key.lastUsedAt, { smallestUnit: 'minute' })
  return key.lastUsedIp ? t('apiKeys.list.lastUsedFrom', { time, ip: key.lastUsedIp }) : time
}

function describeExpiry(key: ApiKeySummary): string {
  if (key.revokedAt) return t('apiKeys.list.revokedOn', { date: formatDate(new Date(key.revokedAt), { dateStyle: 'medium' }) })
  if (!key.expiresAt) return t('apiKeys.list.noExpiry')
  return formatDate(new Date(key.expiresAt), { dateStyle: 'medium' })
}

function toRow(key: ApiKeySummary): KeyRow {
  const state = apiKeyState(key)
  return {
    key,
    state,
    stateLabel: t(`apiKeys.state.${state}`),
    stateTone: STATE_TONES[state],
    token: maskedToken(key.hint),
    accessLabel: t(`apiKeys.access.${key.access}`),
    permissions: describePermissions(key),
    libraries: describeLibraries(key),
    created: describeCreated(key),
    lastUsed: describeLastUsed(key),
    expiry: describeExpiry(key),
  }
}

const liveRows = computed(() => liveKeys.value.map(toRow))
const revokedRows = computed(() => revokedKeys.value.map(toRow))

const announcement = ref('')
const actionError = ref<string | null>(null)

// Create

const createOpen = ref(false)
const createBusy = ref(false)
const createError = ref<string | null>(null)
const revealed = ref<{ token: string; name: string } | null>(null)

function openCreate() {
  createError.value = null
  createOpen.value = true
}

function closeCreate() {
  if (!createBusy.value) createOpen.value = false
}

async function submitCreate(request: CreateApiKeyRequest) {
  createBusy.value = true
  createError.value = null
  try {
    const created = await create(request)
    createOpen.value = false
    revealed.value = { token: created.token, name: created.key.name }
  } catch (reason) {
    createError.value = errorMessage(reason, 'apiKeys.errors.create')
  } finally {
    createBusy.value = false
  }
}

function closeReveal() {
  revealed.value = null
}

// Rename

const editingId = ref<number | null>(null)
const editingName = ref('')
const renameBusy = ref(false)
const renameError = ref<string | null>(null)

/** Moves focus into the rename field when editing starts and back to its button when it ends. */
async function focusElement(id: string, select = false) {
  await nextTick()
  const element = document.getElementById(id)
  element?.focus()
  if (select && element instanceof HTMLInputElement) element.select()
}

function startRename(key: ApiKeySummary) {
  editingId.value = key.id
  editingName.value = key.name
  renameError.value = null
  void focusElement(`api-key-rename-${key.id}`, true)
}

function finishRename(keyId: number) {
  editingId.value = null
  renameError.value = null
  void focusElement(`api-key-rename-button-${keyId}`)
}

function cancelRename() {
  if (renameBusy.value || editingId.value === null) return
  finishRename(editingId.value)
}

async function saveRename() {
  const keyId = editingId.value
  const name = editingName.value.trim()
  if (keyId === null || renameBusy.value) return
  if (!name) {
    renameError.value = t('apiKeys.errors.nameRequired')
    return
  }
  renameBusy.value = true
  try {
    await rename(keyId, name)
    finishRename(keyId)
    announcement.value = t('apiKeys.announce.renamed', { name })
  } catch (reason) {
    renameError.value = errorMessage(reason, 'apiKeys.errors.rename')
  } finally {
    renameBusy.value = false
  }
}

// Regenerate, revoke, revoke all

type PendingAction = { kind: 'regenerate' | 'revoke'; key: ApiKeySummary } | { kind: 'revokeAll' }

const pending = ref<PendingAction | null>(null)
const actionBusy = ref(false)

const confirmCopy = computed(() => {
  const action = pending.value
  if (!action) return { title: '', description: '', confirm: '' }
  if (action.kind === 'revokeAll') {
    return {
      title: t('apiKeys.confirm.revokeAllTitle'),
      description: issuing.value ? t('apiKeys.confirm.revokeAllIssuedDescription') : t('apiKeys.confirm.revokeAllDescription'),
      confirm: t('apiKeys.actions.revokeAll'),
    }
  }
  if (action.kind === 'regenerate') {
    return {
      title: t('apiKeys.confirm.regenerateTitle', { name: action.key.name }),
      description: t('apiKeys.confirm.regenerateDescription'),
      confirm: t('apiKeys.actions.regenerate'),
    }
  }
  return {
    title: t('apiKeys.confirm.revokeTitle', { name: action.key.name }),
    description: t('apiKeys.confirm.revokeDescription'),
    confirm: t('apiKeys.actions.revoke'),
  }
})

function requestRegenerate(key: ApiKeySummary) {
  pending.value = { kind: 'regenerate', key }
}

function requestRevoke(key: ApiKeySummary) {
  pending.value = { kind: 'revoke', key }
}

function requestRevokeAll() {
  pending.value = { kind: 'revokeAll' }
}

function cancelPending() {
  if (!actionBusy.value) pending.value = null
}

async function confirmPending() {
  const action = pending.value
  if (!action || actionBusy.value) return
  actionBusy.value = true
  actionError.value = null
  try {
    if (action.kind === 'regenerate') {
      const created = await regenerate(action.key.id)
      revealed.value = { token: created.token, name: created.key.name }
    } else if (action.kind === 'revoke') {
      await revoke(action.key.id)
      announcement.value = t('apiKeys.announce.revoked', { name: action.key.name })
    } else {
      const count = await revokeAll()
      announcement.value = t('apiKeys.announce.revokedAll', { count })
    }
    pending.value = null
  } catch (reason) {
    pending.value = null
    const fallback = action.kind === 'revokeAll' ? 'apiKeys.errors.revokeAll' : `apiKeys.errors.${action.kind}`
    actionError.value = errorMessage(reason, fallback)
  } finally {
    actionBusy.value = false
  }
}

watch(
  () => props.ownerId,
  () => {
    editingId.value = null
    void load()
  },
)

onMounted(() => {
  void Promise.all([load(), loadSettings()])
})
</script>

<template>
  <div class="space-y-4">
    <p role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>

    <div
      v-if="!enabled"
      class="flex gap-3 rounded-lg border border-[var(--pill-warning)]/40 bg-[var(--pill-warning)]/10 px-4 py-3 text-[var(--pill-warning)]"
    >
      <TriangleAlert :size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
      <p class="text-sm">{{ t('apiKeys.disabledNotice') }}</p>
    </div>
    <div
      v-else-if="issuing && !ownerPermitted"
      class="flex gap-3 rounded-lg border border-border bg-muted px-4 py-3"
      data-testid="api-keys-owner-not-permitted"
    >
      <TriangleAlert :size="18" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p class="text-sm text-foreground">{{ t('apiKeys.ownerNotPermitted') }}</p>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p class="text-sm text-muted-foreground">
        {{ t('apiKeys.list.activeCount', { count: activeCount, max: formatNumber(API_KEY_MAX_ACTIVE_PER_USER) }) }}
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <Button v-if="liveKeys.length > 0" variant="destructive-outline" size="sm" type="button" @click="requestRevokeAll">
          <Trash2 :size="14" aria-hidden="true" />
          {{ t('apiKeys.actions.revokeAll') }}
        </Button>
        <Button v-if="enabled && ownerPermitted" size="sm" type="button" :disabled="!canCreate" @click="openCreate">
          <Plus :size="14" aria-hidden="true" />
          {{ issuing ? t('apiKeys.actions.issue') : t('apiKeys.actions.create') }}
        </Button>
      </div>
    </div>
    <p v-if="atLimit && enabled && ownerPermitted" class="settings-hint">
      {{ t('apiKeys.list.limitReached', { max: formatNumber(API_KEY_MAX_ACTIVE_PER_USER) }) }}
    </p>

    <p v-if="error" role="alert" class="settings-error-state">{{ error }}</p>
    <p v-if="actionError" role="alert" class="settings-error-state">{{ actionError }}</p>
    <p v-if="loading" role="status" class="settings-loading-state">{{ t('common.loading') }}</p>

    <template v-else-if="loaded">
      <div v-if="liveRows.length === 0" class="settings-empty-state" data-testid="api-keys-empty">
        <KeyRound :size="28" class="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
        <p class="text-sm font-medium text-foreground">{{ issuing ? t('apiKeys.empty.issuedTitle') : t('apiKeys.empty.title') }}</p>
        <p class="settings-prose mx-auto mt-1 text-sm text-muted-foreground">
          {{ issuing ? t('apiKeys.empty.issuedHint') : t('apiKeys.empty.hint') }}
        </p>
      </div>

      <ul v-else class="settings-card" :aria-label="t('apiKeys.list.label')">
        <li v-for="row in liveRows" :key="row.key.id" class="px-4 py-3.5 md:px-5" data-testid="api-key-row">
          <div class="flex flex-col gap-3 md:flex-row md:items-start">
            <div class="min-w-0 flex-1">
              <form v-if="editingId === row.key.id" class="flex flex-wrap items-center gap-2" @submit.prevent="saveRename">
                <label :for="`api-key-rename-${row.key.id}`" class="sr-only">{{ t('apiKeys.list.renameLabel') }}</label>
                <input
                  :id="`api-key-rename-${row.key.id}`"
                  v-model="editingName"
                  type="text"
                  :maxlength="API_KEY_NAME_MAX_LENGTH"
                  autocomplete="off"
                  class="input-field min-w-0 flex-1"
                  :aria-invalid="renameError ? 'true' : undefined"
                  :aria-describedby="renameError ? `api-key-rename-error-${row.key.id}` : undefined"
                  @keydown.esc.prevent="cancelRename"
                />
                <Button size="sm" type="submit" :disabled="renameBusy">{{ t('common.save') }}</Button>
                <Button size="sm" variant="outline" type="button" :disabled="renameBusy" @click="cancelRename">{{ t('common.cancel') }}</Button>
                <p v-if="renameError" :id="`api-key-rename-error-${row.key.id}`" role="alert" class="basis-full text-xs text-destructive">
                  {{ renameError }}
                </p>
              </form>
              <div v-else class="flex flex-wrap items-center gap-2">
                <KeyRound :size="14" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span class="min-w-0 truncate text-sm font-medium text-foreground">{{ row.key.name }}</span>
                <StatusPill :tone="row.stateTone">{{ row.stateLabel }}</StatusPill>
                <StatusPill tone="neutral">{{ row.accessLabel }}</StatusPill>
                <StatusPill v-if="row.key.admin" tone="danger">{{ t('apiKeys.list.adminBadge') }}</StatusPill>
              </div>
              <p class="mt-1 font-mono text-xs text-muted-foreground" dir="ltr">{{ row.token }}</p>

              <dl class="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                <div class="flex min-w-0 gap-1.5">
                  <dt class="shrink-0 text-muted-foreground">{{ t('apiKeys.list.permissions') }}</dt>
                  <dd class="min-w-0 text-foreground">{{ row.permissions }}</dd>
                </div>
                <div class="flex min-w-0 gap-1.5">
                  <dt class="shrink-0 text-muted-foreground">{{ t('apiKeys.list.libraries') }}</dt>
                  <dd class="min-w-0 text-foreground">{{ row.libraries }}</dd>
                </div>
                <div class="flex min-w-0 gap-1.5">
                  <dt class="shrink-0 text-muted-foreground">{{ t('apiKeys.list.created') }}</dt>
                  <dd class="min-w-0 text-foreground">{{ row.created }}</dd>
                </div>
                <div class="flex min-w-0 gap-1.5">
                  <dt class="shrink-0 text-muted-foreground">{{ t('apiKeys.list.lastUsed') }}</dt>
                  <dd class="min-w-0 text-foreground">{{ row.lastUsed }}</dd>
                </div>
                <div class="flex min-w-0 gap-1.5">
                  <dt class="shrink-0 text-muted-foreground">{{ t('apiKeys.list.expires') }}</dt>
                  <dd class="min-w-0" :class="row.state === 'expired' ? 'text-destructive' : 'text-foreground'">{{ row.expiry }}</dd>
                </div>
              </dl>
            </div>

            <div class="flex shrink-0 flex-wrap items-center gap-1">
              <Button
                v-if="!issuing && editingId !== row.key.id"
                :id="`api-key-rename-button-${row.key.id}`"
                variant="ghost"
                size="sm"
                type="button"
                :aria-label="t('apiKeys.actions.renameAria', { name: row.key.name })"
                @click="startRename(row.key)"
              >
                <Pencil :size="14" aria-hidden="true" />
                {{ t('apiKeys.actions.rename') }}
              </Button>
              <Button
                v-if="!issuing && enabled && ownerPermitted"
                variant="ghost"
                size="sm"
                type="button"
                :aria-label="t('apiKeys.actions.regenerateAria', { name: row.key.name })"
                @click="requestRegenerate(row.key)"
              >
                <RefreshCw :size="14" aria-hidden="true" />
                {{ t('apiKeys.actions.regenerate') }}
              </Button>
              <Button
                variant="destructive-ghost"
                size="sm"
                type="button"
                :aria-label="t('apiKeys.actions.revokeAria', { name: row.key.name })"
                @click="requestRevoke(row.key)"
              >
                <Trash2 :size="14" aria-hidden="true" />
                {{ t('apiKeys.actions.revoke') }}
              </Button>
            </div>
          </div>
        </li>
      </ul>

      <section v-if="revokedRows.length > 0" class="space-y-2" aria-labelledby="api-keys-revoked-heading">
        <h3 id="api-keys-revoked-heading" class="settings-group-label">{{ t('apiKeys.list.revokedHeading') }}</h3>
        <p class="settings-hint">{{ t('apiKeys.list.revokedHint') }}</p>
        <ul class="settings-card">
          <li v-for="row in revokedRows" :key="row.key.id" class="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs md:px-5">
            <span class="min-w-0 truncate text-sm text-muted-foreground line-through">{{ row.key.name }}</span>
            <span class="font-mono text-muted-foreground" dir="ltr">{{ row.token }}</span>
            <span class="text-muted-foreground md:ms-auto">{{ row.expiry }}</span>
          </li>
        </ul>
      </section>
    </template>

    <ApiKeyCreateDialog
      :open="createOpen"
      :max-lifetime-days="settings?.maxLifetimeDays ?? null"
      :owner-is-superuser="ownerIsSuperuser"
      :owner-permissions="ownerPermissions"
      :libraries="libraries"
      :issuing="issuing"
      :busy="createBusy"
      :error="createError"
      @submit="submitCreate"
      @cancel="closeCreate"
    />

    <ApiKeyRevealDialog :token="revealed?.token ?? null" :key-name="revealed?.name ?? ''" @close="closeReveal" />

    <ConfirmDialog
      :open="pending !== null"
      :title="confirmCopy.title"
      :description="confirmCopy.description"
      :confirm-label="confirmCopy.confirm"
      :busy="actionBusy"
      @confirm="confirmPending"
      @cancel="cancelPending"
    />
  </div>
</template>
