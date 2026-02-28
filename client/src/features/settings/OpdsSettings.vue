<script setup lang="ts">
import { onMounted, ref, computed } from 'vue'
import { Plus, Trash2, Copy, Check, Rss } from 'lucide-vue-next'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import type { OpdsUser, OpdsSortOrder } from '@projectx/types'

const { hasPermission } = usePermissions()
const canManageSettings = computed(() => hasPermission('manage_app_settings'))

const opdsEnabled = ref(true)
const opdsUsers = ref<OpdsUser[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const copied = ref(false)

const showCreateForm = ref(false)
const createUsername = ref('')
const createPassword = ref('')
const createSortOrder = ref<OpdsSortOrder>('recent')
const creating = ref(false)
const createError = ref<string | null>(null)

const opdsUrl = computed(() => `${window.location.origin}/api/v1/opds`)

const sortOrderOptions: { label: string; value: OpdsSortOrder }[] = [
  { label: 'Recently Added', value: 'recent' },
  { label: 'Title (A-Z)', value: 'title_asc' },
  { label: 'Title (Z-A)', value: 'title_desc' },
  { label: 'Author (A-Z)', value: 'author_asc' },
  { label: 'Author (Z-A)', value: 'author_desc' },
  { label: 'Series (A-Z)', value: 'series_asc' },
  { label: 'Series (Z-A)', value: 'series_desc' },
]

function sortOrderLabel(value: OpdsSortOrder): string {
  return sortOrderOptions.find((o) => o.value === value)?.label ?? value
}

onMounted(async () => {
  try {
    const [settingsRes, usersRes] = await Promise.all([api('/api/v1/app-settings'), api('/api/v1/opds-users')])
    if (settingsRes.ok) {
      const settings = await settingsRes.json()
      const row = settings.find((s: { key: string; value: string }) => s.key === 'opds_enabled')
      opdsEnabled.value = row?.value === 'true'
    }
    if (usersRes.ok) {
      opdsUsers.value = await usersRes.json()
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load'
  } finally {
    loading.value = false
  }
})

async function toggleOpds() {
  const newVal = !opdsEnabled.value
  const res = await api('/api/v1/app-settings/opds_enabled', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: String(newVal) }),
  })
  if (res.ok) opdsEnabled.value = newVal
}

