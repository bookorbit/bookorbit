<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import { Plus, Trash2, Copy, Check, Link, Pause, Play, Info } from '@lucide/vue'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { api } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'
import { useMagicLinks } from '@/features/settings/composables/useMagicLinks'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import StatusPill from '@/features/admin/components/StatusPill.vue'

const props = withDefaults(defineProps<{ withHeader?: boolean; withEmbeddedCreateAction?: boolean }>(), {
  withHeader: true,
  withEmbeddedCreateAction: false,
})

defineExpose({ openCreateForm })

const { t } = useI18n()

interface SharedUser {
  id: number
  username: string
  name: string
}

const { tokens, loading, error, loadTokens, createToken, revokeToken, setActive } = useMagicLinks()

const sharedUsers = ref<SharedUser[]>([])
const showCreateForm = ref(false)
const createLabel = ref('')
const createUserId = ref<number | null>(null)
const createExpiresAt = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)

const copiedId = ref<number | null>(null)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

const revokeConfirmId = ref<number | null>(null)
const revoking = ref(false)

const activeTokens = computed(() => tokens.value.filter((t) => !t.revokedAt && (!t.expiresAt || new Date(t.expiresAt) > new Date())))
const inactiveTokens = computed(() => tokens.value.filter((t) => t.revokedAt || (t.expiresAt && new Date(t.expiresAt) <= new Date())))
const canCreate = computed(() => !creating.value && createUserId.value !== null && createLabel.value.trim().length > 0)

async function loadSharedUsers() {
  try {
    const res = await api('/api/v1/users?provisioningMethod=shared&pageSize=100')
    if (!res.ok) return
    const data = await res.json()
    sharedUsers.value = (data.users ?? data).map((u: SharedUser) => ({ id: u.id, username: u.username, name: u.name }))
  } catch {
    // non-critical
  }
}

onMounted(async () => {
  await Promise.all([loadTokens(), loadSharedUsers()])
})

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})

function openCreateForm() {
  createLabel.value = ''
  createUserId.value = sharedUsers.value.length === 1 ? (sharedUsers.value[0]?.id ?? null) : null
  createExpiresAt.value = ''
  createError.value = null
  showCreateForm.value = true
}

function closeCreateForm() {
  if (!creating.value) showCreateForm.value = false
}

function handleCreateOpenChange(open: boolean) {
  if (!open) closeCreateForm()
}

async function handleCreate() {
  if (!canCreate.value || createUserId.value === null) return
  creating.value = true
  createError.value = null
  try {
    await createToken({
      userId: createUserId.value,
      label: createLabel.value.trim(),
      expiresAt: createExpiresAt.value ? new Date(createExpiresAt.value).toISOString() : undefined,
    })
    showCreateForm.value = false
  } catch (e) {
    createError.value = e instanceof Error ? e.message : t('settings.magicLinks.errors.create')
  } finally {
    creating.value = false
  }
}

function getMagicUrl(rawToken: string): string {
  return `${window.location.origin}/magic?token=${rawToken}`
}

async function copyMagicUrl(tokenId: number, rawToken: string) {
  const copied = await copyToClipboard(getMagicUrl(rawToken))
  if (!copied) {
    error.value = t('settings.magicLinks.errors.copy')
    return
  }

  error.value = null
  copiedId.value = tokenId
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copiedId.value = null
    copiedTimer = null
  }, 2000)
}

async function handleToggleActive(id: number, currentIsActive: boolean) {
  try {
    await setActive(id, !currentIsActive)
  } catch {
    error.value = t('settings.magicLinks.errors.update')
  }
}

function requestRevoke(id: number) {
  revokeConfirmId.value = id
}

function cancelRevoke() {
  if (!revoking.value) revokeConfirmId.value = null
}

async function handleRevoke() {
  if (revokeConfirmId.value === null || revoking.value) return
  revoking.value = true
  try {
    await revokeToken(revokeConfirmId.value)
    revokeConfirmId.value = null
  } catch {
    error.value = t('settings.magicLinks.errors.revoke')
  } finally {
    revoking.value = false
  }
}

