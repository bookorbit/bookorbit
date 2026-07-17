<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from '@lucide/vue'
import { api } from '@/lib/api'
import { Permission, PERMISSION_LABELS } from '@bookorbit/types'
import type { AuthUser } from '@bookorbit/types'
import { useMediaQuery } from '@vueuse/core'
import ContentFilterChipInput from '@/components/ui/ContentFilterChipInput.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import Badge from '@/components/ui/badge/Badge.vue'
import { useTagSearchWithIds, useGenreSearchWithIds } from './composables/useContentFilterSearch'

interface Library {
  id: number
  name: string
}

interface NamedItem {
  id: number
  name: string
}

const props = defineProps<{
  user: Partial<AuthUser> | null
  libraries: Library[]
  defaultLibraryIds?: number[]
}>()

const emit = defineEmits<{
  close: []
  saved: [resetUrl?: string]
}>()

const { t } = useI18n()

const PERMISSION_GROUPS: { id: string; label: string; permissions: Permission[] }[] = [
  {
    id: 'content',
    label: 'Content',
    permissions: [Permission.LibraryDownload, Permission.LibraryUpload, Permission.LibraryEditMetadata, Permission.LibraryDeleteBooks],
  },
  {
    id: 'devicesAccess',
    label: 'Devices & Access',
    permissions: [
      Permission.KoboSync,
      Permission.KoreaderSync,
      Permission.HardcoverSync,
      Permission.ReadwiseSync,
      Permission.StorygraphSync,
      Permission.OpdsAccess,
      Permission.BookDockAccess,
    ],
  },
  {
    id: 'email',
    label: 'Email',
    permissions: [Permission.EmailSend, Permission.ManageEmail],
  },
  {
    id: 'administration',
    label: 'Administration',
    permissions: [
      Permission.ManageLibraries,
      Permission.ManageMetadataConfig,
      Permission.ManageIcons,
      Permission.ManageAppSettings,
      Permission.ManageUsers,
      Permission.ViewUserActivity,
      Permission.ViewAuditLog,
    ],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    permissions: [Permission.NotificationAccess],
  },
  {
    id: 'restrictions',
    label: 'Restrictions',
    permissions: [Permission.DemoRestricted],
  },
]

const permissionGroups = computed(() =>
  PERMISSION_GROUPS.map((group) => ({ ...group, label: t(`adminFeature.userForm.permissionGroups.${group.id}`) })),
)

function permissionLabel(permission: Permission): string {
  if (permission === Permission.ViewUserActivity) return t('adminFeature.accountActivity.permissionLabel')
  return PERMISSION_LABELS[permission] ?? permission
}

const name = ref('')
const username = ref('')
const email = ref('')
const active = ref(true)
const isSharedAccount = ref(false)
const selectedPermissionNames = ref<Set<string>>(new Set())
const selectedLibraryIds = ref<Set<number>>(new Set())
const error = ref<string | null>(null)
const loading = ref(false)
const libraryAccessOpen = ref(true)
const permissionGroupOpen = ref<Record<string, boolean>>({})
const contentFiltersOpen = ref(false)

const includeTagItems = ref<NamedItem[]>([])
const excludeTagItems = ref<NamedItem[]>([])
const includeGenreItems = ref<NamedItem[]>([])
const excludeGenreItems = ref<NamedItem[]>([])

const currentTab = ref<'general' | 'access' | 'restrictions'>('general')
const restrictionsEnabled = ref(false)

const { search: searchTags } = useTagSearchWithIds()
const { search: searchGenres } = useGenreSearchWithIds()

const isEdit = computed(() => !!props.user?.id)
const isSuperuserTarget = computed(() => !!props.user?.isSuperuser)
const isMobile = useMediaQuery('(max-width: 767px)')

function toggleLibrary(libraryId: number) {
  if (selectedLibraryIds.value.has(libraryId)) {
    selectedLibraryIds.value.delete(libraryId)
  } else {
    selectedLibraryIds.value.add(libraryId)
  }
}

const hasRestrictions = computed(() => {
  return (
    includeTagItems.value.length > 0 || excludeTagItems.value.length > 0 || includeGenreItems.value.length > 0 || excludeGenreItems.value.length > 0
  )
})

function applyPreset(preset: 'standard' | 'admin' | 'clear') {
  if (preset === 'clear') {
    selectedPermissionNames.value.clear()
  } else if (preset === 'admin') {
    const all = PERMISSION_GROUPS.flatMap((g) => g.permissions)
    selectedPermissionNames.value = new Set(all)
  } else if (preset === 'standard') {
    selectedPermissionNames.value = new Set([
      Permission.LibraryDownload,
      Permission.KoboSync,
      Permission.KoreaderSync,
      Permission.HardcoverSync,
      Permission.ReadwiseSync,
      Permission.StorygraphSync,
      Permission.OpdsAccess,
      Permission.BookDockAccess,
    ])
  }
}

