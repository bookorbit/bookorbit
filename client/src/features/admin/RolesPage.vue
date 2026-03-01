<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Pencil, Trash2 } from 'lucide-vue-next'
import { api } from '@/lib/api'
import type { Role, Permission } from '@projectx/types'
import RoleFormDrawer from './RoleFormDrawer.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const roles = ref<Role[]>([])
const permissions = ref<Permission[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const drawerOpen = ref(false)
const editingRole = ref<Partial<Role> | null>(null)

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const [rolesRes, permsRes] = await Promise.all([api('/api/v1/roles'), api('/api/v1/permissions')])
    if (!rolesRes.ok || !permsRes.ok) throw new Error('Failed to load data')
    roles.value = await rolesRes.json()
    permissions.value = await permsRes.json()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load'
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

function openCreate() {
  editingRole.value = null
  drawerOpen.value = true
}

function openEdit(role: Role) {
  editingRole.value = role
  drawerOpen.value = true
}

async function deleteRole(role: Role) {
  if (!confirm(`Delete role "${role.name}"?`)) return
  const res = await api(`/api/v1/roles/${role.id}`, { method: 'DELETE' })
  if (res.ok) loadData()
}

function onSaved() {
  drawerOpen.value = false
  loadData()
}
</script>

<template>
    <div class="flex items-start justify-between mb-8">
      <div>
        <h2 class="settings-title">Roles</h2>
        <p class="settings-subtitle">Define roles and their permission sets.</p>
      </div>
      <button
        @click="openCreate"
        class="flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0 ml-4"
      >
        <Plus :size="14" />
        Create role
      </button>
    </div>

    <div v-if="error" class="mb-4 text-sm text-destructive">{{ error }}</div>
    <div v-if="loading" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else class="rounded-lg border border-border overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-muted/50">
          <tr>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">Permissions</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="role in roles" :key="role.id" class="hover:bg-muted/30 transition-colors">
            <td class="px-4 py-3 text-foreground font-medium">{{ role.name }}</td>
            <td class="px-4 py-3">
              <span v-if="role.isSuperuser" class="inline-flex items-center rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
                >Superuser</span
              >
              <span v-else class="text-muted-foreground text-xs">Standard</span>
            </td>
            <td class="px-4 py-3">
              <span v-if="role.isSuperuser" class="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                >All</span
              >
              <span v-else class="text-muted-foreground text-sm">{{ role.permissions.length }}</span>
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-2 justify-end">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      @click="openEdit(role)"
                      :disabled="role.isSuperuser"
                      class="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Pencil :size="14" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{{ role.isSuperuser ? 'Superuser roles cannot be edited' : 'Edit' }}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      @click="deleteRole(role)"
                      :disabled="role.isSystem"
                      class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <Trash2 :size="14" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{{ role.isSystem ? 'System roles cannot be deleted' : 'Delete' }}</TooltipContent>
                </Tooltip>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

  <RoleFormDrawer v-if="drawerOpen" :role="editingRole" :permissions="permissions" @close="drawerOpen = false" @saved="onSaved" />
</template>
