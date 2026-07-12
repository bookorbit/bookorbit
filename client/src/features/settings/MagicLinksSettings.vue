<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import { Plus, Trash2, Copy, Check, Link, Pause, Play, Info } from '@lucide/vue'
import { api } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'
import { useMagicLinks } from '@/features/settings/composables/useMagicLinks'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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

async function handleCreate() {
  if (!createUserId.value || !createLabel.value.trim()) return
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
      <button class="settings-btn-primary" :disabled="sharedUsers.length === 0" @click="openCreateForm">
        <Plus :size="14" />
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
      <button class="settings-btn-primary w-full min-h-10 justify-center" :disabled="sharedUsers.length === 0" @click="openCreateForm">
        <Plus :size="14" />
        {{ t('settings.magicLinks.createLink') }}
      </button>
    </div>
  </template>

  <div v-if="error" class="mb-4 text-sm text-destructive">{{ error }}</div>
  <div v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</div>

  <!-- Create form modal -->
  <div v-if="showCreateForm" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="showCreateForm = false">
    <button class="absolute inset-0 bg-black/45" @click="showCreateForm = false" />
    <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
      <p class="text-base font-semibold text-foreground">{{ t('settings.magicLinks.createDialog.title') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.magicLinks.createDialog.description') }}</p>

      <div class="mt-4 space-y-3">
        <div>
          <label class="block text-sm font-medium text-foreground mb-1">{{ t('settings.magicLinks.createDialog.sharedAccount') }}</label>
          <select
            v-model="createUserId"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option :value="null" disabled>{{ t('settings.magicLinks.createDialog.selectAccount') }}</option>
            <option v-for="u in sharedUsers" :key="u.id" :value="u.id">{{ u.name }} (@{{ u.username }})</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-foreground mb-1">{{ t('settings.magicLinks.createDialog.label') }}</label>
          <input
            v-model="createLabel"
            type="text"
            maxlength="100"
            :placeholder="t('settings.magicLinks.createDialog.labelPlaceholder')"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-foreground mb-1">
            {{ t('settings.magicLinks.createDialog.expiresAt') }}
            <span class="text-muted-foreground font-normal">{{ t('settings.magicLinks.createDialog.optional') }}</span>
          </label>
          <input
            v-model="createExpiresAt"
            type="datetime-local"
            class="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div v-if="createError" class="mt-3 text-sm text-destructive">{{ createError }}</div>

      <div class="mt-4 flex items-center justify-end gap-2">
        <button
          class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
          @click="showCreateForm = false"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          :disabled="creating || !createUserId || !createLabel.trim()"
          @click="handleCreate"
        >
          {{ creating ? t('settings.magicLinks.createDialog.creating') : t('settings.magicLinks.createDialog.create') }}
        </button>
      </div>
    </div>
  </div>

  <!-- Active links -->
  <div v-if="!loading && !error" class="space-y-3">
    <div class="flex items-center justify-between mb-3">
      <p class="settings-group-label mb-0">{{ t('settings.magicLinks.activeLinks') }}</p>
      <button v-if="props.withEmbeddedCreateAction" class="settings-btn-primary" :disabled="sharedUsers.length === 0" @click="openCreateForm">
        <Plus :size="14" />
        {{ t('settings.magicLinks.createLink') }}
      </button>
    </div>

    <div v-if="sharedUsers.length === 0 && tokens.length === 0" class="rounded-lg border border-border bg-muted/30 px-5 py-8 text-center">
      <Info :size="32" class="mx-auto mb-3 text-muted-foreground/60" />
      <p class="text-sm font-medium text-foreground">{{ t('settings.magicLinks.noSharedAccounts') }}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        <i18n-t keypath="settings.magicLinks.noSharedAccountsHint" tag="span" scope="global">
          <template #usersPage>
            <RouterLink to="/settings/admin?tab=users" class="text-primary hover:underline font-medium">{{
              t('settings.magicLinks.usersPage')
            }}</RouterLink>
          </template>
        </i18n-t>
      </p>
    </div>

    <template v-else>
      <template v-if="activeTokens.length > 0">
        <div class="hidden md:block rounded-lg border border-border overflow-hidden shadow-xs">
          <table class="w-full text-sm">
            <thead class="bg-muted/50">
              <tr>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('settings.magicLinks.columns.label') }}</th>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('settings.magicLinks.columns.account') }}</th>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('settings.magicLinks.columns.createdBy') }}</th>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('settings.magicLinks.columns.expires') }}</th>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('settings.magicLinks.columns.uses') }}</th>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('settings.magicLinks.columns.lastUsed') }}</th>
                <th class="px-4 py-3" />
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr
                v-for="token in activeTokens"
                :key="token.id"
                class="hover:bg-muted/30 transition-colors"
                :class="!token.isActive ? 'opacity-60' : ''"
              >
                <td class="px-4 py-3 text-foreground font-medium">
                  <div class="flex items-center gap-1.5">
                    <Link :size="12" class="text-muted-foreground shrink-0" />
                    {{ token.label }}
                    <span
                      v-if="!token.isActive"
                      class="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                    >
                      {{ t('settings.magicLinks.paused') }}
                    </span>
                  </div>
                </td>
                <td class="px-4 py-3 text-muted-foreground font-mono text-xs">@{{ token.username }}</td>
                <td class="px-4 py-3 text-muted-foreground text-xs">{{ token.createdByUsername ?? t('settings.magicLinks.deletedUser') }}</td>
                <td class="px-4 py-3">
                  <span v-if="token.expiresAt" class="text-xs" :class="isExpired(token.expiresAt) ? 'text-destructive' : 'text-muted-foreground'">
                    {{ isExpired(token.expiresAt) ? t('settings.magicLinks.expiredPrefix') : '' }}{{ formatDate(token.expiresAt) }}
                  </span>
                  <span v-else class="text-xs text-muted-foreground">{{ t('settings.magicLinks.never') }}</span>
                </td>
                <td class="px-4 py-3 text-muted-foreground text-xs">{{ token.useCount }}</td>
                <td class="px-4 py-3 text-muted-foreground text-xs">{{ formatDate(token.lastUsedAt) }}</td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <button
                          class="p-1.5 rounded transition-colors"
                          :class="copiedId === token.id ? 'text-green-500' : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
                          @click="copyMagicUrl(token.id, token.rawToken)"
                        >
                          <Check v-if="copiedId === token.id" :size="14" />
                          <Copy v-else :size="14" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{{
                        copiedId === token.id ? t('settings.magicLinks.copied') : t('settings.magicLinks.copyLink')
                      }}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <button
                          class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          @click="handleToggleActive(token.id, token.isActive)"
                        >
                          <Pause v-if="token.isActive" :size="14" />
                          <Play v-else :size="14" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{{ token.isActive ? t('settings.magicLinks.pause') : t('settings.magicLinks.resume') }}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <button
                          class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          @click="revokeConfirmId = token.id"
                        >
                          <Trash2 :size="14" />
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

        <!-- Mobile active tokens -->
        <div class="md:hidden space-y-3">
          <div
            v-for="token in activeTokens"
            :key="token.id"
            class="rounded-lg border border-border bg-card px-4 py-3.5 shadow-xs"
            :class="!token.isActive ? 'opacity-60' : ''"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <Link :size="12" class="text-muted-foreground shrink-0" />
                  <p class="text-sm font-medium text-foreground truncate">{{ token.label }}</p>
                  <span
                    v-if="!token.isActive"
                    class="inline-flex items-center rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                  >
                    {{ t('settings.magicLinks.paused') }}
                  </span>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">@{{ token.username }}</p>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button
                  class="p-1.5 rounded transition-colors"
                  :class="copiedId === token.id ? 'text-green-500' : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
                  @click="copyMagicUrl(token.id, token.rawToken)"
                >
                  <Check v-if="copiedId === token.id" :size="14" />
                  <Copy v-else :size="14" />
                </button>
                <button
                  class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  @click="handleToggleActive(token.id, token.isActive)"
                >
                  <Pause v-if="token.isActive" :size="14" />
                  <Play v-else :size="14" />
                </button>
                <button
                  class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  @click="revokeConfirmId = token.id"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </div>
            <div class="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
              <span>{{ t('settings.magicLinks.usesCount', { count: token.useCount }, token.useCount) }}</span>
              <span v-if="token.expiresAt" :class="isExpired(token.expiresAt) ? 'text-destructive' : ''">
                {{
                  isExpired(token.expiresAt)
                    ? t('settings.magicLinks.expired')
                    : t('settings.magicLinks.expiresOn', { date: formatDate(token.expiresAt) })
                }}
              </span>
              <span v-else>{{ t('settings.magicLinks.noExpiry') }}</span>
            </div>
          </div>
        </div>
      </template>

      <div v-else-if="tokens.length === 0" class="rounded-lg border border-border bg-muted/30 px-5 py-8 text-center">
        <Link :size="32" class="mx-auto mb-3 text-muted-foreground/60" />
        <p class="text-sm font-medium text-foreground">{{ t('settings.magicLinks.emptyTitle') }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.magicLinks.emptyHint', { action: t('settings.magicLinks.createLink') }) }}</p>
      </div>

      <div v-else class="rounded-lg border border-border bg-muted/30 px-5 py-6 text-center">
        <Link :size="24" class="mx-auto mb-2 text-muted-foreground/50" />
        <p class="text-sm font-medium text-foreground">{{ t('settings.magicLinks.noActiveTitle') }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.magicLinks.noActiveHint') }}</p>
      </div>
    </template>
  </div>

  <!-- Inactive tokens (revoked or expired) -->
  <div v-if="!loading && inactiveTokens.length > 0" class="mt-6 space-y-3">
    <p class="settings-group-label">{{ t('settings.magicLinks.inactiveLinks') }}</p>
    <div class="hidden md:block rounded-lg border border-border overflow-hidden shadow-xs opacity-60">
      <table class="w-full text-sm">
        <thead class="bg-muted/50">
          <tr>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('settings.magicLinks.columns.label') }}</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('settings.magicLinks.columns.account') }}</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('settings.magicLinks.columns.created') }}</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('settings.magicLinks.columns.status') }}</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('settings.magicLinks.columns.totalUses') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="token in inactiveTokens" :key="token.id">
            <td class="px-4 py-3 text-muted-foreground line-through">{{ token.label }}</td>
            <td class="px-4 py-3 text-muted-foreground font-mono text-xs">@{{ token.username }}</td>
            <td class="px-4 py-3 text-muted-foreground text-xs">{{ formatDate(token.createdAt) }}</td>
            <td class="px-4 py-3 text-muted-foreground text-xs">
              {{
                token.revokedAt
                  ? t('settings.magicLinks.revokedOn', { date: formatDate(token.revokedAt) })
                  : t('settings.magicLinks.expiredOn', { date: formatDate(token.expiresAt) })
              }}
            </td>
            <td class="px-4 py-3 text-muted-foreground text-xs">{{ token.useCount }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="md:hidden space-y-3 opacity-60">
      <div v-for="token in inactiveTokens" :key="token.id" class="rounded-lg border border-border bg-card px-4 py-3.5 shadow-xs">
        <p class="text-sm text-muted-foreground line-through">{{ token.label }}</p>
        <p class="mt-1 text-xs text-muted-foreground">@{{ token.username }} - {{ t('settings.magicLinks.usesCount', { count: token.useCount }) }}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">
          {{
            token.revokedAt
              ? t('settings.magicLinks.revokedOn', { date: formatDate(token.revokedAt) })
              : t('settings.magicLinks.expiredOn', { date: formatDate(token.expiresAt) })
          }}
        </p>
      </div>
    </div>
  </div>

  <!-- Revoke confirmation modal -->
  <div
    v-if="revokeConfirmId !== null"
    class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
    @click.self="revokeConfirmId = null"
  >
    <button class="absolute inset-0 bg-black/45" @click="revokeConfirmId = null" />
    <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
      <p class="text-base font-semibold text-foreground">{{ t('settings.magicLinks.revokeDialog.title') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">
        {{ t('settings.magicLinks.revokeDialog.description') }}
      </p>
      <div class="mt-4 flex items-center justify-end gap-2">
        <button
          class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
          @click="revokeConfirmId = null"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
          :disabled="revoking"
          @click="handleRevoke"
        >
          {{ revoking ? t('settings.magicLinks.revoking') : t('settings.magicLinks.revoke') }}
        </button>
      </div>
    </div>
  </div>
</template>
