<script setup lang="ts">
import { ref, watch } from 'vue'
import { X } from 'lucide-vue-next'
import { api } from '@/lib/api'
import type { AuthUser, Role } from '@projectx/types'

const props = defineProps<{
  user: Partial<AuthUser> | null
  roles: Role[]
}>()

const emit = defineEmits<{
  close: []
  saved: [resetUrl?: string]
}>()

const name = ref('')
const username = ref('')
const email = ref('')
const active = ref(true)
const selectedRoleIds = ref<number[]>([])
const error = ref<string | null>(null)
const loading = ref(false)

watch(
  () => props.user,
  (u) => {
    name.value = u?.name ?? ''
    username.value = u?.username ?? ''
    email.value = u?.email ?? ''
    active.value = u?.active ?? true
    selectedRoleIds.value = u?.roles?.map((r) => r.id) ?? []
    error.value = null
  },
  { immediate: true },
)

function toggleRole(roleId: number) {
  const idx = selectedRoleIds.value.indexOf(roleId)
  if (idx === -1) {
    selectedRoleIds.value.push(roleId)
  } else {
    selectedRoleIds.value.splice(idx, 1)
  }
}

async function handleSubmit() {
  error.value = null
  loading.value = true
  try {
    const isEdit = !!props.user?.id

    if (isEdit) {
      const res = await api(`/api/v1/users/${props.user!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value, email: email.value || undefined, active: active.value }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        error.value = err.message ?? 'Failed to update user'
        return
      }

      // Sync roles: assign missing, revoke removed
      const currentIds = props.user!.roles?.map((r) => r.id) ?? []
      const toAssign = selectedRoleIds.value.filter((id) => !currentIds.includes(id))
      const toRevoke = currentIds.filter((id) => !selectedRoleIds.value.includes(id))

      await Promise.all([
        ...toAssign.map((roleId) =>
          api(`/api/v1/users/${props.user!.id}/roles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roleId }),
          }),
        ),
        ...toRevoke.map((roleId) => api(`/api/v1/users/${props.user!.id}/roles/${roleId}`, { method: 'DELETE' })),
      ])
    } else {
      const res = await api('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.value,
          username: username.value,
          email: email.value || undefined,
          roleIds: selectedRoleIds.value,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        error.value = err.message ?? 'Failed to create user'
        return
      }
      const data = await res.json()
      emit('saved', data.resetUrl)
      return
    }

    emit('saved')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[60] flex" @click.self="emit('close')">
    <div class="fixed inset-0 bg-black/40" @click="emit('close')" />
    <div class="relative ml-auto flex h-full w-full max-w-md flex-col bg-card shadow-xl">
      <div class="flex items-center justify-between border-b border-border px-6 py-4">
        <h2 class="text-base font-semibold text-foreground">{{ user?.id ? 'Edit User' : 'Create User' }}</h2>
        <button @click="emit('close')" class="text-muted-foreground hover:text-foreground">
          <X :size="16" />
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="flex-1 overflow-y-auto space-y-4 px-6 py-6">
        <div v-if="!user?.id" class="space-y-1.5">
          <label class="text-sm font-medium text-foreground">Username</label>
          <input
            v-model="username"
            type="text"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-sm font-medium text-foreground">Full name</label>
          <input
            v-model="name"
            type="text"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div class="space-y-1.5">
          <label class="text-sm font-medium text-foreground">Email <span class="text-muted-foreground">(optional)</span></label>
          <input
            v-model="email"
            type="email"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div v-if="user?.id" class="flex items-center gap-3">
          <input id="active" v-model="active" type="checkbox" class="h-4 w-4 rounded border-input" />
          <label for="active" class="text-sm font-medium text-foreground">Active</label>
        </div>

        <div class="space-y-2">
          <p class="text-sm font-medium text-foreground">Roles</p>
          <div class="space-y-1.5">
            <label v-for="role in roles" :key="role.id" class="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                :checked="selectedRoleIds.includes(role.id)"
                @change="toggleRole(role.id)"
                class="h-4 w-4 rounded border-input"
              />
              <span class="text-sm text-foreground">{{ role.name }}</span>
              <span v-if="role.isSuperuser" class="text-xs text-primary">(superuser)</span>
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
