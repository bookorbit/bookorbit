<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { UserPlus, Trash2 } from 'lucide-vue-next'
import { api } from '@/lib/api'
import type { LibraryAccessEntry } from '@projectx/types'

const props = defineProps<{
  libraryId: number | null
}>()

interface UserOption {
  id: number
  username: string
  name: string
}

const accessList = ref<LibraryAccessEntry[]>([])
const availableUsers = ref<UserOption[]>([])
const grantUserId = ref<number | null>(null)
const grantLevel = ref<'viewer' | 'editor' | 'owner'>('viewer')
const loading = ref(false)

async function loadAccess() {
  if (!props.libraryId) return
  loading.value = true
  try {
    const [accessRes, usersRes] = await Promise.all([api(`/api/v1/libraries/${props.libraryId}/access`), api('/api/v1/users')])
    if (accessRes.ok) accessList.value = await accessRes.json()
    if (usersRes.ok) {
      const all: UserOption[] = await usersRes.json()
      const grantedIds = new Set(accessList.value.map((a) => a.userId))
      availableUsers.value = all.filter((u) => !grantedIds.has(u.id))
    }
  } finally {
    loading.value = false
  }
}

async function grant() {
  if (!props.libraryId || !grantUserId.value) return
  await api(`/api/v1/libraries/${props.libraryId}/access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: grantUserId.value, accessLevel: grantLevel.value }),
  })
  grantUserId.value = null
  await loadAccess()
}

async function changeLevel(userId: number, accessLevel: 'viewer' | 'editor' | 'owner') {
  if (!props.libraryId) return
  await api(`/api/v1/libraries/${props.libraryId}/access/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessLevel }),
  })
  await loadAccess()
}

async function revoke(userId: number) {
  if (!props.libraryId) return
  await api(`/api/v1/libraries/${props.libraryId}/access/${userId}`, { method: 'DELETE' })
  await loadAccess()
}

onMounted(loadAccess)
</script>

<template>
  <div class="px-6 py-6 space-y-5">
    <div v-if="!libraryId" class="rounded-lg border border-dashed border-border px-5 py-8 text-center">
      <UserPlus :size="22" class="text-muted-foreground/30 mx-auto mb-2" />
      <p class="text-sm text-muted-foreground">Access can be configured after the library is created.</p>
    </div>

    <template v-else>
      <div>
        <h3 class="text-sm font-semibold text-foreground mb-1">Access control</h3>
        <p class="text-xs text-muted-foreground mb-4">Superusers always have access. Non-superusers must be granted access explicitly.</p>

        <!-- Grant access row -->
        <div class="flex gap-2 mb-4">
          <select
            v-model="grantUserId"
            class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option :value="null" disabled>Select a user…</option>
            <option v-for="u in availableUsers" :key="u.id" :value="u.id">{{ u.name }} ({{ u.username }})</option>
          </select>
          <select
            v-model="grantLevel"
            class="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
          </select>
          <button
            class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
            :disabled="!grantUserId"
            @click="grant"
          >
            <UserPlus :size="14" />
            Grant
          </button>
        </div>

        <!-- Access list -->
        <div class="rounded-lg border border-border overflow-hidden">
          <table class="w-full text-sm">
            <thead class="bg-muted/50">
              <tr>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground text-xs">User</th>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground text-xs">Access level</th>
                <th class="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-for="entry in accessList" :key="entry.userId" class="hover:bg-muted/20 transition-colors">
                <td class="px-4 py-3">
                  <p class="font-medium text-foreground">{{ entry.name }}</p>
                  <p class="text-xs text-muted-foreground">{{ entry.username }}</p>
                </td>
                <td class="px-4 py-3">
                  <select
                    :value="entry.accessLevel"
                    class="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    @change="changeLevel(entry.userId, ($event.target as HTMLSelectElement).value as 'viewer' | 'editor' | 'owner')"
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="owner">Owner</option>
                  </select>
                </td>
                <td class="px-4 py-3">
                  <button
                    class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    @click="revoke(entry.userId)"
                  >
                    <Trash2 :size="13" />
                  </button>
                </td>
              </tr>
              <tr v-if="accessList.length === 0">
                <td colspan="3" class="px-4 py-6 text-center text-xs text-muted-foreground">No users have been granted access yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
