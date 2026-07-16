<script setup lang="ts">
import { onMounted, ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Trash2, Copy, Rss, ChevronDown, ChevronUp } from '@lucide/vue'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { api } from '@/lib/api'
import { copyToClipboard } from '@/lib/clipboard'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import type { OpdsUser, OpdsSortOrder } from '@bookorbit/types'
import { useMediaQuery } from '@vueuse/core'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const canManageSettings = computed(() => hasPermission('manage_app_settings'))

const opdsEnabled = ref(true)
const opdsUsers = ref<OpdsUser[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

const showCreateForm = ref(false)
const createUsername = ref('')
const createPassword = ref('')
const createSortOrder = ref<OpdsSortOrder>('recent')
const creating = ref(false)
const createError = ref<string | null>(null)
const deleteConfirmUser = ref<OpdsUser | null>(null)
const expandedUserIds = ref<number[]>([])
const helpOpen = ref(true)
const isMobile = useMediaQuery('(max-width: 767px)')

const opdsUrl = computed(() => `${window.location.origin}/api/v1/opds`)

const sortOrderOptions = computed<{ label: string; value: OpdsSortOrder }[]>(() => [
  { label: t('settings.reader.opds.sortRecent'), value: 'recent' },
  { label: t('settings.reader.opds.sortTitleAsc'), value: 'title_asc' },
  { label: t('settings.reader.opds.sortTitleDesc'), value: 'title_desc' },
  { label: t('settings.reader.opds.sortAuthorAsc'), value: 'author_asc' },
  { label: t('settings.reader.opds.sortAuthorDesc'), value: 'author_desc' },
  { label: t('settings.reader.opds.sortSeriesAsc'), value: 'series_asc' },
  { label: t('settings.reader.opds.sortSeriesDesc'), value: 'series_desc' },
])

function sortOrderLabel(value: OpdsSortOrder): string {
  return sortOrderOptions.value.find((o) => o.value === value)?.label ?? value
}

onMounted(async () => {
  try {
    const [settingsRes, usersRes] = await Promise.all([api('/api/v1/app-settings'), api('/api/v1/opds-users')])
    if (settingsRes.ok) {
      const settings = await settingsRes.json()
      const row = settings.find((s: { key: string; value: string }) => s.key === 'opds_enabled')
      opdsEnabled.value = row?.value === 'true'
    }
    if (usersRes.ok) {
      opdsUsers.value = await usersRes.json()
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('settings.reader.opds.loadFailed')
  } finally {
    loading.value = false
  }
})

async function toggleOpds() {
  const newVal = !opdsEnabled.value
  try {
    const res = await api('/api/v1/app-settings/opds_enabled', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(newVal) }),
    })
    if (res.ok) {
      opdsEnabled.value = newVal
      toast.success(newVal ? t('settings.reader.opds.serverEnabled') : t('settings.reader.opds.serverDisabled'))
    } else {
      toast.error(t('settings.reader.opds.updateSettingsFailed'))
    }
  } catch {
    toast.error(t('settings.reader.opds.updateSettingsFailed'))
  }
}

async function copyUrl() {
  const copied = await copyToClipboard(opdsUrl.value)
  if (copied) {
    toast.success(t('settings.reader.opds.urlCopied'))
  } else {
    toast.error(t('settings.reader.opds.urlCopyFailed'))
  }
}

async function createUser() {
  createError.value = null
  creating.value = true
  try {
    const res = await api('/api/v1/opds-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: createUsername.value, password: createPassword.value, sortOrder: createSortOrder.value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      createError.value = data.message ?? t('settings.reader.opds.createUserFailed')
      toast.error(createError.value ?? t('settings.reader.opds.createUserFailed'))
      return
    }
    const user = await res.json()
    opdsUsers.value.push(user)
    showCreateForm.value = false
    createUsername.value = ''
    createPassword.value = ''
    createSortOrder.value = 'recent'
    toast.success(t('settings.reader.opds.userCreated', { username: user.username }))
  } catch {
    toast.error(t('settings.reader.opds.createUserFailed'))
  } finally {
    creating.value = false
  }
}