async function copyUrl() {
  await navigator.clipboard.writeText(opdsUrl.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

async function createUser() {
  createError.value = null
  creating.value = true
  try {
    const res = await api('/api/v1/opds-users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: createUsername.value, password: createPassword.value, sortOrder: createSortOrder.value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      createError.value = data.message ?? 'Failed to create OPDS user'
      return
    }
    const user = await res.json()
    opdsUsers.value.push(user)
    showCreateForm.value = false
    createUsername.value = ''
    createPassword.value = ''
    createSortOrder.value = 'recent'
  } finally {
    creating.value = false
  }
}

async function updateSortOrder(user: OpdsUser, sortOrder: OpdsSortOrder) {
  const res = await api(`/api/v1/opds-users/${user.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sortOrder }),
  })
  if (res.ok) {
    const updated = await res.json()
    const idx = opdsUsers.value.findIndex((u) => u.id === user.id)
    if (idx >= 0) opdsUsers.value[idx] = updated
  }
}

function cancelCreate() {
  showCreateForm.value = false
  createError.value = null
}

async function deleteUser(user: OpdsUser) {
  if (!confirm(`Delete OPDS user "${user.username}"? This cannot be undone.`)) return
  const res = await api(`/api/v1/opds-users/${user.id}`, { method: 'DELETE' })
  if (res.ok) {
    opdsUsers.value = opdsUsers.value.filter((u) => u.id !== user.id)
  }
}
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl mx-auto">
    <div class="mb-8">
      <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">OPDS</h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Connect OPDS-compatible reading apps like KOReader, Moon+ Reader, or Thorium Reader to your library.
      </p>
    </div>

    <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>
    <div v-else-if="error" class="text-sm text-destructive">{{ error }}</div>
    <template v-else>
      <!-- Server Toggle -->
      <div v-if="canManageSettings" class="mb-6">
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Server</p>
        <div class="border border-border rounded-lg overflow-hidden">
          <div class="flex items-center justify-between px-5 py-4 bg-card">
            <div>
              <p class="text-sm font-medium text-foreground">OPDS Catalog Server</p>
              <p class="text-xs text-muted-foreground mt-0.5">Allow OPDS clients to browse and download books</p>
            </div>
            <button
              class="w-11 h-6 rounded-full transition-colors relative shrink-0"
              :class="opdsEnabled ? 'bg-primary' : 'bg-muted'"
              @click="toggleOpds()"
            >
              <div
                class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
                :class="opdsEnabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>
      </div>

      <!-- Endpoint URL -->
      <div v-if="opdsEnabled" class="mb-6">
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Endpoint</p>
        <div class="border border-border rounded-lg overflow-hidden">
          <div class="flex items-center gap-2 px-5 py-4 bg-card">
            <Rss :size="14" class="text-muted-foreground shrink-0" />
            <input :value="opdsUrl" readonly class="flex-1 text-sm bg-transparent text-foreground outline-none select-all min-w-0" />
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors shrink-0"
              @click="copyUrl()"
            >
              <component :is="copied ? Check : Copy" :size="12" />
              {{ copied ? 'Copied' : 'Copy' }}
            </button>
          </div>
        </div>
      </div>

      <!-- OPDS Users -->
      <div v-if="opdsEnabled" class="mb-6">
        <div class="flex items-center justify-between mb-3">
          <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">OPDS Accounts</p>
          <button
            v-if="!showCreateForm"
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            @click="showCreateForm = true"
          >
            <Plus :size="12" />
            Add
          </button>
        </div>

        <!-- Create form -->
        <div v-if="showCreateForm" class="border border-border rounded-lg p-5 bg-card mb-4 space-y-4">
          <div>
            <label class="block text-xs font-medium text-muted-foreground mb-1.5">Username</label>
            <input
              v-model="createUsername"
              type="text"
              placeholder="e.g. koreader"
              class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-muted-foreground mb-1.5">Password</label>
            <input
              v-model="createPassword"
              type="password"
              placeholder="Min 8 characters"
              class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label class="block text-xs font-medium text-muted-foreground mb-1.5">Default Sort</label>
            <select
              v-model="createSortOrder"
              class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option v-for="opt in sortOrderOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>
          <div v-if="createError" class="text-xs text-destructive">{{ createError }}</div>
          <div class="flex items-center gap-2 pt-1">
            <button
              class="px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              :disabled="creating || !createUsername || !createPassword"
              @click="createUser()"
            >
              {{ creating ? 'Creating...' : 'Create' }}
            </button>
            <button
              class="px-4 py-2 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
              @click="cancelCreate()"
            >
              Cancel
            </button>
          </div>
        </div>

        <!-- Users list -->
        <div v-if="opdsUsers.length === 0 && !showCreateForm" class="border border-border rounded-lg px-5 py-8 bg-card text-center">
          <p class="text-sm text-muted-foreground">No OPDS accounts yet. Create one to start using OPDS clients.</p>
        </div>
        <div v-else-if="opdsUsers.length > 0" class="border border-border rounded-lg overflow-hidden divide-y divide-border">
          <div v-for="user in opdsUsers" :key="user.id" class="flex items-center gap-3 px-5 py-3.5 bg-card">
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium text-foreground truncate">{{ user.username }}</p>
              <p class="text-xs text-muted-foreground mt-0.5">{{ sortOrderLabel(user.sortOrder) }}</p>
            </div>
            <select
              :value="user.sortOrder"
              class="text-xs border border-border rounded-md px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              @change="updateSortOrder(user, ($event.target as HTMLSelectElement).value as OpdsSortOrder)"
            >
              <option v-for="opt in sortOrderOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
            <button
              class="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              @click="deleteUser(user)"
            >
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