watch(
  hasRestrictions,
  (val) => {
    if (val) restrictionsEnabled.value = true
  },
  { immediate: true },
)

watch(
  () => props.user,
  async (u) => {
    name.value = u?.name ?? ''
    username.value = u?.username ?? ''
    email.value = u?.email ?? ''
    active.value = u?.active ?? true
    isSharedAccount.value = u?.provisioningMethod === 'shared'
    selectedPermissionNames.value = new Set(u?.permissions?.filter((p) => p !== '*') ?? [])
    selectedLibraryIds.value = u?.id ? new Set() : new Set(props.defaultLibraryIds ?? [])
    error.value = null
    includeTagItems.value = []
    excludeTagItems.value = []
    includeGenreItems.value = []
    excludeGenreItems.value = []

    if (u?.id) {
      const [libRes, filtersRes] = await Promise.all([
        api(`/api/v1/users/${u.id}/libraries`),
        !u.isSuperuser ? api(`/api/v1/users/${u.id}/content-filters`) : Promise.resolve(null),
      ])
      if (libRes.ok) {
        const ids: number[] = await libRes.json()
        selectedLibraryIds.value = new Set(ids)
      }
      if (filtersRes?.ok) {
        const filters = await filtersRes.json()
        includeTagItems.value = filters.includeTags ?? []
        excludeTagItems.value = filters.excludeTags ?? []
        includeGenreItems.value = filters.includeGenres ?? []
        excludeGenreItems.value = filters.excludeGenres ?? []
      }
    }

    libraryAccessOpen.value = !isMobile.value
    permissionGroupOpen.value = Object.fromEntries(PERMISSION_GROUPS.map((group) => [group.id, !isMobile.value]))
    contentFiltersOpen.value = false
    currentTab.value = 'general'
  },
  { immediate: true },
)

watch(
  () => props.defaultLibraryIds,
  (ids) => {
    if (!isEdit.value) selectedLibraryIds.value = new Set(ids ?? [])
  },
)

watch(isMobile, (mobile) => {
  libraryAccessOpen.value = !mobile
  permissionGroupOpen.value = Object.fromEntries(PERMISSION_GROUPS.map((group) => [group.id, !mobile]))
})