async function updateSortOrder(user: OpdsUser, sortOrder: OpdsSortOrder) {
  try {
    const res = await api(`/api/v1/opds-users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sortOrder }),
    })
    if (res.ok) {
      const updated = await res.json()
      const idx = opdsUsers.value.findIndex((u) => u.id === user.id)
      if (idx >= 0) opdsUsers.value[idx] = updated
      toast.success(t('settings.reader.opds.sortOrderUpdated', { username: user.username }))
    } else {
      toast.error(t('settings.reader.opds.updateSortFailed'))
    }
  } catch {
    toast.error(t('settings.reader.opds.updateSortFailed'))
  }
}

function cancelCreate() {
  showCreateForm.value = false
  createError.value = null
}

async function deleteUser(user: OpdsUser) {
  try {
    const res = await api(`/api/v1/opds-users/${user.id}`, { method: 'DELETE' })
    if (res.ok) {
      opdsUsers.value = opdsUsers.value.filter((u) => u.id !== user.id)
      toast.success(t('settings.reader.opds.userDeleted', { username: user.username }))
    } else {
      toast.error(t('settings.reader.opds.deleteUserFailed'))
    }
  } catch {
    toast.error(t('settings.reader.opds.deleteUserFailed'))
  }
}

function requestDeleteUser(user: OpdsUser) {
  deleteConfirmUser.value = user
}

async function confirmDeleteUser() {
  if (!deleteConfirmUser.value) return
  const target = deleteConfirmUser.value
  deleteConfirmUser.value = null
  await deleteUser(target)
}

function toggleUserDetails(id: number) {
  expandedUserIds.value = expandedUserIds.value.includes(id)
    ? expandedUserIds.value.filter((entryId) => entryId !== id)
    : [...expandedUserIds.value, id]
}

function userDetailsOpen(id: number) {
  return expandedUserIds.value.includes(id)
}

async function copyValue(value: string, label: string) {
  const copied = await copyToClipboard(value)
  if (copied) {
    toast.success(t('settings.reader.opds.labelCopied', { label }))
  } else {
    toast.error(t('settings.reader.opds.copyLabelFailed', { label: label.toLowerCase() }))
  }
}

watch(
  isMobile,
  (mobile) => {
    helpOpen.value = !mobile
  },
  { immediate: true },
)
</script>

<template>
  <SettingsPageHeader class="hidden md:flex" :title="t('settings.reader.opds.title')" :subtitle="t('settings.reader.opds.subtitle')" />
  <div class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.reader.opds.title') }}</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      {{ t('settings.reader.opds.subtitle') }}
    </p>
  </div>

  <div v-if="loading" class="mt-5 md:mt-0 text-sm text-muted-foreground">{{ t('common.loading') }}</div>
  <div v-else-if="error" class="text-sm text-destructive">{{ error }}</div>
  <template v-else>
    <!-- Server Toggle -->
    <div v-if="canManageSettings" class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.opds.server') }}</p>
      <div class="border border-border rounded-lg overflow-hidden shadow-xs">
        <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
          <div class="min-w-0">
            <p class="settings-label">{{ t('settings.reader.opds.catalogServer') }}</p>
            <p class="settings-hint">{{ t('settings.reader.opds.catalogServerHint') }}</p>
          </div>
          <ToggleSwitch :model-value="opdsEnabled" class="self-start md:self-auto" @update:model-value="toggleOpds()" />
        </div>
      </div>
    </div>

    <!-- Endpoint URL -->
    <div v-if="opdsEnabled" class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.opds.endpoint') }}</p>
      <div class="border border-border rounded-lg overflow-hidden shadow-xs">
        <div class="flex flex-col md:flex-row md:items-center gap-2 px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <Rss :size="14" class="text-muted-foreground shrink-0" />
          <input :value="opdsUrl" readonly class="flex-1 text-sm bg-transparent text-foreground outline-none select-all min-w-0 truncate" />
          <button
            class="w-full md:w-auto flex items-center justify-center gap-1.5 px-3 py-2 md:py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors shrink-0"
            @click="copyUrl()"
          >
            <Copy :size="12" />
            {{ t('settings.reader.opds.copy') }}
          </button>
        </div>
      </div>
    </div>

    <!-- OPDS Users -->
    <div v-if="opdsEnabled" class="mb-6">
      <div class="hidden md:flex items-center justify-between mb-3">
        <p class="settings-group-label mb-0">{{ t('settings.reader.opds.accounts') }}</p>
        <button
          v-if="!showCreateForm"
          class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          @click="showCreateForm = true"
        >
          <Plus :size="12" />
          {{ t('settings.reader.opds.add') }}
        </button>
      </div>
      <div class="md:hidden flex items-center justify-between mb-2">
        <p class="settings-group-label mb-0">{{ t('settings.reader.opds.accounts') }}</p>
      </div>
      <div v-if="!showCreateForm" class="md:hidden sticky top-0 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2 mb-3">
        <button
          class="w-full min-h-10 flex items-center justify-center gap-1.5 px-3 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          @click="showCreateForm = true"
        >
          <Plus :size="13" />
          {{ t('settings.reader.opds.addAccount') }}
        </button>
      </div>

      <!-- Create form -->
      <div v-if="showCreateForm" class="border border-border rounded-lg p-4 md:p-5 bg-card mb-4 space-y-4 shadow-xs">
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('settings.reader.opds.username') }}</label>
          <input v-model="createUsername" type="text" :placeholder="t('settings.reader.opds.usernamePlaceholder')" class="input-field w-full" />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('settings.reader.opds.password') }}</label>
          <input v-model="createPassword" type="password" :placeholder="t('settings.reader.opds.passwordPlaceholder')" class="input-field w-full" />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('settings.reader.opds.defaultSort') }}</label>
          <select v-model="createSortOrder" class="select-field w-full">
            <option v-for="opt in sortOrderOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
        </div>
        <div v-if="createError" class="text-xs text-destructive">{{ createError }}</div>
        <div class="hidden md:flex items-center gap-2 pt-1">
          <button
            class="px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            :disabled="creating || !createUsername || !createPassword"
            @click="createUser()"
          >
            {{ creating ? t('settings.reader.opds.creating') : t('settings.reader.opds.create') }}
          </button>
          <button
            class="px-4 py-2 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
            @click="cancelCreate()"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
        <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
          <div class="flex items-center gap-2">
            <button
              class="settings-btn-primary flex-1 min-h-10 justify-center"
              :disabled="creating || !createUsername || !createPassword"
              @click="createUser()"
            >
              {{ creating ? t('settings.reader.opds.creating') : t('settings.reader.opds.create') }}
            </button>
            <button
              class="rounded-md border border-border px-3 min-h-10 text-sm text-foreground hover:bg-muted transition-colors"
              @click="cancelCreate()"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Users list -->
      <div v-if="opdsUsers.length === 0 && !showCreateForm" class="border border-border rounded-lg px-5 py-8 bg-card text-center shadow-xs">
        <p class="text-sm text-muted-foreground">{{ t('settings.reader.opds.noAccounts') }}</p>
      </div>
      <div v-else-if="opdsUsers.length > 0" class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div v-for="user in opdsUsers" :key="user.id" class="px-4 py-3.5 bg-card space-y-3 md:flex md:items-center md:gap-3 md:space-y-0 md:px-5">
          <div class="flex-1 min-w-0">
            <p class="settings-label truncate">{{ user.username }}</p>
            <p class="settings-hint" :class="userDetailsOpen(user.id) ? '' : 'line-clamp-1'">{{ sortOrderLabel(user.sortOrder) }}</p>
          </div>
          <div class="flex items-center gap-2">
            <select
              :value="user.sortOrder"
              class="select-field text-xs h-9 md:h-auto py-1 w-full md:w-auto"
              @change="updateSortOrder(user, ($event.target as HTMLSelectElement).value as OpdsSortOrder)"
            >
              <option v-for="opt in sortOrderOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <button
              class="hidden md:flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              @click="requestDeleteUser(user)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
          <div class="md:hidden flex items-center gap-3 text-xs">
            <button class="text-primary hover:underline" @click="toggleUserDetails(user.id)">
              {{ userDetailsOpen(user.id) ? t('settings.reader.opds.hideDetails') : t('settings.reader.opds.showDetails') }}
            </button>
            <button class="text-muted-foreground hover:text-foreground" @click="copyValue(user.username, t('settings.reader.opds.usernameLabel'))">
              {{ t('settings.reader.opds.copyUsername') }}
            </button>
            <button class="text-destructive hover:underline" @click="requestDeleteUser(user)">{{ t('common.delete') }}</button>
          </div>
          <div
            v-if="userDetailsOpen(user.id)"
            class="md:hidden rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground"
          >
            <div class="grid grid-cols-[4.5rem_1fr] gap-y-1.5 gap-x-2">
              <span class="text-muted-foreground/80">{{ t('settings.reader.opds.usernameLabel') }}</span>
              <span class="font-mono text-foreground/90 break-all">{{ user.username }}</span>
              <span class="text-muted-foreground/80">{{ t('settings.reader.opds.sortLabel') }}</span>
              <span class="text-foreground/90">{{ sortOrderLabel(user.sortOrder) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="opdsEnabled" class="border border-border rounded-lg bg-card/50 shadow-xs">
      <button class="w-full flex items-center justify-between gap-2 p-4 text-left" @click="helpOpen = !helpOpen">
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('settings.reader.opds.notes') }}</p>
        <ChevronUp v-if="helpOpen" :size="14" class="text-muted-foreground" />
        <ChevronDown v-else :size="14" class="text-muted-foreground" />
      </button>
      <p v-if="helpOpen" class="px-4 pb-4 text-xs text-muted-foreground">
        {{ t('settings.reader.opds.notesBody') }}
      </p>
    </div>

    <div
      v-if="deleteConfirmUser"
      class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
      @click.self="deleteConfirmUser = null"
    >
      <button class="absolute inset-0 bg-black/45" @click="deleteConfirmUser = null" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">{{ t('settings.reader.opds.deleteConfirmTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.reader.opds.deleteConfirmBody', { username: deleteConfirmUser.username }) }}</p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="deleteConfirmUser = null"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            @click="confirmDeleteUser"
          >
            {{ t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </template>
</template>