function formatDate(date: string | null | undefined): string {
  if (!date) return '-'
  return formatLocaleDate(new Date(date), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false
  return new Date(expiresAt) < new Date()
}
</script>

<template>
  <template v-if="props.withHeader">
    <SettingsPageHeader class="hidden md:flex" :title="t('settings.magicLinks.title')" :subtitle="t('settings.magicLinks.subtitle')">
      <button type="button" class="settings-btn-primary" :disabled="sharedUsers.length === 0" @click="openCreateForm">
        <Plus :size="14" aria-hidden="true" />
        {{ t('settings.magicLinks.createLink') }}
      </button>
    </SettingsPageHeader>
    <div class="md:hidden px-1">
      <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.magicLinks.title') }}</h1>
      <p
        class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
      >
        {{ t('settings.magicLinks.subtitle') }}
      </p>
    </div>
    <div class="md:hidden sticky top-11 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2 mt-4 mb-3">
      <button type="button" class="settings-btn-primary w-full min-h-10 justify-center" :disabled="sharedUsers.length === 0" @click="openCreateForm">
        <Plus :size="14" aria-hidden="true" />
        {{ t('settings.magicLinks.createLink') }}
      </button>
    </div>
  </template>

  <p v-if="error" role="alert" class="mb-4 text-sm text-destructive">{{ error }}</p>
  <p v-if="loading" role="status" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>

  <DialogRoot :open="showCreateForm" @update:open="handleCreateOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/50" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DialogTitle class="text-lg font-semibold text-foreground">{{ t('settings.magicLinks.createDialog.title') }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ t('settings.magicLinks.createDialog.description') }}</DialogDescription>

        <form class="mt-4 space-y-3" @submit.prevent="handleCreate">
          <div>
            <label for="magic-link-account" class="mb-1 block text-sm font-medium text-foreground">
              {{ t('settings.magicLinks.createDialog.sharedAccount') }}
            </label>
            <select id="magic-link-account" v-model="createUserId" class="select-field w-full">
              <option :value="null" disabled>{{ t('settings.magicLinks.createDialog.selectAccount') }}</option>
              <option v-for="u in sharedUsers" :key="u.id" :value="u.id">{{ u.name }} (@{{ u.username }})</option>
            </select>
          </div>
          <div>
            <label for="magic-link-label" class="mb-1 block text-sm font-medium text-foreground">
              {{ t('settings.magicLinks.createDialog.label') }}
            </label>
            <input
              id="magic-link-label"
              v-model="createLabel"
              type="text"
              maxlength="100"
              :placeholder="t('settings.magicLinks.createDialog.labelPlaceholder')"
              class="input-field w-full"
            />
          </div>
          <div>
            <label for="magic-link-expires" class="mb-1 block text-sm font-medium text-foreground">
              {{ t('settings.magicLinks.createDialog.expiresAt') }}
              <span class="font-normal text-muted-foreground">{{ t('settings.magicLinks.createDialog.optional') }}</span>
            </label>
            <input id="magic-link-expires" v-model="createExpiresAt" type="datetime-local" class="input-field w-full" />
          </div>

          <p v-if="createError" role="alert" class="text-sm text-destructive">{{ createError }}</p>

          <div class="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="outline" :disabled="creating" @click="closeCreateForm">{{ t('common.cancel') }}</Button>
            <Button type="submit" :disabled="!canCreate">
              {{ creating ? t('settings.magicLinks.createDialog.creating') : t('settings.magicLinks.createDialog.create') }}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- Active links -->
  <div v-if="!loading && !error" class="space-y-3">
    <div class="flex items-center justify-between mb-3">
      <p class="settings-group-label mb-0">{{ t('settings.magicLinks.activeLinks') }}</p>
      <button
        v-if="props.withEmbeddedCreateAction"
        type="button"
        class="settings-btn-primary"
        :disabled="sharedUsers.length === 0"
        @click="openCreateForm"
      >
        <Plus :size="14" aria-hidden="true" />
        {{ t('settings.magicLinks.createLink') }}
      </button>
    </div>

    <div v-if="sharedUsers.length === 0 && tokens.length === 0" class="rounded-lg border border-dashed border-border px-5 py-8 text-center">
      <Info :size="32" class="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
      <p class="text-sm font-medium text-foreground">{{ t('settings.magicLinks.noSharedAccounts') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">
        <i18n-t keypath="settings.magicLinks.noSharedAccountsHint" tag="span" scope="global">
          <template #usersPage>
            <RouterLink to="/settings/admin?tab=users" class="font-medium text-primary hover:underline">{{
              t('settings.magicLinks.usersPage')
            }}</RouterLink>
          </template>
        </i18n-t>
      </p>
    </div>

    <template v-else>
      <template v-if="activeTokens.length > 0">
        <div class="hidden overflow-x-auto rounded-lg border border-border shadow-xs md:block">
          <table class="w-full min-w-[880px] table-fixed text-sm">
            <colgroup>
              <col class="w-[24%]" />
              <col class="w-[15%]" />
              <col class="w-[14%]" />
              <col class="w-[17%]" />
              <col class="w-[8%]" />
              <col class="w-[22%]" />
            </colgroup>
            <thead class="bg-muted/50 text-muted-foreground">
              <tr>
                <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.magicLinks.columns.label') }}</th>
                <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.magicLinks.columns.account') }}</th>
                <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.magicLinks.columns.createdBy') }}</th>
                <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.magicLinks.columns.expires') }}</th>
                <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.magicLinks.columns.uses') }}</th>
                <th class="px-3 py-2 text-end text-xs font-medium">{{ t('settings.magicLinks.columns.actions') }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="token in activeTokens" :key="token.id" class="bg-card hover:bg-muted/30">
                <td class="px-3 py-2">
                  <div class="flex items-center gap-1.5">
                    <Link :size="12" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span class="truncate font-medium text-foreground">{{ token.label }}</span>
                    <StatusPill v-if="!token.isActive" tone="warning">{{ t('settings.magicLinks.paused') }}</StatusPill>
                  </div>
                  <p class="mt-0.5 truncate text-xs text-muted-foreground">
                    {{ t('settings.magicLinks.lastUsedLabel', { date: formatDate(token.lastUsedAt) }) }}
                  </p>
                </td>
                <td class="truncate px-3 py-2 font-mono text-xs text-muted-foreground">@{{ token.username }}</td>
                <td class="truncate px-3 py-2 text-xs text-muted-foreground">
                  {{ token.createdByUsername ?? t('settings.magicLinks.deletedUser') }}
                </td>
                <td class="px-3 py-2">
                  <span v-if="token.expiresAt" class="text-xs" :class="isExpired(token.expiresAt) ? 'text-destructive' : 'text-muted-foreground'">
                    {{ isExpired(token.expiresAt) ? t('settings.magicLinks.expiredPrefix') : '' }}{{ formatDate(token.expiresAt) }}
                  </span>
                  <span v-else class="text-xs text-muted-foreground">{{ t('settings.magicLinks.never') }}</span>
                </td>
                <td class="px-3 py-2 text-xs tabular-nums text-muted-foreground">{{ token.useCount }}</td>
                <td class="px-3 py-2">
                  <div class="flex items-center justify-end gap-1">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <button
                          type="button"
                          class="rounded p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          :class="copiedId === token.id ? 'text-[var(--pill-success)]' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
                          :aria-label="t('settings.magicLinks.copyLinkAria', { label: token.label })"
                          @click="copyMagicUrl(token.id, token.rawToken)"
                        >
                          <Check v-if="copiedId === token.id" :size="14" aria-hidden="true" />
                          <Copy v-else :size="14" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{{
                        copiedId === token.id ? t('settings.magicLinks.copied') : t('settings.magicLinks.copyLink')
                      }}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <button
                          type="button"
                          class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          :aria-label="
                            token.isActive
                              ? t('settings.magicLinks.pauseAria', { label: token.label })
                              : t('settings.magicLinks.resumeAria', { label: token.label })
                          "
                          @click="handleToggleActive(token.id, token.isActive)"
                        >
                          <Pause v-if="token.isActive" :size="14" aria-hidden="true" />
                          <Play v-else :size="14" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{{ token.isActive ? t('settings.magicLinks.pause') : t('settings.magicLinks.resume') }}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <button
                          type="button"
                          class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          :aria-label="t('settings.magicLinks.revokeAria', { label: token.label })"
                          @click="requestRevoke(token.id)"
                        >
                          <Trash2 :size="14" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{{ t('settings.magicLinks.revoke') }}</TooltipContent>
                    </Tooltip>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="space-y-2 md:hidden">
          <article v-for="token in activeTokens" :key="token.id" class="rounded-lg border border-border bg-card p-3 shadow-xs">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <Link :size="12" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                  <p class="truncate text-sm font-medium text-foreground">{{ token.label }}</p>
                </div>
                <p class="mt-1 truncate font-mono text-xs text-muted-foreground">@{{ token.username }}</p>
              </div>
              <StatusPill v-if="!token.isActive" tone="warning" class="shrink-0">{{ t('settings.magicLinks.paused') }}</StatusPill>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{{ t('settings.magicLinks.usesCount', { count: token.useCount }) }}</span>
              <span v-if="token.expiresAt" :class="isExpired(token.expiresAt) ? 'text-destructive' : ''">
                {{
                  isExpired(token.expiresAt)
                    ? t('settings.magicLinks.expired')
                    : t('settings.magicLinks.expiresOn', { date: formatDate(token.expiresAt) })
                }}
              </span>
              <span v-else>{{ t('settings.magicLinks.noExpiry') }}</span>
            </div>
            <div class="mt-3 flex items-center gap-1 border-t border-border pt-3">
              <button
                type="button"
                class="rounded p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :class="copiedId === token.id ? 'text-[var(--pill-success)]' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
                :aria-label="t('settings.magicLinks.copyLinkAria', { label: token.label })"
                @click="copyMagicUrl(token.id, token.rawToken)"
              >
                <Check v-if="copiedId === token.id" :size="14" aria-hidden="true" />
                <Copy v-else :size="14" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="
                  token.isActive
                    ? t('settings.magicLinks.pauseAria', { label: token.label })
                    : t('settings.magicLinks.resumeAria', { label: token.label })
                "
                @click="handleToggleActive(token.id, token.isActive)"
              >
                <Pause v-if="token.isActive" :size="14" aria-hidden="true" />
                <Play v-else :size="14" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="t('settings.magicLinks.revokeAria', { label: token.label })"
                @click="requestRevoke(token.id)"
              >
                <Trash2 :size="14" aria-hidden="true" />
              </button>
            </div>
          </article>
        </div>
      </template>

      <div v-else-if="tokens.length === 0" class="rounded-lg border border-dashed border-border px-5 py-8 text-center">
        <Link :size="32" class="mx-auto mb-3 text-muted-foreground" aria-hidden="true" />
        <p class="text-sm font-medium text-foreground">{{ t('settings.magicLinks.emptyTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.magicLinks.emptyHint', { action: t('settings.magicLinks.createLink') }) }}</p>
      </div>

      <div v-else class="rounded-lg border border-dashed border-border px-5 py-6 text-center">
        <Link :size="24" class="mx-auto mb-2 text-muted-foreground" aria-hidden="true" />
        <p class="text-sm font-medium text-foreground">{{ t('settings.magicLinks.noActiveTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.magicLinks.noActiveHint') }}</p>
      </div>
    </template>
  </div>

  <!-- Inactive tokens (revoked or expired) -->
  <div v-if="!loading && inactiveTokens.length > 0" class="mt-6 space-y-3">
    <p class="settings-group-label">{{ t('settings.magicLinks.inactiveLinks') }}</p>
    <div class="hidden overflow-x-auto rounded-lg border border-border shadow-xs md:block">
      <table class="w-full min-w-[720px] table-fixed text-sm">
        <colgroup>
          <col class="w-[28%]" />
          <col class="w-[18%]" />
          <col class="w-[20%]" />
          <col class="w-[24%]" />
          <col class="w-[10%]" />
        </colgroup>
        <thead class="bg-muted/50 text-muted-foreground">
          <tr>
            <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.magicLinks.columns.label') }}</th>
            <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.magicLinks.columns.account') }}</th>
            <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.magicLinks.columns.created') }}</th>
            <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.magicLinks.columns.status') }}</th>
            <th class="px-3 py-2 text-start text-xs font-medium">{{ t('settings.magicLinks.columns.totalUses') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="token in inactiveTokens" :key="token.id" class="bg-card">
            <td class="truncate px-3 py-2 text-muted-foreground line-through">{{ token.label }}</td>
            <td class="truncate px-3 py-2 font-mono text-xs text-muted-foreground">@{{ token.username }}</td>
            <td class="px-3 py-2 text-xs text-muted-foreground">{{ formatDate(token.createdAt) }}</td>
            <td class="px-3 py-2 text-xs text-muted-foreground">
              {{
                token.revokedAt
                  ? t('settings.magicLinks.revokedOn', { date: formatDate(token.revokedAt) })
                  : t('settings.magicLinks.expiredOn', { date: formatDate(token.expiresAt) })
              }}
            </td>
            <td class="px-3 py-2 text-xs tabular-nums text-muted-foreground">{{ token.useCount }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="space-y-2 md:hidden">
      <article v-for="token in inactiveTokens" :key="token.id" class="rounded-lg border border-border bg-card p-3 shadow-xs">
        <p class="text-sm text-muted-foreground line-through">{{ token.label }}</p>
        <p class="mt-1 text-xs text-muted-foreground">@{{ token.username }} - {{ t('settings.magicLinks.usesCount', { count: token.useCount }) }}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{
            token.revokedAt
              ? t('settings.magicLinks.revokedOn', { date: formatDate(token.revokedAt) })
              : t('settings.magicLinks.expiredOn', { date: formatDate(token.expiresAt) })
          }}
        </p>
      </article>
    </div>
  </div>

  <ConfirmDialog
    :open="revokeConfirmId !== null"
    :title="t('settings.magicLinks.revokeDialog.title')"
    :description="t('settings.magicLinks.revokeDialog.description')"
    :confirm-label="revoking ? t('settings.magicLinks.revoking') : t('settings.magicLinks.revoke')"
    :busy="revoking"
    @confirm="handleRevoke"
    @cancel="cancelRevoke"
  />
</template>
