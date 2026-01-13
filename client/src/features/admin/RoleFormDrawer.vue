<script setup lang="ts">
import { ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { api } from '@/lib/api'
import type { Role, Permission } from '@projectx/types'

const props = defineProps<{
  role: Partial<Role> | null
  permissions: Permission[]
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const name = ref('')
const description = ref('')
const selectedPermissionIds = ref<number[]>([])
const error = ref<string | null>(null)
const loading = ref(false)

watch(
  () => props.role,
  (r) => {
    name.value = r?.name ?? ''
    description.value = r?.description ?? ''
    selectedPermissionIds.value = r?.permissions?.map((p) => p.id) ?? []
    error.value = null
  },
  { immediate: true },
)

function togglePermission(permId: number) {
  const idx = selectedPermissionIds.value.indexOf(permId)
  if (idx === -1) {
    selectedPermissionIds.value.push(permId)
  } else {
    selectedPermissionIds.value.splice(idx, 1)
  }
}

async function handleSubmit() {
  error.value = null
  loading.value = true
  try {
    const isEdit = !!props.role?.id

    if (isEdit) {
      const res = await api(`/api/roles/${props.role!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value, description: description.value || undefined }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        error.value = err.message ?? 'Failed to update role'
        return
      }

      // Sync permissions
      const currentIds = props.role!.permissions?.map((p) => p.id) ?? []
      const toAssign = selectedPermissionIds.value.filter((id) => !currentIds.includes(id))
      const toRevoke = currentIds.filter((id) => !selectedPermissionIds.value.includes(id))

      await Promise.all([
        ...toAssign.map((permissionId) =>
          api(`/api/roles/${props.role!.id}/permissions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ permissionId }),
          }),
        ),
        ...toRevoke.map((permId) => api(`/api/roles/${props.role!.id}/permissions/${permId}`, { method: 'DELETE' })),
      ])
    } else {
      const res = await api('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.value,
          description: description.value || undefined,
          permissionIds: selectedPermissionIds.value,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        error.value = err.message ?? 'Failed to create role'
        return
      }
    }

    emit('saved')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[60] flex">
    <div class="fixed inset-0 bg-black/40" @click="emit('close')" />
    <div class="relative ml-auto flex h-full w-full max-w-md flex-col bg-card shadow-xl">
      <div class="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 class="text-base font-semibold text-foreground">{{ role?.id ? 'Edit Role' : 'Create Role' }}</h2>
        <button @click="emit('close')" class="text-muted-foreground hover:text-foreground">
          <X :size="16" />
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="flex-1 overflow-y-auto space-y-4 px-6 py-6">
        <div class="space-y-1.5">
          <label class="text-sm font-medium text-foreground">Role name</label>
          <input
            v-model="name"
            type="text"
            required
            :disabled="role?.isSystem"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          />
          <p v-if="role?.isSystem" class="text-xs text-muted-foreground">System role names cannot be changed.</p>
        </div>

        <div class="space-y-1.5">
          <label class="text-sm font-medium text-foreground">Description <span class="text-muted-foreground">(optional)</span></label>
          <input
            v-model="description"
            type="text"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div v-if="role?.isSuperuser" class="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          This is a superuser role. It implicitly has all permissions, including any added in the future. Individual permission assignments are not
          applicable.
        </div>

        <div v-else class="space-y-2">
          <p class="text-sm font-medium text-foreground">Permissions</p>
          <div class="space-y-1.5">
            <label v-for="perm in permissions" :key="perm.id" class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                :checked="selectedPermissionIds.includes(perm.id)"
                @change="togglePermission(perm.id)"
                class="h-4 w-4 rounded border-input"
              />
              <span class="text-sm text-foreground">{{ perm.name }}</span>
              <span v-if="perm.description" class="text-xs text-muted-foreground">{{ perm.description }}</span>
            </label>
          </div>
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>
      </form>

      <div class="border-t border-border px-6 py-4 flex gap-3 justify-end">
        <button
          @click="emit('close')"
          class="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          v-if="!role?.isSuperuser"
          @click="handleSubmit"
          :disabled="loading"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {{ loading ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>
  </div>
</template>
