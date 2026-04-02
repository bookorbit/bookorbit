<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { UserPlus, Pencil, KeyRound, Trash2, ShieldCheck } from 'lucide-vue-next'
import { api } from '@/lib/api'
import type { AuthUser } from '@projectx/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import UserFormDrawer from './UserFormDrawer.vue'
import ResetLinkModal from './ResetLinkModal.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import SettingsPageHeader from '@/features/settings/SettingsPageHeader.vue'

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

async function deleteUser(user: UserRow) {
  if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) return
  const res = await api(`/api/v1/users/${user.id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    error.value = data.message ?? 'Failed to delete user'
    return
  }
  loadData()
}

function onSaved(newResetUrl?: string) {
  drawerOpen.value = false
  if (newResetUrl) resetUrl.value = newResetUrl
  loadData()
}
</script>

<template>
  <SettingsPageHeader title="Users" subtitle="Manage user accounts and permission assignments.">
    <button class="settings-btn-primary" @click="openCreate">
      <UserPlus :size="14" />
      Create user
    </button>
  </SettingsPageHeader>

  <div v-if="error" class="mb-4 text-sm text-destructive">{{ error }}</div>
  <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>

  <div v-else class="rounded-lg border border-border overflow-hidden">
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
                      @click="deleteUser(user)"
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

  <UserFormDrawer v-if="drawerOpen" :user="editingUser" :libraries="libraries" @close="drawerOpen = false" @saved="onSaved" />

  <ResetLinkModal v-if="resetUrl" :reset-url="resetUrl" @close="resetUrl = null" />
</template>