function togglePermission(permName: string) {
  if (selectedPermissionNames.value.has(permName)) {
    selectedPermissionNames.value.delete(permName)
  } else {
    selectedPermissionNames.value.add(permName)
  }
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
        error.value = err.message ?? t('adminFeature.userForm.errors.updateUser')
        return
      }

      const permRes = await api(`/api/v1/users/${props.user!.id}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionNames: [...selectedPermissionNames.value] }),
      })
      if (!permRes.ok) {
        const err = await permRes.json().catch(() => ({}))
        error.value = err.message ?? t('adminFeature.userForm.errors.updatePermissions')
        return
      }

      const libRes = await api(`/api/v1/users/${props.user!.id}/libraries`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libraryIds: [...selectedLibraryIds.value] }),
      })
      if (!libRes.ok) {
        const err = await libRes.json().catch(() => ({}))
        error.value = err.message ?? t('adminFeature.userForm.errors.updateLibraryAccess')
        return
      }

      if (!isSuperuserTarget.value) {
        const cfRes = await api(`/api/v1/users/${props.user!.id}/content-filters`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            includeTagIds: includeTagItems.value.map((i) => i.id),
            excludeTagIds: excludeTagItems.value.map((i) => i.id),
            includeGenreIds: includeGenreItems.value.map((i) => i.id),
            excludeGenreIds: excludeGenreItems.value.map((i) => i.id),
          }),
        })
        if (!cfRes.ok) {
          const err = await cfRes.json().catch(() => ({}))
          error.value = err.message ?? t('adminFeature.userForm.errors.updateContentFilters')
          return
        }
      }
    } else {
      if (!isSharedAccount.value && !trimmedEmail) {
        error.value = t('adminFeature.userForm.errors.emailRequired')
        return
      }

      if (isSharedAccount.value) {
        const res = await api('/api/v1/users/shared', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.value,
            username: username.value,
            email: trimmedEmail || undefined,
            permissionNames: [...selectedPermissionNames.value],
            libraryIds: [...selectedLibraryIds.value],
          }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          error.value = err.message ?? t('adminFeature.userForm.errors.createSharedAccount')
          return
        }
        emit('saved')
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
        error.value = err.message ?? t('adminFeature.userForm.errors.createUser')
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
      <div class="flex items-center justify-between px-6 pt-5 pb-4">
        <div class="flex items-center gap-3">
          <h2 class="text-base font-semibold text-foreground">
            {{
              isEdit
                ? name || username || t('adminFeature.userForm.editUser')
                : isSharedAccount
                  ? t('adminFeature.userForm.createSharedAccount')
                  : t('adminFeature.userForm.createUser')
            }}
          </h2>
          <Badge
            v-if="isSharedAccount"
            variant="secondary"
            class="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
            >{{ t('adminFeature.userForm.sharedBadge') }}</Badge
          >
          <div v-if="isEdit" class="flex items-center gap-2">
            <ToggleSwitch v-model="active" />
            <span class="text-xs text-muted-foreground">{{ active ? t('adminFeature.userForm.active') : t('adminFeature.userForm.suspended') }}</span>
          </div>
        </div>
        <button @click="emit('close')" class="text-muted-foreground hover:text-foreground">
          <X :size="16" />
        </button>
      </div>

      <div class="px-6 border-b border-border flex gap-6">
        <button
          type="button"
          v-for="tab in ['general', 'access', 'restrictions'] as const"
          :key="tab"
          class="pb-3 text-sm font-medium border-b-2 transition-colors capitalize"
          :class="currentTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
          @click="currentTab = tab"
        >
          {{ t(`adminFeature.userForm.tabs.${tab}`) }}
        </button>
      </div>

      <form @submit.prevent="handleSubmit" class="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        <div v-if="currentTab === 'general'" class="space-y-5">
          <div v-if="!isEdit" class="rounded-md border border-border px-4 py-3">
            <label class="flex items-start gap-3 cursor-pointer">
              <input id="isShared" v-model="isSharedAccount" type="checkbox" class="mt-0.5 h-4 w-4 rounded border-input" />
              <div>
                <p class="text-sm font-medium text-foreground">{{ t('adminFeature.userForm.sharedAccount') }}</p>
                <p class="text-xs text-muted-foreground mt-0.5">{{ t('adminFeature.userForm.sharedAccountHint') }}</p>
              </div>
            </label>
          </div>
          <div v-else-if="isSharedAccount" class="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <p class="text-sm text-amber-600 dark:text-amber-400 font-medium">{{ t('adminFeature.userForm.sharedAccount') }}</p>
            <p class="text-xs text-muted-foreground mt-0.5">{{ t('adminFeature.userForm.sharedAccountManageHint') }}</p>
          </div>

          <div v-if="!isEdit" class="space-y-1.5">
            <label class="settings-label">{{ t('adminFeature.userForm.username') }}</label>
            <input
              v-model="username"
              type="text"
              required
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div class="space-y-1.5">
            <label class="settings-label">{{ t('adminFeature.userForm.fullName') }}</label>
            <input
              v-model="name"
              type="text"
              required
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div class="space-y-1.5">
            <label class="settings-label">
              {{ t('adminFeature.userForm.email') }}
              <span v-if="isSharedAccount && !isEdit" class="text-muted-foreground font-normal">{{ t('adminFeature.userForm.optional') }}</span>
            </label>
            <input
              v-model="email"
              type="email"
              :required="!isEdit && !isSharedAccount"
              class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        <div v-if="currentTab === 'access'" class="space-y-6">
          <div v-if="libraries.length > 0" class="space-y-3">
            <label class="settings-label">{{ t('adminFeature.userForm.libraryAccess') }}</label>
            <div class="space-y-1.5 rounded-md border border-border p-3">
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
            <p v-if="selectedLibraryIds.size === 0" class="text-xs text-muted-foreground">{{ t('adminFeature.userForm.noLibrariesSelected') }}</p>
          </div>

          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <label class="settings-label">{{ t('adminFeature.userForm.permissions') }}</label>
              <div class="flex items-center gap-2">
                <button type="button" @click="applyPreset('standard')" class="text-xs text-muted-foreground hover:text-foreground">
                  {{ t('adminFeature.userForm.presetStandard') }}
                </button>
                <span class="text-muted-foreground/30">•</span>
                <button type="button" @click="applyPreset('admin')" class="text-xs text-muted-foreground hover:text-foreground">
                  {{ t('adminFeature.userForm.presetAdmin') }}
                </button>
                <span class="text-muted-foreground/30">•</span>
                <button type="button" @click="applyPreset('clear')" class="text-xs text-muted-foreground hover:text-foreground">
                  {{ t('adminFeature.userForm.presetClearAll') }}
                </button>
              </div>
            </div>

            <div class="space-y-5">
              <div v-for="group in permissionGroups" :key="group.id" class="space-y-2">
                <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{{ group.label }}</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label v-for="permName in group.permissions" :key="permName" class="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      :checked="selectedPermissionNames.has(permName)"
                      @change="togglePermission(permName)"
                      class="mt-0.5 h-4 w-4 rounded border-input"
                    />
                    <span class="text-sm text-foreground leading-tight">{{ permissionLabel(permName) }}</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="currentTab === 'restrictions'" class="space-y-5">
          <div v-if="isSuperuserTarget" class="rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <p class="text-sm text-amber-600 dark:text-amber-400 font-medium">{{ t('adminFeature.userForm.superuserTarget') }}</p>
            <p class="text-xs text-muted-foreground mt-0.5">{{ t('adminFeature.userForm.superuserTargetHint') }}</p>
          </div>
          <template v-else>
            <div
              v-if="!restrictionsEnabled"
              class="rounded-md border border-dashed border-border px-4 py-8 text-center flex flex-col items-center gap-3"
            >
              <div class="space-y-1">
                <p class="text-sm font-medium text-foreground">{{ t('adminFeature.userForm.noRestrictions') }}</p>
                <p class="text-xs text-muted-foreground">{{ t('adminFeature.userForm.noRestrictionsHint') }}</p>
              </div>
              <button
                type="button"
                @click="restrictionsEnabled = true"
                class="text-xs font-medium text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-md transition-colors"
              >
                {{ t('adminFeature.userForm.addRestrictions') }}
              </button>
            </div>
            <div v-else class="space-y-5">
              <div class="flex items-center justify-between">
                <p class="text-sm font-medium text-foreground">{{ t('adminFeature.userForm.contentRestrictions') }}</p>
                <button
                  type="button"
                  v-if="!hasRestrictions"
                  @click="restrictionsEnabled = false"
                  class="text-xs text-muted-foreground hover:text-foreground"
                >
                  {{ t('adminFeature.userForm.remove') }}
                </button>
              </div>

              <div class="space-y-1.5">
                <label class="text-xs font-medium text-foreground"
                  >{{ t('adminFeature.userForm.includeTags') }}
                  <span class="text-muted-foreground font-normal">{{ t('adminFeature.userForm.includeTagsHint') }}</span></label
                >
                <ContentFilterChipInput
                  v-model="includeTagItems"
                  :placeholder="t('adminFeature.userForm.searchTagsPlaceholder')"
                  :search-fn="searchTags"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-foreground"
                  >{{ t('adminFeature.userForm.excludeTags') }}
                  <span class="text-muted-foreground font-normal">{{ t('adminFeature.userForm.excludeTagsHint') }}</span></label
                >
                <ContentFilterChipInput
                  v-model="excludeTagItems"
                  :placeholder="t('adminFeature.userForm.searchTagsPlaceholder')"
                  :search-fn="searchTags"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-foreground"
                  >{{ t('adminFeature.userForm.includeGenres') }}
                  <span class="text-muted-foreground font-normal">{{ t('adminFeature.userForm.includeGenresHint') }}</span></label
                >
                <ContentFilterChipInput
                  v-model="includeGenreItems"
                  :placeholder="t('adminFeature.userForm.searchGenresPlaceholder')"
                  :search-fn="searchGenres"
                />
              </div>
              <div class="space-y-1.5">
                <label class="text-xs font-medium text-foreground"
                  >{{ t('adminFeature.userForm.excludeGenres') }}
                  <span class="text-muted-foreground font-normal">{{ t('adminFeature.userForm.excludeGenresHint') }}</span></label
                >
                <ContentFilterChipInput
                  v-model="excludeGenreItems"
                  :placeholder="t('adminFeature.userForm.searchGenresPlaceholder')"
                  :search-fn="searchGenres"
                />
              </div>
            </div>
          </template>
        </div>

        <div v-if="error" class="text-sm text-destructive">{{ error }}</div>
      </form>

      <div class="border-t border-border px-6 py-4 flex gap-3 justify-end mt-auto bg-card">
        <button
          @click="emit('close')"
          type="button"
          class="rounded-md border border-border px-4 py-2 settings-label hover:bg-muted transition-colors"
        >
          {{ t('common.cancel') }}
        </button>
        <button
          @click="handleSubmit"
          type="button"
          :disabled="loading"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {{ loading ? t('adminFeature.userForm.saving') : t('common.save') }}
        </button>
      </div>
    </div>
  </div>
</template>
