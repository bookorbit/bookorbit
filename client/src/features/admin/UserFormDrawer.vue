<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { ChevronDown, X } from 'lucide-vue-next'
import { api } from '@/lib/api'
import { Permission, PERMISSION_LABELS } from '@projectx/types'
import type { AuthUser } from '@projectx/types'
import { useMediaQuery } from '@vueuse/core'

interface Library {
  id: number
  name: string
}

const props = defineProps<{
  user: Partial<AuthUser> | null
  libraries: Library[]
}>()

const emit = defineEmits<{
  close: []
  saved: [resetUrl?: string]
}>()

const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  {
    label: 'Content',
    permissions: [Permission.LibraryDownload, Permission.LibraryUpload, Permission.LibraryEditMetadata, Permission.LibraryDeleteBooks],
  },
  {
    label: 'Devices & Access',
    permissions: [Permission.KoboSync, Permission.OpdsAccess, Permission.BookBucketAccess],
  },
  {
    label: 'Email',
    permissions: [Permission.EmailSend, Permission.ManageEmail],
  },
  {
    label: 'Administration',
    permissions: [Permission.ManageLibraries, Permission.ManageMetadataConfig, Permission.ManageAppSettings, Permission.ManageUsers],
  },
]

const name = ref('')
const username = ref('')
const email = ref('')
const active = ref(true)
const selectedPermissionNames = ref<Set<string>>(new Set())
const selectedLibraryIds = ref<Set<number>>(new Set())
const error = ref<string | null>(null)
const loading = ref(false)
const libraryAccessOpen = ref(true)
const permissionGroupOpen = ref<Record<string, boolean>>({})

const isEdit = computed(() => !!props.user?.id)
const isMobile = useMediaQuery('(max-width: 767px)')

const selectedCountByGroup = computed<Record<string, number>>(() =>
  Object.fromEntries(
    PERMISSION_GROUPS.map((group) => [group.label, group.permissions.filter((permName) => selectedPermissionNames.value.has(permName)).length]),
  ),
)

watch(
  () => props.user,
  async (u) => {
    name.value = u?.name ?? ''
    username.value = u?.username ?? ''
    email.value = u?.email ?? ''
    active.value = u?.active ?? true
    selectedPermissionNames.value = new Set(u?.permissions?.filter((p) => p !== '*') ?? [])
    selectedLibraryIds.value = new Set()
    error.value = null

    if (u?.id) {
      const res = await api(`/api/v1/users/${u.id}/libraries`)
      if (res.ok) {
        const ids: number[] = await res.json()
        selectedLibraryIds.value = new Set(ids)
      }
    }

    libraryAccessOpen.value = !isMobile.value
    permissionGroupOpen.value = Object.fromEntries(PERMISSION_GROUPS.map((group) => [group.label, !isMobile.value]))
  },
  { immediate: true },
)

watch(isMobile, (mobile) => {
  libraryAccessOpen.value = !mobile
  permissionGroupOpen.value = Object.fromEntries(PERMISSION_GROUPS.map((group) => [group.label, !mobile]))
})

function togglePermission(permName: string) {
  if (selectedPermissionNames.value.has(permName)) {
    selectedPermissionNames.value.delete(permName)
  } else {
    selectedPermissionNames.value.add(permName)
  }
}

function toggleLibrary(libraryId: number) {
  if (selectedLibraryIds.value.has(libraryId)) {
    selectedLibraryIds.value.delete(libraryId)
  } else {
    selectedLibraryIds.value.add(libraryId)
  }
}

function toggleGroup(label: string) {
  permissionGroupOpen.value[label] = !permissionGroupOpen.value[label]
}

