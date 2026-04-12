<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { UserPlus, Pencil, KeyRound, Trash2, ShieldCheck, MoreVertical } from 'lucide-vue-next'
import { api } from '@/lib/api'
import type { AuthUser } from '@projectx/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import UserFormDrawer from './UserFormDrawer.vue'
import ResetLinkModal from './ResetLinkModal.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

interface Library {
  id: number
  name: string
}

interface UserRow extends AuthUser {
  id: number
}

const { isSuperuser } = usePermissions()

const users = ref<UserRow[]>([])
const libraries = ref<Library[]>([])
const total = ref(0)
const page = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)

const drawerOpen = ref(false)
const editingUser = ref<Partial<AuthUser> | null>(null)
const resetUrl = ref<string | null>(null)
const deleteConfirmUser = ref<UserRow | null>(null)
const deleting = ref(false)

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const [usersRes, libsRes] = await Promise.all([api(`/api/v1/users?page=${page.value}&pageSize=50`), api('/api/v1/libraries')])
    if (!usersRes.ok || !libsRes.ok) throw new Error('Failed to load data')
    const ud = await usersRes.json()
    users.value = ud.users ?? ud.items ?? ud
    total.value = ud.total ?? users.value.length
    const libData = await libsRes.json()
    libraries.value = libData.libraries ?? libData.items ?? libData
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load'
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
      error.value = data.message ?? 'Failed to delete user'
      return
    }
    deleteConfirmUser.value = null
    loadData()
  } catch {
    error.value = 'Failed to delete user'
  } finally {
    deleting.value = false
  }
}

function onSaved(newResetUrl?: string) {
  drawerOpen.value = false
  if (newResetUrl) resetUrl.value = newResetUrl
  loadData()
}
</script>

<template>
  <SettingsPageHeader class="hidden md:flex" title="Users" subtitle="Manage user accounts and permission assignments.">
    <button class="settings-btn-primary" @click="openCreate">
      <UserPlus :size="14" />
      Create user
    </button>
  </SettingsPageHeader>
  <div class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">Users</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      Manage user accounts and permission assignments.
    </p>
  </div>
  <div class="md:hidden sticky top-[5.25rem] z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2 mt-4 mb-3">
    <button class="settings-btn-primary w-full min-h-10 justify-center" @click="openCreate">
      <UserPlus :size="14" />
      Create user
    </button>
  </div>

  <div v-if="error" class="mb-4 text-sm text-destructive">{{ error }}</div>
  <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>

  <div v-else class="space-y-3">
    <div class="hidden md:block rounded-lg border border-border overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-muted/50">
          <tr>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">Username</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Email</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">Access</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
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
                  Admin
                </span>
                <span v-else class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {{ user.permissions?.length ?? 0 }} permissions
                </span>
              </div>
            </td>
            <td class="px-4 py-3">
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                :class="user.active ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-destructive/15 text-destructive'"
              >
                {{ user.active ? 'Active' : 'Inactive' }}
              </span>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-2 justify-end">
                <template v-if="isSuperuser || !user.isSuperuser">
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <button
                        @click="openEdit(user)"
                        class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        <Pencil :size="14" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Edit</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <button
                        @click="handleResetPassword(user.id)"
                        :disabled="user.provisioningMethod === 'oidc'"
                        class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        :class="
                          user.provisioningMethod === 'oidc' ? 'cursor-not-allowed opacity-50 hover:text-muted-foreground hover:bg-transparent' : ''
                        "
                      >
                        <KeyRound :size="14" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {{ user.provisioningMethod === 'oidc' ? 'OIDC users reset passwords in their identity provider' : 'Reset password' }}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <button
                        @click="requestDeleteUser(user)"
                        class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 :size="14" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Delete</TooltipContent>
                  </Tooltip>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="md:hidden space-y-3">
      <div v-for="user in users" :key="user.id" class="rounded-lg border border-border bg-card px-4 py-3.5">
        <div class="flex items-start justify-between gap-3">
          <p class="text-sm font-medium text-foreground leading-5">{{ user.name }}</p>
          <span
            class="shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            :class="user.active ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-destructive/15 text-destructive'"
          >
            {{ user.active ? 'Active' : 'Inactive' }}
          </span>
        </div>
        <div class="mt-2 flex items-center justify-between gap-3">
          <p class="text-xs font-mono text-muted-foreground truncate">@{{ user.username }}</p>
          <span
            v-if="user.isSuperuser"
            class="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
          >
            <ShieldCheck :size="11" />
            Admin
          </span>
          <span v-else class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            {{ user.permissions?.length ?? 0 }} permissions
          </span>
        </div>
        <div v-if="isSuperuser || !user.isSuperuser" class="mt-3 flex items-center gap-2">
          <button class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors" @click="openEdit(user)">
            Edit
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <button class="rounded-md border border-border p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <MoreVertical :size="16" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-56">
              <DropdownMenuItem :disabled="user.provisioningMethod === 'oidc'" @click="handleResetPassword(user.id)">Reset password</DropdownMenuItem>
              <DropdownMenuItem class="text-destructive focus:text-destructive" @click="requestDeleteUser(user)">Delete user</DropdownMenuItem>
              <DropdownMenuSeparator v-if="user.provisioningMethod === 'oidc'" />
              <p v-if="user.provisioningMethod === 'oidc'" class="px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
                OIDC users reset passwords in their identity provider.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  </div>

  <UserFormDrawer v-if="drawerOpen" :user="editingUser" :libraries="libraries" @close="drawerOpen = false" @saved="onSaved" />

  <ResetLinkModal v-if="resetUrl" :reset-url="resetUrl" @close="resetUrl = null" />

  <div
    v-if="deleteConfirmUser"
    class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
    @click.self="deleteConfirmUser = null"
  >
    <button class="absolute inset-0 bg-black/45" @click="deleteConfirmUser = null" />
    <div class="relative w-full rounded-t-xl border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-xl md:p-5">
      <p class="text-base font-semibold text-foreground">Delete user?</p>
      <p class="mt-1 text-sm text-muted-foreground">Delete user "{{ deleteConfirmUser.username }}". This action cannot be undone.</p>
      <div class="mt-4 flex items-center justify-end gap-2">
        <button
          class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
          @click="deleteConfirmUser = null"
        >
          Cancel
        </button>
        <button
          class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
          :disabled="deleting"
          @click="confirmDeleteUser"
        >
          {{ deleting ? 'Deleting...' : 'Delete' }}
        </button>
      </div>
    </div>
  </div>
</template>
