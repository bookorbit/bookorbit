<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { api } from '@/lib/api'
import type { Permission } from '@projectx/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const permissions = ref<Permission[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const newName = ref('')
const newDescription = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)

async function loadData() {
  loading.value = true
  error.value = null
  try {
    const res = await api('/api/v1/permissions')
    if (!res.ok) throw new Error('Failed to load')
    permissions.value = await res.json()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load'
  } finally {
    loading.value = false
  }
}

onMounted(loadData)

async function createPermission() {
  createError.value = null
  creating.value = true
  try {
    const res = await api('/api/v1/permissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.value, description: newDescription.value || undefined }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      createError.value = err.message ?? 'Failed to create permission'
      return
    }
    newName.value = ''
    newDescription.value = ''
    loadData()
  } finally {
    creating.value = false
  }
}

async function deletePermission(perm: Permission) {
  if (!confirm(`Delete permission "${perm.name}"?`)) return
  const res = await api(`/api/v1/permissions/${perm.id}`, { method: 'DELETE' })
  if (res.ok) loadData()
}
</script>

<template>
    <div class="mb-8">
      <h2 class="settings-title">Permissions</h2>
      <p class="settings-subtitle">Create granular permissions to assign to roles.</p>
    </div>

    <!-- Create form -->
    <div class="mb-6 rounded-lg border border-border p-4">
      <h2 class="settings-label mb-3">Create permission</h2>
      <form @submit.prevent="createPermission" class="flex gap-2 flex-wrap">
        <input
          v-model="newName"
          type="text"
          placeholder="permission_name"
          required
          class="flex-1 min-w-[160px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <input
          v-model="newDescription"
          type="text"
          placeholder="Description (optional)"
          class="flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <button
          type="submit"
          :disabled="creating"
          class="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Plus :size="14" />
          Add
        </button>
      </form>
      <p v-if="createError" class="mt-2 text-sm text-destructive">{{ createError }}</p>
    </div>

    <div v-if="error" class="mb-4 text-sm text-destructive">{{ error }}</div>
    <div v-if="loading" class="text-sm text-muted-foreground">Loading…</div>

    <div v-else class="rounded-lg border border-border overflow-hidden">
      <table class="w-full text-sm">
        <thead class="bg-muted/50">
          <tr>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
            <th class="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Description</th>
            <th class="px-4 py-3" />
          </tr>
        </thead>
        <tbody class="divide-y divide-border">
          <tr v-for="perm in permissions" :key="perm.id" class="hover:bg-muted/30 transition-colors">
            <td class="px-4 py-3 font-mono text-xs text-foreground">{{ perm.name }}</td>
            <td class="px-4 py-3 text-muted-foreground hidden sm:table-cell">{{ perm.description ?? '-' }}</td>
            <td class="px-4 py-3">
              <div class="flex justify-end">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <button
                      v-if="!perm.isSystem"
                      @click="deletePermission(perm)"
                      class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                    >
                      <Trash2 :size="14" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
</template>
