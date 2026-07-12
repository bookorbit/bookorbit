<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { UserPlus, Plus, Pencil, KeyRound, Trash2, ShieldCheck, MoreVertical, ShieldAlert, Save } from '@lucide/vue'
import { api } from '@/lib/api'
import { Permission, type AuthUser, type DefaultLibraryAccessConfig } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import UserFormDrawer from './UserFormDrawer.vue'
import ResetLinkModal from './ResetLinkModal.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import MagicLinksSettings from '@/features/settings/MagicLinksSettings.vue'

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

type Tab = 'users' | 'magic-links'

interface Library {
  id: number
  name: string
}

interface UserRow extends AuthUser {
  id: number
  hasContentFilters?: boolean
}

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { isSuperuser, hasPermission } = usePermissions()

const users = ref<UserRow[]>([])
const libraries = ref<Library[]>([])
const defaultLibraryIds = ref<Set<number>>(new Set())
const savedDefaultLibraryIds = ref<Set<number>>(new Set())
const total = ref(0)
const page = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
const defaultLibraryAccessError = ref<string | null>(null)
const defaultLibraryAccessSaved = ref(false)
const savingDefaultLibraryAccess = ref(false)

const drawerOpen = ref(false)
const editingUser = ref<Partial<AuthUser> | null>(null)
const resetUrl = ref<string | null>(null)
const deleteConfirmUser = ref<UserRow | null>(null)
const deleting = ref(false)

const magicLinksRef = ref<InstanceType<typeof MagicLinksSettings> | null>(null)
const canManageUserDefaults = computed(() => hasPermission(Permission.ManageUsers))
const defaultLibraryIdsArray = computed(() => [...defaultLibraryIds.value])
const hasDefaultLibraryChanges = computed(() => !setsEqual(defaultLibraryIds.value, savedDefaultLibraryIds.value))

function normalizeTab(v: unknown): Tab {
  if (v === 'magic-links' && isSuperuser.value) return 'magic-links'
  return 'users'
}

const activeTab = ref<Tab>(normalizeTab(route.query.tab))

watch(
  () => route.query.tab,
  (v) => {
    activeTab.value = normalizeTab(v)
  },
)

function selectTab(tab: Tab) {
  activeTab.value = tab
  router.replace({ name: 'settings-admin-users', query: { tab } })
}

