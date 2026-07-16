<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { UserPlus, Trash2 } from '@lucide/vue'
import { api } from '@/lib/api'
import type { LibraryAccessEntry } from '@bookorbit/types'

const { t } = useI18n()

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
const actionLoading = ref(false)
const error = ref<string | null>(null)

async function loadAccess() {
  if (!props.libraryId) return
  loading.value = true
  error.value = null
  try {
    const [accessRes, usersRes] = await Promise.all([api(`/api/v1/libraries/${props.libraryId}/access`), api('/api/v1/users/assignable')])
    if (!accessRes.ok || !usersRes.ok) {
      error.value = 'Could not load library access settings.'
      return
    }
    accessList.value = await accessRes.json()
    if (usersRes.ok) {
      const all: UserOption[] = await usersRes.json()
      const grantedIds = new Set(accessList.value.map((a) => a.userId))
      availableUsers.value = all.filter((u) => !grantedIds.has(u.id))
    }
  } catch {
    error.value = 'Could not connect to the server.'
  } finally {
    loading.value = false
  }
}

async function grant() {
  if (!props.libraryId || !grantUserId.value) return
  error.value = null
  actionLoading.value = true
  try {
    const res = await api(`/api/v1/libraries/${props.libraryId}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: grantUserId.value, accessLevel: grantLevel.value }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      error.value = body?.message ?? 'Failed to grant access'
      return
    }
    grantUserId.value = null
    await loadAccess()
  } catch {
    error.value = 'Could not connect to the server.'
  } finally {
    actionLoading.value = false
  }
}

async function changeLevel(userId: number, accessLevel: 'viewer' | 'editor' | 'owner') {
  if (!props.libraryId) return
  error.value = null
  actionLoading.value = true
  try {
    const res = await api(`/api/v1/libraries/${props.libraryId}/access/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessLevel }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      error.value = body?.message ?? 'Failed to update access level'
      return
    }
    await loadAccess()
  } catch {
    error.value = 'Could not connect to the server.'
  } finally {
    actionLoading.value = false
  }
}

async function revoke(userId: number) {
  if (!props.libraryId) return
  const entry = accessList.value.find((item) => item.userId === userId)
  if (!window.confirm(`Revoke access for ${entry?.name || entry?.username || 'this user'}?`)) return
  error.value = null
  actionLoading.value = true
  try {
    const res = await api(`/api/v1/libraries/${props.libraryId}/access/${userId}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      error.value = body?.message ?? 'Failed to revoke access'
      return
    }
    await loadAccess()
  } catch {
    error.value = 'Could not connect to the server.'
  } finally {
    actionLoading.value = false
  }
}

onMounted(loadAccess)
</script>

<template>
  <div class="px-6 py-6 space-y-6">
    <div v-if="!libraryId" class="rounded-lg border border-dashed border-border px-5 py-8 text-center">
      <UserPlus :size="22" class="text-muted-foreground/60 mx-auto mb-2" />
      <p class="text-sm text-muted-foreground">{{ t('library.creator.access.notYetCreated') }}</p>
    </div>

    <template v-else>
      <div>
        <p class="text-[11px] font-semibold uppercase tracking-widest text-foreground/80 mb-1">{{ t('library.creator.access.title') }}</p>
        <p class="text-xs text-muted-foreground mb-3">{{ t('library.creator.access.description') }}</p>

        <p v-if="error" class="text-xs text-destructive mb-3" role="alert">{{ error }}</p>

        <!-- Grant access row -->
        <div class="mb-4 grid grid-cols-2 gap-2 sm:flex">
          <select
            v-model="grantUserId"
            :aria-label="t('library.creator.access.userSelectAria')"
            class="col-span-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:flex-1"
            :disabled="loading || actionLoading"
          >
            <option :value="null" disabled>{{ t('library.creator.access.selectUser') }}</option>
            <option v-for="u in availableUsers" :key="u.id" :value="u.id">{{ u.name }} ({{ u.username }})</option>
          </select>
          <select
            v-model="grantLevel"
            :aria-label="t('library.creator.access.levelSelectAria')"
            class="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            :disabled="loading || actionLoading"
          >
            <option value="viewer">{{ t('library.creator.access.levels.viewer') }}</option>
            <option value="editor">{{ t('library.creator.access.levels.editor') }}</option>
            <option value="owner">{{ t('library.creator.access.levels.owner') }}</option>
          </select>
          <button
            type="button"
            class="flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0"
            :disabled="!grantUserId || loading || actionLoading"
            @click="grant"
          >
            <UserPlus :size="14" />
            {{ t('library.creator.access.grant') }}
          </button>
        </div>

        <!-- Access list -->
        <div class="overflow-x-auto rounded-lg border border-border">
          <table class="w-full min-w-md text-sm">
            <thead class="bg-muted/50">
              <tr>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground text-xs">{{ t('library.creator.access.columns.user') }}</th>
                <th class="px-4 py-3 text-left font-medium text-muted-foreground text-xs">{{ t('library.creator.access.columns.accessLevel') }}</th>
                <th class="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody class="divide-y divide-border">
              <tr v-if="loading">
                <td colspan="3" class="px-4 py-6 text-center text-xs text-muted-foreground">
                  {{ t('library.creator.access.loading') }}
                </td>
              </tr>
              <tr v-for="entry in accessList" :key="entry.userId" class="hover:bg-muted/20 transition-colors">
                <td class="px-4 py-3">
                  <p class="font-medium text-foreground">{{ entry.name }}</p>
                  <p class="text-xs text-muted-foreground">{{ entry.username }}</p>
                </td>
                <td class="px-4 py-3">
                  <select
                    :value="entry.accessLevel"
                    :aria-label="`Access level for ${entry.name}`"
                    :disabled="actionLoading"
                    class="rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    @change="changeLevel(entry.userId, ($event.target as HTMLSelectElement).value as 'viewer' | 'editor' | 'owner')"
                  >
                    <option value="viewer">{{ t('library.creator.access.levels.viewer') }}</option>
                    <option value="editor">{{ t('library.creator.access.levels.editor') }}</option>
                    <option value="owner">{{ t('library.creator.access.levels.owner') }}</option>
                  </select>
                </td>
                <td class="px-4 py-3">
                  <button
                    type="button"
                    class="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    :aria-label="`Revoke access for ${entry.name}`"
                    :disabled="actionLoading"
                    @click="revoke(entry.userId)"
                  >
                    <Trash2 :size="13" />
                  </button>
                </td>
              </tr>
              <tr v-if="!loading && accessList.length === 0">
                <td colspan="3" class="px-4 py-6 text-center text-xs text-muted-foreground">{{ t('library.creator.access.empty') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>
