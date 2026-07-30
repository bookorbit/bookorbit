<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { KeyRound, MoreVertical, Pencil, Save, Search, ShieldAlert, ShieldCheck, Trash2, UserPlus } from '@lucide/vue'
import { Permission, type AuthUser, type DefaultLibraryAccessConfig } from '@bookorbit/types'
import { api } from '@/lib/api'
import { formatNumber } from '@/i18n/formatters'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useUsers, type UserRow } from './composables/useUsers'
import UserFormDrawer from './UserFormDrawer.vue'
import ResetLinkModal from './ResetLinkModal.vue'
import StatusPill from './components/StatusPill.vue'
import type { StatusPillTone } from './lib/status-pill-styles'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

const { t } = useI18n()
const { isSuperuser, hasPermission } = usePermissions()

const {
  users,
  libraries,
  page,
  totalPages,
  search,
  state,
  sortBy,
  sortDir,
  loading,
  error,
  defaultLibraryIds,
  defaultLibraryIdsArray,
  hasDefaultLibraryChanges,
  load,
  resetFilters,
  toggleDefaultLibrary,
  markDefaultLibrariesSaved,
} = useUsers()

const drawerOpen = ref(false)
const editingUser = ref<Partial<AuthUser> | null>(null)
const resetUrl = ref<string | null>(null)
const deleteConfirmUser = ref<UserRow | null>(null)
const deleting = ref(false)
const actionError = ref<string | null>(null)

const savingDefaultLibraryAccess = ref(false)
const defaultLibraryAccessError = ref<string | null>(null)

const canManageUserDefaults = computed(() => hasPermission(Permission.ManageUsers))

const hasActiveFilters = computed(() => search.value.length > 0 || state.value.length > 0 || sortBy.value !== 'username' || sortDir.value !== 'asc')

const sortSelection = computed<string>({
  get: () => `${sortBy.value}:${sortDir.value}`,
  set: (value) => {
    const [field, direction] = value.split(':') as [typeof sortBy.value, typeof sortDir.value]
    sortBy.value = field
    sortDir.value = direction
  },
})

onMounted(load)

function applyFilters() {
  page.value = 1
  void load()
}

function clearFilters() {
  resetFilters()
  void load()
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

function closeDrawer() {
  drawerOpen.value = false
}

function clearResetUrl() {
  resetUrl.value = null
}

/** Granted permissions read as a capability tier, so a plain viewer stays neutral. */
function accessTone(user: UserRow): StatusPillTone {
  if (user.isSuperuser) return 'accent'
  return (user.permissions?.length ?? 0) > 0 ? 'info' : 'neutral'
}

function canManage(user: UserRow): boolean {
  return isSuperuser.value || !user.isSuperuser
}

function isPasswordResettable(user: UserRow): boolean {
  return user.provisioningMethod !== 'oidc' && user.provisioningMethod !== 'shared'
}

function resetPasswordHint(user: UserRow): string {
  if (user.provisioningMethod === 'oidc') return t('adminFeature.usersPage.resetPasswordOidcHint')
  if (user.provisioningMethod === 'shared') return t('adminFeature.usersPage.resetPasswordSharedHint')
  return t('adminFeature.usersPage.resetPassword')
}

async function handleResetPassword(userId: number) {
  const res = await api(`/api/v1/users/${userId}/reset-password`, { method: 'POST' })
  if (!res.ok) {
    actionError.value = t('adminFeature.usersPage.errors.resetPassword')
    return
  }
  const data = await res.json()
  resetUrl.value = data.resetUrl
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
    await load()
  } catch {
    actionError.value = t('adminFeature.usersPage.errors.deleteUser')
  } finally {
    deleting.value = false
  }
}

