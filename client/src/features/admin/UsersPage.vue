<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, TriangleAlert, UserPlus, X } from '@lucide/vue'
import { Permission, type DefaultLibraryAccessConfig, type UserListSortField, type UserListState } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { api } from '@/lib/api'
import { formatNumber } from '@/i18n/formatters'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useUsers, type UserRow } from './composables/useUsers'
import { useSelfRegistration } from './composables/useSelfRegistration'
import UserFormDrawer from './UserFormDrawer.vue'
import ResetLinkModal from './ResetLinkModal.vue'
import NewAccountDefaults from './components/NewAccountDefaults.vue'
import UserAttentionBand from './components/UserAttentionBand.vue'
import UserRosterCards from './components/UserRosterCards.vue'
import UserRosterTable from './components/UserRosterTable.vue'

const HEADER_ACTIONS_TARGET = '#settings-header-actions'

const { t } = useI18n()
const { isSuperuser, hasPermission } = usePermissions()

const {
  users,
  libraries,
  summary,
  attention,
  page,
  totalPages,
  total,
  search,
  state,
  sortBy,
  sortDir,
  loading,
  initialLoad,
  error,
  hasActiveFilters,
  defaultLibraryIds,
  defaultLibraryIdsArray,
  hasDefaultLibraryChanges,
  load,
  loadStatic,
  reload,
  toggleSort,
  setState,
  resetFilters,
  toggleDefaultLibrary,
  markDefaultLibrariesSaved,
} = useUsers()

const drawerOpen = ref(false)
const editingUser = ref<UserRow | null>(null)
const resetUrl = ref<string | null>(null)
const deleteConfirmUser = ref<UserRow | null>(null)
const deleting = ref(false)
const actionError = ref<string | null>(null)
const busyUserId = ref<number | null>(null)
/**
 * The header slot only exists when this page is mounted inside the settings shell. Falling
 * back to rendering in place keeps the primary action reachable anywhere else, including tests.
 */
const headerSlotAvailable = ref(false)

const savingDefaultLibraryAccess = ref(false)
const defaultLibraryAccessError = ref<string | null>(null)

const canManageUserDefaults = computed(() => hasPermission(Permission.ManageUsers))
const canManageAppSettings = computed(() => hasPermission(Permission.ManageAppSettings))
const showDefaults = computed(() => !initialLoad.value && !error.value && (canManageAppSettings.value || canManageUserDefaults.value))

const {
  allowRegistration,
  saving: savingSelfRegistration,
  error: selfRegistrationError,
  load: loadSelfRegistration,
  setAllowRegistration,
} = useSelfRegistration()

const stateFilters = computed<{ value: UserListState | ''; label: string; count: number }[]>(() => [
  { value: '', label: t('adminFeature.usersPage.filters.allUsers'), count: summary.value.total },
  { value: 'admins', label: t('adminFeature.usersPage.filters.admins'), count: summary.value.admins },
  { value: 'active', label: t('adminFeature.usersPage.filters.active'), count: summary.value.active },
  { value: 'inactive', label: t('adminFeature.usersPage.filters.inactive'), count: summary.value.inactive },
])

const pageSubtitle = computed(() =>
  t('adminFeature.usersPage.headerSummary', {
    accounts: formatNumber(summary.value.total),
    admins: formatNumber(summary.value.admins),
    count: summary.value.total,
  }),
)

onMounted(async () => {
  headerSlotAvailable.value = document.getElementById(HEADER_ACTIONS_TARGET.slice(1)) !== null
  await Promise.all([reload(), loadStatic()])
  if (canManageAppSettings.value) await loadSelfRegistration()
})

function clearSearch() {
  search.value = ''
}

function clearFilters() {
  resetFilters()
  void load()
}

function showAttentionOnly() {
  setState(state.value === 'attention' ? '' : 'attention')
}

function previousPage() {
  if (page.value <= 1) return
  page.value--
  void load()
}

function nextPage() {
  if (page.value >= totalPages.value) return
  page.value++
  void load()
}

function openCreate() {
  editingUser.value = null
  drawerOpen.value = true
}

function openEdit(user: UserRow) {
  editingUser.value = user
  drawerOpen.value = true
}

function openById(userId: number) {
  const match = users.value.find((user) => user.id === userId)
  if (match) openEdit(match)
}

const canDeleteEditingUser = computed(() => !!editingUser.value && canManage(editingUser.value))

/** Deleting from inside the editor closes it first: the confirm is the page's, and so is the list. */
function handleDrawerDelete() {
  const user = editingUser.value
  if (!user) return
  drawerOpen.value = false
  requestDeleteUser(user)
}

function closeDrawer() {
  drawerOpen.value = false
}

function clearResetUrl() {
  resetUrl.value = null
}

function canManage(user: UserRow): boolean {
  return isSuperuser.value || !user.isSuperuser
}

function isPasswordResettable(user: UserRow): boolean {
  return user.provisioningMethod !== 'oidc' && user.provisioningMethod !== 'shared'
}

function isLocked(user: UserRow): boolean {
  return Boolean(user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now())
}