async function loadData() {
  loading.value = true
  error.value = null
  defaultLibraryAccessError.value = null
  try {
    const [usersRes, libsRes, defaultAccessRes] = await Promise.all([
      api(`/api/v1/users?page=${page.value}&pageSize=50`),
      api('/api/v1/libraries'),
      api('/api/v1/app-settings/default-library-access'),
    ])
    if (!usersRes.ok || !libsRes.ok || !defaultAccessRes.ok) throw new Error(t('adminFeature.usersPage.errors.loadData'))
    const ud = await usersRes.json()
    users.value = ud.users ?? ud.items ?? ud
    total.value = ud.total ?? users.value.length
    const libData = await libsRes.json()
    libraries.value = libData.libraries ?? libData.items ?? libData
    const defaultAccess = (await defaultAccessRes.json()) as DefaultLibraryAccessConfig
    setDefaultLibrarySelection(defaultAccess.libraryIds ?? [])
    savedDefaultLibraryIds.value = new Set(defaultAccess.libraryIds ?? [])
    defaultLibraryAccessSaved.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('adminFeature.usersPage.errors.load')
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

function openCreate() {
  editingUser.value = null
  drawerOpen.value = true
}

function openEdit(user: UserRow) {
  editingUser.value = user
  drawerOpen.value = true
}

async function handleResetPassword(userId: number) {
  const res = await api(`/api/v1/users/${userId}/reset-password`, { method: 'POST' })
  if (!res.ok) return
  const data = await res.json()
  resetUrl.value = data.resetUrl
}

function requestDeleteUser(user: UserRow) {
  deleteConfirmUser.value = user
}

async function confirmDeleteUser() {
  if (!deleteConfirmUser.value || deleting.value) return
  deleting.value = true
  const user = deleteConfirmUser.value
  try {
    const res = await api(`/api/v1/users/${user.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      error.value = data.message ?? t('adminFeature.usersPage.errors.deleteUser')
      return
    }
    deleteConfirmUser.value = null
    loadData()
  } catch {
    error.value = t('adminFeature.usersPage.errors.deleteUser')
  } finally {
    deleting.value = false
  }
}

function onSaved(newResetUrl?: string) {
  drawerOpen.value = false
  if (newResetUrl) resetUrl.value = newResetUrl
  loadData()
}

function openMagicLinkCreate() {
  magicLinksRef.value?.openCreateForm()
}

function setDefaultLibrarySelection(libraryIds: number[]) {
  defaultLibraryIds.value = new Set(libraryIds)
}

function toggleDefaultLibrary(libraryId: number) {
  const next = new Set(defaultLibraryIds.value)
  if (next.has(libraryId)) {
    next.delete(libraryId)
  } else {
    next.add(libraryId)
  }
  defaultLibraryIds.value = next
  defaultLibraryAccessSaved.value = false
}

async function saveDefaultLibraryAccess() {
  if (savingDefaultLibraryAccess.value) return
  savingDefaultLibraryAccess.value = true
  defaultLibraryAccessError.value = null
  defaultLibraryAccessSaved.value = false
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
    setDefaultLibrarySelection(saved.libraryIds ?? [])
    savedDefaultLibraryIds.value = new Set(saved.libraryIds ?? [])
    defaultLibraryAccessSaved.value = true
  } catch (e) {
    defaultLibraryAccessError.value = e instanceof Error ? e.message : t('adminFeature.usersPage.defaultLibraryAccess.saveError')
  } finally {
    savingDefaultLibraryAccess.value = false
  }
}

function setsEqual(a: Set<number>, b: Set<number>) {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}
</script>

<template>
  <!-- Desktop header -->
  <SettingsPageHeader
    v-if="!props.embedded"
    class="hidden md:flex"
    :title="activeTab === 'users' ? t('adminFeature.usersPage.usersTitle') : t('adminFeature.usersPage.magicLinksTitle')"
    :subtitle="activeTab === 'users' ? t('adminFeature.usersPage.usersSubtitle') : t('adminFeature.usersPage.magicLinksSubtitle')"
  >
    <button v-if="activeTab === 'users'" class="settings-btn-primary" @click="openCreate">
      <UserPlus :size="14" />
      {{ t('adminFeature.usersPage.createUser') }}
    </button>
    <button v-else class="settings-btn-primary" @click="openMagicLinkCreate">
      <Plus :size="14" />
      {{ t('adminFeature.usersPage.createLink') }}
    </button>
  </SettingsPageHeader>

  <!-- Mobile title -->
  <div v-if="!props.embedded" class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">
      {{ activeTab === 'users' ? t('adminFeature.usersPage.usersTitle') : t('adminFeature.usersPage.magicLinksTitle') }}
    </h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      {{ activeTab === 'users' ? t('adminFeature.usersPage.usersSubtitle') : t('adminFeature.usersPage.magicLinksSubtitle') }}
    </p>
  </div>

  <!-- Tab bar (superusers only) -->
  <div
    v-if="isSuperuser && !props.embedded"
    class="flex gap-1 mt-1 mb-5 md:mb-6 border-b border-border overflow-x-auto md:overflow-visible md:static sticky top-0 z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 snap-x"
  >
    <button
      class="px-3 py-3 md:py-2 text-sm font-medium shrink-0 border-b-2 -mb-px transition-colors snap-start"
      :class="
        activeTab === 'users'
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
      "
      @click="selectTab('users')"
    >
      {{ t('adminFeature.usersPage.usersTab') }}
    </button>
    <button
      class="px-3 py-3 md:py-2 text-sm font-medium shrink-0 border-b-2 -mb-px transition-colors snap-start"
      :class="
        activeTab === 'magic-links'
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
      "
      @click="selectTab('magic-links')"
    >
      {{ t('adminFeature.usersPage.magicLinksTab') }}
    </button>
  </div>

  <!-- Mobile CTA (when no tab bar is shown, keep the sticky button) -->
  <div
    v-if="!isSuperuser && !props.embedded"
    class="md:hidden sticky top-0 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2 mt-4 mb-3"
  >
    <button class="settings-btn-primary w-full min-h-10 justify-center" @click="openCreate">
      <UserPlus :size="14" />
      {{ t('adminFeature.usersPage.createUser') }}
    </button>
  </div>

  <!-- Users tab content -->
  <template v-if="activeTab === 'users'">
    <div v-if="error" class="mb-4 text-sm text-destructive">{{ error }}</div>
    <div v-if="loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</div>

    <section v-else class="space-y-3">
      <div class="flex items-center justify-between mb-3">
        <p class="settings-group-label mb-0">{{ t('adminFeature.usersPage.currentUsers') }}</p>
        <button v-if="props.embedded" class="settings-btn-primary" @click="openCreate">
          <UserPlus :size="14" />
          {{ t('adminFeature.usersPage.createUser') }}
        </button>
      </div>

      <div class="space-y-3">
        <div class="hidden md:block rounded-lg border border-border overflow-hidden shadow-xs">
          <table class="w-full text-sm">
            <thead class="bg-muted/50">
              <tr>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('adminFeature.usersPage.columns.name') }}</th>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('adminFeature.usersPage.columns.username') }}</th>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">
                  {{ t('adminFeature.usersPage.columns.email') }}
                </th>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('adminFeature.usersPage.columns.access') }}</th>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground">{{ t('adminFeature.usersPage.columns.status') }}</th>
                <th class="px-4 py-3" />
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="user in users" :key="user.id" class="hover:bg-muted/30 transition-colors">
                <td class="px-4 py-3 text-foreground font-medium">{{ user.name }}</td>
                <td class="px-4 py-3 text-muted-foreground font-mono text-xs">{{ user.username }}</td>
                <td class="px-4 py-3 text-muted-foreground hidden sm:table-cell">{{ user.email ?? '-' }}</td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span
                      v-if="user.isSuperuser"
                      class="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
                    >
                      <ShieldCheck :size="11" />
                      {{ t('adminFeature.usersPage.adminBadge') }}
                    </span>
                    <span v-else class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {{ t('adminFeature.usersPage.permissionCount', { count: user.permissions?.length ?? 0 }, user.permissions?.length ?? 0) }}
                    </span>
                    <Tooltip v-if="user.hasContentFilters">
                      <TooltipTrigger as-child>
                        <span
                          class="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
                        >
                          <ShieldAlert :size="11" />
                          {{ t('adminFeature.usersPage.filteredBadge') }}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{{ t('adminFeature.usersPage.contentRestrictionsActive') }}</TooltipContent>
                    </Tooltip>
                  </div>
                </td>
                <td class="px-4 py-3">
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                    :class="user.active ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-destructive/15 text-destructive'"
                  >
                    {{ user.active ? t('adminFeature.usersPage.statusActive') : t('adminFeature.usersPage.statusInactive') }}
                  </span>
                </td>
                <td class="px-4 py-3">
                  <div class="flex items-center gap-2 justify-end">
                    <template v-if="isSuperuser || !user.isSuperuser">
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <button
                            class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            @click="openEdit(user)"
                          >
                            <Pencil :size="14" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>{{ t('common.edit') }}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <button
                            :disabled="user.provisioningMethod === 'oidc' || user.provisioningMethod === 'shared'"
                            class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            :class="
                              user.provisioningMethod === 'oidc' || user.provisioningMethod === 'shared'
                                ? 'cursor-not-allowed opacity-50 hover:text-muted-foreground hover:bg-transparent'
                                : ''
                            "
                            @click="handleResetPassword(user.id)"
                          >
                            <KeyRound :size="14" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {{
                            user.provisioningMethod === 'oidc'
                              ? t('adminFeature.usersPage.resetPasswordOidcHint')
                              : user.provisioningMethod === 'shared'
                                ? t('adminFeature.usersPage.resetPasswordSharedHint')
                                : t('adminFeature.usersPage.resetPassword')
                          }}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <button
                            class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            @click="requestDeleteUser(user)"
                          >
                            <Trash2 :size="14" />
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

        <div class="md:hidden space-y-3">
          <div v-for="user in users" :key="user.id" class="rounded-lg border border-border bg-card px-4 py-3.5 shadow-xs">
            <div class="flex items-start justify-between gap-3">
              <p class="text-sm font-medium text-foreground leading-5">{{ user.name }}</p>
              <span
                class="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                :class="user.active ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-destructive/15 text-destructive'"
              >
                {{ user.active ? t('adminFeature.usersPage.statusActive') : t('adminFeature.usersPage.statusInactive') }}
              </span>
            </div>
            <div class="mt-2 flex items-center justify-between gap-3">
              <p class="text-xs font-mono text-muted-foreground truncate">@{{ user.username }}</p>
              <span
                v-if="user.isSuperuser"
                class="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
              >
                <ShieldCheck :size="11" />
                {{ t('adminFeature.usersPage.adminBadge') }}
              </span>
              <span v-else class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {{ t('adminFeature.usersPage.permissionCount', { count: user.permissions?.length ?? 0 }, user.permissions?.length ?? 0) }}
              </span>
            </div>
            <div v-if="isSuperuser || !user.isSuperuser" class="mt-3 flex items-center gap-2">
              <button
                class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                @click="openEdit(user)"
              >
                {{ t('common.edit') }}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <button class="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    <MoreVertical :size="16" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" class="w-56">
                  <DropdownMenuItem
                    :disabled="user.provisioningMethod === 'oidc' || user.provisioningMethod === 'shared'"
                    @click="handleResetPassword(user.id)"
                    >{{ t('adminFeature.usersPage.resetPassword') }}</DropdownMenuItem
                  >
                  <DropdownMenuItem class="text-destructive focus:text-destructive" @click="requestDeleteUser(user)">{{
                    t('adminFeature.usersPage.deleteUserAction')
                  }}</DropdownMenuItem>
                  <DropdownMenuSeparator v-if="user.provisioningMethod === 'oidc' || user.provisioningMethod === 'shared'" />
                  <p v-if="user.provisioningMethod === 'oidc'" class="px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
                    {{ t('adminFeature.usersPage.resetPasswordOidcHintFull') }}
                  </p>
                  <p v-else-if="user.provisioningMethod === 'shared'" class="px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
                    {{ t('adminFeature.usersPage.resetPasswordSharedHintFull') }}
                  </p>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section v-if="!loading && !error && canManageUserDefaults" class="mt-10 space-y-3">
      <div>
        <p class="settings-group-label mb-1">{{ t('adminFeature.usersPage.defaultLibraryAccess.title') }}</p>
        <p class="text-sm text-muted-foreground">{{ t('adminFeature.usersPage.defaultLibraryAccess.subtitle') }}</p>
      </div>
      <div class="rounded-lg border border-border bg-card p-4 shadow-xs">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p class="text-sm text-muted-foreground">{{ t('adminFeature.usersPage.defaultLibraryAccess.description') }}</p>
          <button
            type="button"
            class="settings-btn-outline justify-center md:justify-start"
            :disabled="savingDefaultLibraryAccess || !hasDefaultLibraryChanges"
            @click="saveDefaultLibraryAccess"
          >
            <Save :size="14" />
            {{
              savingDefaultLibraryAccess
                ? t('adminFeature.usersPage.defaultLibraryAccess.saving')
                : t('adminFeature.usersPage.defaultLibraryAccess.save')
            }}
          </button>
        </div>
        <div v-if="libraries.length > 0" class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label v-for="lib in libraries" :key="lib.id" class="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2">
            <input
              type="checkbox"
              :checked="defaultLibraryIds.has(lib.id)"
              class="h-4 w-4 rounded border-input"
              @change="toggleDefaultLibrary(lib.id)"
            />
            <span class="min-w-0 truncate text-sm text-foreground">{{ lib.name }}</span>
          </label>
        </div>
        <p v-else class="mt-3 text-sm text-muted-foreground">{{ t('adminFeature.usersPage.defaultLibraryAccess.noLibraries') }}</p>
        <p v-if="defaultLibraryAccessError" class="mt-3 text-sm text-destructive">{{ defaultLibraryAccessError }}</p>
        <p v-else-if="defaultLibraryAccessSaved" class="mt-3 text-sm text-muted-foreground">
          {{ t('adminFeature.usersPage.defaultLibraryAccess.saved') }}
        </p>
      </div>
    </section>

    <UserFormDrawer
      v-if="drawerOpen"
      :user="editingUser"
      :libraries="libraries"
      :default-library-ids="defaultLibraryIdsArray"
      @close="drawerOpen = false"
      @saved="onSaved"
    />
    <ResetLinkModal v-if="resetUrl" :reset-url="resetUrl" @close="resetUrl = null" />

    <div
      v-if="deleteConfirmUser"
      class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
      @click.self="deleteConfirmUser = null"
    >
      <button class="absolute inset-0 bg-black/45" @click="deleteConfirmUser = null" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">{{ t('adminFeature.usersPage.deleteDialogTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('adminFeature.usersPage.deleteDialogBody', { username: deleteConfirmUser.username }) }}</p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="deleteConfirmUser = null"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
            :disabled="deleting"
            @click="confirmDeleteUser"
          >
            {{ deleting ? t('adminFeature.usersPage.deleting') : t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </template>

  <!-- Magic Links tab content -->
  <MagicLinksSettings v-else ref="magicLinksRef" :with-header="false" />
</template>