async function onSaved(newResetUrl?: string) {
  drawerOpen.value = false
  if (newResetUrl) resetUrl.value = newResetUrl
  await load()
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
  <section aria-labelledby="users-heading" class="space-y-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h2 id="users-heading" class="text-lg font-semibold text-foreground">{{ t('adminFeature.usersPage.usersTitle') }}</h2>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('adminFeature.usersPage.usersSubtitle') }}</p>
      </div>
      <button type="button" class="settings-btn-primary" @click="openCreate">
        <UserPlus :size="14" aria-hidden="true" />
        {{ t('adminFeature.usersPage.createUser') }}
      </button>
    </div>

    <form
      class="grid gap-2 rounded-lg border border-border bg-card p-2 md:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(9rem,auto)_minmax(10rem,auto)_auto_auto]"
      @submit.prevent="applyFilters"
    >
      <label class="relative block">
        <span class="sr-only">{{ t('adminFeature.usersPage.filters.search') }}</span>
        <Search :size="15" class="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          v-model="search"
          type="search"
          class="h-9 w-full rounded-md border border-input bg-background ps-9 pe-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :placeholder="t('adminFeature.usersPage.filters.searchPlaceholder')"
        />
      </label>
      <label>
        <span class="sr-only">{{ t('adminFeature.usersPage.filters.state') }}</span>
        <select v-model="state" class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" @change="applyFilters">
          <option value="">{{ t('adminFeature.usersPage.filters.allUsers') }}</option>
          <option value="admins">{{ t('adminFeature.usersPage.filters.admins') }}</option>
          <option value="active">{{ t('adminFeature.usersPage.filters.active') }}</option>
          <option value="inactive">{{ t('adminFeature.usersPage.filters.inactive') }}</option>
        </select>
      </label>
      <label>
        <span class="sr-only">{{ t('adminFeature.usersPage.filters.sort') }}</span>
        <select v-model="sortSelection" class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" @change="applyFilters">
          <option value="username:asc">{{ t('adminFeature.usersPage.filters.usernameAsc') }}</option>
          <option value="name:asc">{{ t('adminFeature.usersPage.filters.nameAsc') }}</option>
          <option value="createdAt:desc">{{ t('adminFeature.usersPage.filters.newest') }}</option>
          <option value="createdAt:asc">{{ t('adminFeature.usersPage.filters.oldest') }}</option>
        </select>
      </label>
      <button type="submit" class="settings-btn-primary h-9 justify-center">{{ t('adminFeature.usersPage.filters.apply') }}</button>
      <button v-if="hasActiveFilters" type="button" class="settings-btn-outline h-9 justify-center" @click="clearFilters">
        {{ t('adminFeature.usersPage.filters.clear') }}
      </button>
    </form>

    <p v-if="actionError" role="alert" class="text-sm text-destructive">{{ actionError }}</p>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ t('adminFeature.usersPage.errors.load') }}</p>
    <p v-else-if="loading" role="status" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
    <div v-else-if="users.length === 0" class="rounded-lg border border-dashed border-border px-4 py-8 text-center">
      <p class="text-sm font-medium text-foreground">{{ t('adminFeature.usersPage.empty.title') }}</p>
      <p class="mt-1 text-sm text-muted-foreground">
        {{ hasActiveFilters ? t('adminFeature.usersPage.empty.filtered') : t('adminFeature.usersPage.empty.description') }}
      </p>
    </div>

    <template v-else>
      <div class="hidden overflow-x-auto rounded-lg border border-border shadow-xs md:block">
        <table class="w-full min-w-[820px] table-fixed text-sm">
          <colgroup>
            <col class="w-[26%]" />
            <col class="w-[24%]" />
            <col class="w-[22%]" />
            <col class="w-[14%]" />
            <col class="w-[14%]" />
          </colgroup>
          <thead class="bg-muted/50 text-muted-foreground">
            <tr>
              <th class="px-3 py-2 text-start text-xs font-medium">{{ t('adminFeature.usersPage.columns.name') }}</th>
              <th class="px-3 py-2 text-start text-xs font-medium">{{ t('adminFeature.usersPage.columns.email') }}</th>
              <th class="px-3 py-2 text-start text-xs font-medium">{{ t('adminFeature.usersPage.columns.access') }}</th>
              <th class="px-3 py-2 text-start text-xs font-medium">{{ t('adminFeature.usersPage.columns.status') }}</th>
              <th class="px-3 py-2 text-end text-xs font-medium">{{ t('adminFeature.usersPage.columns.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="user in users" :key="user.id" class="bg-card hover:bg-muted/30">
              <td class="px-3 py-2">
                <p class="truncate font-medium text-foreground">{{ user.name }}</p>
                <p class="truncate font-mono text-xs text-muted-foreground">@{{ user.username }}</p>
              </td>
              <td class="truncate px-3 py-2 text-xs text-muted-foreground">{{ user.email ?? '-' }}</td>
              <td class="px-3 py-2">
                <div class="flex flex-wrap items-center gap-1.5">
                  <StatusPill v-if="user.isSuperuser" tone="accent">
                    <ShieldCheck :size="11" aria-hidden="true" />
                    {{ t('adminFeature.usersPage.adminBadge') }}
                  </StatusPill>
                  <StatusPill v-else :tone="accessTone(user)">
                    {{ t('adminFeature.usersPage.permissionCount', { count: user.permissions?.length ?? 0 }) }}
                  </StatusPill>
                  <Tooltip v-if="user.hasContentFilters">
                    <TooltipTrigger as-child>
                      <span>
                        <StatusPill tone="warning">
                          <ShieldAlert :size="11" aria-hidden="true" />
                          {{ t('adminFeature.usersPage.filteredBadge') }}
                        </StatusPill>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{{ t('adminFeature.usersPage.contentRestrictionsActive') }}</TooltipContent>
                  </Tooltip>
                </div>
              </td>
              <td class="px-3 py-2">
                <StatusPill :tone="user.active ? 'success' : 'danger'">
                  {{ user.active ? t('adminFeature.usersPage.statusActive') : t('adminFeature.usersPage.statusInactive') }}
                </StatusPill>
              </td>
              <td class="px-3 py-2">
                <div class="flex items-center justify-end gap-1">
                  <template v-if="canManage(user)">
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <button
                          type="button"
                          class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          :aria-label="t('adminFeature.usersPage.editUserAria', { name: user.name })"
                          @click="openEdit(user)"
                        >
                          <Pencil :size="14" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{{ t('common.edit') }}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <span>
                          <button
                            type="button"
                            :disabled="!isPasswordResettable(user)"
                            class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                            :aria-label="t('adminFeature.usersPage.resetPasswordAria', { name: user.name })"
                            @click="handleResetPassword(user.id)"
                          >
                            <KeyRound :size="14" aria-hidden="true" />
                          </button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{{ resetPasswordHint(user) }}</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <button
                          type="button"
                          class="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          :aria-label="t('adminFeature.usersPage.deleteUserAria', { name: user.name })"
                          @click="requestDeleteUser(user)"
                        >
                          <Trash2 :size="14" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{{ t('common.delete') }}</TooltipContent>
                    </Tooltip>
                  </template>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="space-y-2 md:hidden">
        <article v-for="user in users" :key="user.id" class="rounded-lg border border-border bg-card p-3 shadow-xs">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-medium text-foreground">{{ user.name }}</p>
              <p class="truncate font-mono text-xs text-muted-foreground">@{{ user.username }}</p>
            </div>
            <StatusPill :tone="user.active ? 'success' : 'danger'" class="shrink-0">
              {{ user.active ? t('adminFeature.usersPage.statusActive') : t('adminFeature.usersPage.statusInactive') }}
            </StatusPill>
          </div>
          <div class="mt-3 flex flex-wrap items-center gap-1.5">
            <StatusPill v-if="user.isSuperuser" tone="accent">
              <ShieldCheck :size="11" aria-hidden="true" />
              {{ t('adminFeature.usersPage.adminBadge') }}
            </StatusPill>
            <StatusPill v-else :tone="accessTone(user)">
              {{ t('adminFeature.usersPage.permissionCount', { count: user.permissions?.length ?? 0 }) }}
            </StatusPill>
            <StatusPill v-if="user.hasContentFilters" tone="warning">
              <ShieldAlert :size="11" aria-hidden="true" />
              {{ t('adminFeature.usersPage.filteredBadge') }}
            </StatusPill>
          </div>
          <div v-if="canManage(user)" class="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <button
              type="button"
              class="rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="openEdit(user)"
            >
              {{ t('common.edit') }}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  class="rounded-md border border-border p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :aria-label="t('adminFeature.usersPage.moreActionsAria', { name: user.name })"
                >
                  <MoreVertical :size="16" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-56">
                <DropdownMenuItem :disabled="!isPasswordResettable(user)" @click="handleResetPassword(user.id)">
                  {{ t('adminFeature.usersPage.resetPassword') }}
                </DropdownMenuItem>
                <DropdownMenuItem class="text-destructive focus:text-destructive" @click="requestDeleteUser(user)">
                  {{ t('adminFeature.usersPage.deleteUserAction') }}
                </DropdownMenuItem>
                <template v-if="!isPasswordResettable(user)">
                  <DropdownMenuSeparator />
                  <p class="px-2 py-1.5 text-xs leading-4 text-muted-foreground">
                    {{
                      user.provisioningMethod === 'oidc'
                        ? t('adminFeature.usersPage.resetPasswordOidcHintFull')
                        : t('adminFeature.usersPage.resetPasswordSharedHintFull')
                    }}
                  </p>
                </template>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </article>
      </div>

      <nav v-if="totalPages > 1" :aria-label="t('adminFeature.usersPage.pagination.label')" class="flex items-center justify-between gap-3">
        <p class="text-sm text-muted-foreground">
          {{ t('adminFeature.usersPage.pagination.page', { page: formatNumber(page), totalPages: formatNumber(totalPages) }) }}
        </p>
        <div class="flex gap-2">
          <button type="button" class="settings-btn-outline" :disabled="page <= 1" @click="previousPage">{{ t('common.previous') }}</button>
          <button type="button" class="settings-btn-outline" :disabled="page >= totalPages" @click="nextPage">{{ t('common.next') }}</button>
        </div>
      </nav>
    </template>

    <section v-if="!loading && !error && canManageUserDefaults" aria-labelledby="default-library-access-heading" class="space-y-3 pt-6">
      <div>
        <h3 id="default-library-access-heading" class="settings-group-label mb-1">
          {{ t('adminFeature.usersPage.defaultLibraryAccess.title') }}
        </h3>
        <p class="text-sm text-muted-foreground">{{ t('adminFeature.usersPage.defaultLibraryAccess.subtitle') }}</p>
      </div>
      <div class="rounded-lg border border-border bg-card p-4 shadow-xs">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p class="max-w-2xl text-sm text-muted-foreground">{{ t('adminFeature.usersPage.defaultLibraryAccess.description') }}</p>
          <button
            type="button"
            class="settings-btn-outline justify-center md:justify-start"
            :disabled="savingDefaultLibraryAccess || !hasDefaultLibraryChanges"
            @click="saveDefaultLibraryAccess"
          >
            <Save :size="14" aria-hidden="true" />
            {{
              savingDefaultLibraryAccess
                ? t('adminFeature.usersPage.defaultLibraryAccess.saving')
                : t('adminFeature.usersPage.defaultLibraryAccess.save')
            }}
          </button>
        </div>
        <div v-if="libraries.length > 0" class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label
            v-for="lib in libraries"
            :key="lib.id"
            class="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 transition-colors hover:bg-muted/40 focus-within:ring-2 focus-within:ring-ring"
          >
            <input
              type="checkbox"
              :checked="defaultLibraryIds.has(lib.id)"
              class="size-4 rounded border-input accent-primary"
              @change="toggleDefaultLibrary(lib.id)"
            />
            <span class="min-w-0 truncate text-sm text-foreground">{{ lib.name }}</span>
          </label>
        </div>
        <p v-else class="mt-3 text-sm text-muted-foreground">{{ t('adminFeature.usersPage.defaultLibraryAccess.noLibraries') }}</p>
        <p v-if="defaultLibraryAccessError" role="alert" class="mt-3 text-sm text-destructive">{{ defaultLibraryAccessError }}</p>
      </div>
    </section>

    <UserFormDrawer
      v-if="drawerOpen"
      :user="editingUser"
      :libraries="libraries"
      :default-library-ids="defaultLibraryIdsArray"
      @close="closeDrawer"
      @saved="onSaved"
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
  </section>
</template>