/** Mirrors the server's attention predicate so the row marker agrees with the band. */
function needsAttention(user: UserRow): boolean {
  if (!user.active) return false
  return isLocked(user) || user.lastAuthenticatedAt === null || user.isDefaultPassword
}

async function handleUnlock(userId: number) {
  actionError.value = null
  busyUserId.value = userId
  try {
    const res = await api(`/api/v1/users/${userId}/unlock`, { method: 'POST' })
    if (!res.ok) {
      actionError.value = t('adminFeature.usersPage.errors.unlock')
      return
    }
    await reload()
  } finally {
    busyUserId.value = null
  }
}

async function handleResetPassword(userId: number) {
  actionError.value = null
  busyUserId.value = userId
  try {
    const res = await api(`/api/v1/users/${userId}/reset-password`, { method: 'POST' })
    if (!res.ok) {
      actionError.value = t('adminFeature.usersPage.errors.resetPassword')
      return
    }
    const data = await res.json()
    resetUrl.value = data.resetUrl
    await reload()
  } finally {
    busyUserId.value = null
  }
}

function unlockUser(user: UserRow) {
  void handleUnlock(user.id)
}

function resetUserPassword(user: UserRow) {
  void handleResetPassword(user.id)
}

function requestDeleteUser(user: UserRow) {
  actionError.value = null
  deleteConfirmUser.value = user
}

function cancelDeleteUser() {
  deleteConfirmUser.value = null
}