async function handleSubmit() {
  error.value = null
  loading.value = true
  try {
    const trimmedEmail = email.value.trim()

    if (isEdit.value) {
      const res = await api(`/api/v1/users/${props.user!.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value, email: trimmedEmail || undefined, active: active.value }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        error.value = err.message ?? 'Failed to update user'
        return
      }

      const permRes = await api(`/api/v1/users/${props.user!.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionNames: [...selectedPermissionNames.value] }),
      })
      if (!permRes.ok) {
        const err = await permRes.json().catch(() => ({}))
        error.value = err.message ?? 'Failed to update permissions'
        return
      }

      const libRes = await api(`/api/v1/users/${props.user!.id}/libraries`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libraryIds: [...selectedLibraryIds.value] }),
      })
      if (!libRes.ok) {
        const err = await libRes.json().catch(() => ({}))
        error.value = err.message ?? 'Failed to update library access'
        return
      }
    } else {
      if (!trimmedEmail) {
        error.value = 'Email is required'
        return
      }

      const res = await api('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.value,
          username: username.value,
          email: trimmedEmail,
          permissionNames: [...selectedPermissionNames.value],
          libraryIds: [...selectedLibraryIds.value],
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
        <h2 class="text-base font-semibold text-foreground">{{ isEdit ? 'Edit User' : 'Create User' }}</h2>
        <button @click="emit('close')" class="text-muted-foreground hover:text-foreground">
          <X :size="16" />
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="flex-1 overflow-y-auto space-y-5 px-6 py-6">
        <!-- Basic info -->
        <div v-if="!isEdit" class="space-y-1.5">
          <label class="settings-label">Username</label>
          <input
            v-model="username"
            type="text"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div class="space-y-1.5">
          <label class="settings-label">Full name</label>
          <input
            v-model="name"
            type="text"
            required
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div class="space-y-1.5">
          <label class="settings-label">Email</label>
          <input
            v-model="email"
            type="email"
            :required="!isEdit"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>

        <div v-if="isEdit" class="flex items-center gap-3">
          <input id="active" v-model="active" type="checkbox" class="h-4 w-4 rounded border-input" />
          <label for="active" class="settings-label">Active</label>
        </div>

        <!-- Library access -->
        <div v-if="libraries.length > 0" class="space-y-2">
          <div class="rounded-md border border-border">
            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
              @click="libraryAccessOpen = !libraryAccessOpen"
            >
              <div>
                <p class="settings-label">Library access</p>
                <p class="text-xs text-muted-foreground">{{ selectedLibraryIds.size }} selected</p>
              </div>
              <ChevronDown :size="15" class="text-muted-foreground transition-transform" :class="libraryAccessOpen ? 'rotate-180' : ''" />
            </button>
            <div v-if="libraryAccessOpen" class="px-3 pb-3 space-y-1.5">
              <label v-for="lib in libraries" :key="lib.id" class="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  :checked="selectedLibraryIds.has(lib.id)"
                  @change="toggleLibrary(lib.id)"
                  class="h-4 w-4 rounded border-input"
                />
                <span class="text-sm text-foreground">{{ lib.name }}</span>
              </label>
            </div>
          </div>
        </div>

        <!-- Permissions grouped -->
        <div class="space-y-4">
          <p class="settings-label">Permissions</p>
          <div v-for="group in PERMISSION_GROUPS" :key="group.label" class="rounded-md border border-border">
            <button
              type="button"
              class="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
              @click="toggleGroup(group.label)"
            >
              <div>
                <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ group.label }}</p>
                <p class="text-xs text-muted-foreground">{{ selectedCountByGroup[group.label] ?? 0 }} selected</p>
              </div>
              <ChevronDown
                :size="15"
                class="text-muted-foreground transition-transform"
                :class="permissionGroupOpen[group.label] ? 'rotate-180' : ''"
              />
            </button>
            <div v-if="permissionGroupOpen[group.label]" class="px-3 pb-3 space-y-1">
              <label v-for="permName in group.permissions" :key="permName" class="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  :checked="selectedPermissionNames.has(permName)"
                  @change="togglePermission(permName)"
                  class="h-4 w-4 rounded border-input"
                />
                <span class="text-sm text-foreground">{{ PERMISSION_LABELS[permName] ?? permName }}</span>
              </label>
            </div>
          </div>
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>
      </form>

      <div class="border-t border-border px-6 py-4 flex gap-3 justify-end">
        <button @click="emit('close')" class="rounded-md border border-border px-4 py-2 settings-label hover:bg-muted transition-colors">
          Cancel
        </button>
        <button
          @click="handleSubmit"
          :disabled="loading"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {{ loading ? 'Saving...' : 'Save' }}
        </button>
      </div>
    </div>
  </div>
</template>