async function confirmDeleteUser() {
  if (!deleteConfirmUser.value || deleting.value) return
  deleting.value = true
  const user = deleteConfirmUser.value
  try {
    const res = await api(`/api/v1/users/${user.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      actionError.value = data.message ?? t('adminFeature.usersPage.errors.deleteUser')
      return
    }
    deleteConfirmUser.value = null
    await reload()
  } catch {
    actionError.value = t('adminFeature.usersPage.errors.deleteUser')
  } finally {
    deleting.value = false
  }
}

async function onSaved(newResetUrl?: string) {
  drawerOpen.value = false
  if (newResetUrl) resetUrl.value = newResetUrl
  await reload()
}

async function toggleSelfRegistration() {
  if (savingSelfRegistration.value) return
  await setAllowRegistration(!allowRegistration.value)
}

function handleSort(field: UserListSortField) {
  toggleSort(field)
}

function selectState(value: UserListState | '') {
  setState(value)
}

async function saveDefaultLibraryAccess() {
  if (savingDefaultLibraryAccess.value) return
  savingDefaultLibraryAccess.value = true
  defaultLibraryAccessError.value = null
  try {
    const res = await api('/api/v1/app-settings/default-library-access', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ libraryIds: defaultLibraryIdsArray.value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      defaultLibraryAccessError.value = data.message ?? t('adminFeature.usersPage.defaultLibraryAccess.saveError')
      return
    }
    const saved = (await res.json()) as DefaultLibraryAccessConfig
    markDefaultLibrariesSaved(saved.libraryIds ?? [])
  } catch {
    defaultLibraryAccessError.value = t('adminFeature.usersPage.defaultLibraryAccess.saveError')
  } finally {
    savingDefaultLibraryAccess.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <Teleport :to="HEADER_ACTIONS_TARGET" defer :disabled="!headerSlotAvailable">
      <p class="hidden text-sm text-muted-foreground lg:block">{{ pageSubtitle }}</p>
      <Button size="sm" type="button" @click="openCreate">
        <UserPlus :size="14" aria-hidden="true" />
        {{ t('adminFeature.usersPage.createUser') }}
      </Button>
    </Teleport>

    <p v-if="error" role="alert" class="settings-error-state">{{ t('adminFeature.usersPage.errors.load') }}</p>

    <template v-else>
      <UserAttentionBand
        v-if="attention.length > 0"
        :items="attention"
        :total="summary.attention"
        :busy-user-id="busyUserId"
        @unlock="handleUnlock"
        @send-reset-link="handleResetPassword"
        @open="openById"
      />

      <p v-if="actionError" role="alert" class="settings-error-state">{{ actionError }}</p>

      <div class="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label class="relative block min-w-0 flex-1 lg:order-1">
          <span class="sr-only">{{ t('adminFeature.usersPage.filters.search') }}</span>
          <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            v-model="search"
            type="search"
            class="input-field h-9 w-full ps-9 pe-9"
            :placeholder="t('adminFeature.usersPage.filters.searchPlaceholder')"
          />
          <button
            v-if="search"
            type="button"
            class="absolute end-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('adminFeature.usersPage.filters.clear')"
            @click="clearSearch"
          >
            <X :size="14" aria-hidden="true" />
          </button>
        </label>

        <div class="flex min-w-0 items-center gap-2 lg:order-2 lg:shrink-0">
          <div
            role="group"
            :aria-label="t('adminFeature.usersPage.filters.state')"
            class="flex min-w-0 gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted p-0.5"
          >
            <button
              v-for="filter in stateFilters"
              :key="filter.value || 'all'"
              type="button"
              class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="state === filter.value ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              :aria-pressed="state === filter.value"
              @click="selectState(filter.value)"
            >
              {{ filter.label }}
              <span
                class="rounded px-1 text-xs tabular-nums"
                :class="state === filter.value ? 'bg-primary/15 text-primary' : 'bg-foreground/8 text-muted-foreground'"
              >
                {{ formatNumber(filter.count) }}
              </span>
            </button>
          </div>

          <Button
            v-if="summary.attention > 0"
            variant="outline"
            size="sm"
            type="button"
            class="h-9 shrink-0 border-[var(--pill-warning)]/40 text-[var(--pill-warning)] hover:text-[var(--pill-warning)]"
            :aria-pressed="state === 'attention'"
            :aria-label="t('adminFeature.usersPage.attention.filter', { count: summary.attention })"
            @click="showAttentionOnly"
          >
            <TriangleAlert :size="14" aria-hidden="true" />
            <span class="sm:hidden">{{ formatNumber(summary.attention) }}</span>
            <span class="hidden sm:inline">{{ t('adminFeature.usersPage.attention.filter', { count: summary.attention }) }}</span>
          </Button>
        </div>
      </div>

      <p v-if="initialLoad" role="status" class="settings-loading-state">{{ t('common.loading') }}</p>

      <div v-else-if="users.length === 0" class="settings-empty-state">
        <p class="text-sm font-medium text-foreground">{{ t('adminFeature.usersPage.empty.title') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ hasActiveFilters ? t('adminFeature.usersPage.empty.filtered') : t('adminFeature.usersPage.empty.description') }}
        </p>
        <Button v-if="hasActiveFilters" variant="outline" size="sm" type="button" class="mt-3" @click="clearFilters">
          {{ t('adminFeature.usersPage.filters.clear') }}
        </Button>
      </div>

      <template v-else>
        <div :class="loading ? 'opacity-60 transition-opacity' : 'transition-opacity'" :aria-busy="loading">
          <UserRosterTable
            :users="users"
            :library-total="libraries.length"
            :sort-by="sortBy"
            :sort-dir="sortDir"
            :can-manage="canManage"
            :is-locked="isLocked"
            :is-resettable="isPasswordResettable"
            :needs-attention="needsAttention"
            @sort="handleSort"
            @edit="openEdit"
            @unlock="unlockUser"
            @reset-password="resetUserPassword"
            @remove="requestDeleteUser"
          />
          <UserRosterCards
            :users="users"
            :library-total="libraries.length"
            :can-manage="canManage"
            :needs-attention="needsAttention"
            @open="openEdit"
          />
        </div>

        <nav :aria-label="t('adminFeature.usersPage.pagination.label')" class="flex items-center justify-between gap-3">
          <p class="text-sm text-muted-foreground">
            {{ t('adminFeature.usersPage.pagination.showing', { shown: formatNumber(users.length), total: formatNumber(total) }) }}
          </p>
          <div v-if="totalPages > 1" class="flex items-center gap-2">
            <Button variant="outline" size="sm" type="button" :disabled="page <= 1" @click="previousPage">{{ t('common.previous') }}</Button>
            <span class="text-sm tabular-nums text-muted-foreground">
              {{ t('adminFeature.usersPage.pagination.page', { page: formatNumber(page), totalPages: formatNumber(totalPages) }) }}
            </span>
            <Button variant="outline" size="sm" type="button" :disabled="page >= totalPages" @click="nextPage">{{ t('common.next') }}</Button>
          </div>
        </nav>
      </template>
    </template>

    <NewAccountDefaults
      v-if="showDefaults"
      :show-self-registration="canManageAppSettings"
      :show-library-defaults="canManageUserDefaults"
      :allow-registration="allowRegistration"
      :saving-self-registration="savingSelfRegistration"
      :self-registration-error="selfRegistrationError"
      :libraries="libraries"
      :selected-library-ids="defaultLibraryIds"
      :saving-library-defaults="savingDefaultLibraryAccess"
      :library-defaults-error="defaultLibraryAccessError"
      :has-library-changes="hasDefaultLibraryChanges"
      @toggle-self-registration="toggleSelfRegistration"
      @toggle-library="toggleDefaultLibrary"
      @save-library-defaults="saveDefaultLibraryAccess"
    />

    <UserFormDrawer
      v-if="drawerOpen"
      :user="editingUser"
      :libraries="libraries"
      :default-library-ids="defaultLibraryIdsArray"
      :can-delete="canDeleteEditingUser"
      @close="closeDrawer"
      @saved="onSaved"
      @delete="handleDrawerDelete"
    />
    <ResetLinkModal v-if="resetUrl" :reset-url="resetUrl" @close="clearResetUrl" />

    <ConfirmDialog
      :open="deleteConfirmUser !== null"
      :title="t('adminFeature.usersPage.deleteDialogTitle')"
      :description="t('adminFeature.usersPage.deleteDialogBody', { username: deleteConfirmUser?.username ?? '' })"
      :confirm-label="deleting ? t('adminFeature.usersPage.deleting') : t('common.delete')"
      :busy="deleting"
      @confirm="confirmDeleteUser"
      @cancel="cancelDeleteUser"
    />
  </div>
</template>
