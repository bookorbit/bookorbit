import { computed, ref, watch, type Ref } from 'vue'
import { PERMISSION_REQUIRES, type AuthUser, type Permission } from '@bookorbit/types'
import { api } from '@/lib/api'
import { grantingPermissions, isRestrictionPermission, presetPermissions, type PermissionPreset } from '../lib/permission-presets'

export type UserFormSection = 'profile' | 'libraries' | 'permissions' | 'restrictions'

/**
 * The list row the drawer is opened from. `createdAt` and `lockedUntil` ride along on the list
 * response without living on `AuthUser`, and the Profile section reports both.
 */
export interface UserFormTarget extends Partial<AuthUser> {
  createdAt?: string
  lockedUntil?: string | null
}

export interface NamedItem {
  id: number
  name: string
}

export interface UserFormSaveResult {
  ok: boolean
  /** Present when creating a password account, so the caller can offer the one-time link. */
  resetUrl?: string
  /** The section holding the field a failed save complained about. */
  section?: UserFormSection
}

interface FormSnapshot {
  name: string
  email: string
  active: boolean
  permissions: string
  libraries: string
  filters: string
}

/** What the Restrictions section currently holds, for the summary beside its nav entry. */
export type RestrictionState = 'none' | 'content' | 'demo' | 'both'

export function useUserForm(user: Ref<UserFormTarget | null>, defaultLibraryIds: Ref<number[] | undefined>) {
  const name = ref('')
  const username = ref('')
  const email = ref('')
  const active = ref(true)
  const isSharedAccount = ref(false)
  const selectedPermissionNames = ref<Set<string>>(new Set())
  const selectedLibraryIds = ref<Set<number>>(new Set())

  const includeTagItems = ref<NamedItem[]>([])
  const excludeTagItems = ref<NamedItem[]>([])
  const includeGenreItems = ref<NamedItem[]>([])
  const excludeGenreItems = ref<NamedItem[]>([])
  const contentFiltersEnabled = ref(false)
  const seeOwnRequestedBooks = ref(false)

  const loading = ref(false)
  const error = ref<string | null>(null)
  const errorKey = ref<string | null>(null)

  const snapshot = ref<FormSnapshot | null>(null)

  const isEdit = computed(() => !!user.value?.id)
  const isSuperuserTarget = computed(() => !!user.value?.isSuperuser)
  const totalPermissions = computed(() => grantingPermissions().length)
  const grantedCount = computed(() => [...selectedPermissionNames.value].filter((permissionName) => !isRestrictionPermission(permissionName)).length)

  const hasContentFilters = computed(
    () =>
      includeTagItems.value.length > 0 ||
      excludeTagItems.value.length > 0 ||
      includeGenreItems.value.length > 0 ||
      excludeGenreItems.value.length > 0,
  )

  const restrictionPermissionNames = computed(() => [...selectedPermissionNames.value].filter(isRestrictionPermission))

  const restrictionState = computed<RestrictionState>(() => {
    const demo = restrictionPermissionNames.value.length > 0
    if (demo && hasContentFilters.value) return 'both'
    if (demo) return 'demo'
    return hasContentFilters.value ? 'content' : 'none'
  })

  function currentSnapshot(): FormSnapshot {
    return {
      name: name.value,
      email: email.value.trim(),
      active: active.value,
      permissions: [...selectedPermissionNames.value].sort().join(','),
      libraries: [...selectedLibraryIds.value].sort((a, b) => a - b).join(','),
      filters: filterSignature(),
    }
  }

  function filterSignature(): string {
    const lists = [includeTagItems, excludeTagItems, includeGenreItems, excludeGenreItems]
      .map((items) =>
        items.value
          .map((item) => item.id)
          .sort((a, b) => a - b)
          .join('.'),
      )
      .join('|')
    return `${lists}|exempt:${seeOwnRequestedBooks.value}`
  }

  /** Field-level count, so the footer can say how much a Cancel would throw away. */
  const changeCount = computed(() => {
    const base = snapshot.value
    if (!base) return 0
    const next = currentSnapshot()
    let changes = 0
    if (base.name !== next.name) changes++
    if (base.email !== next.email) changes++
    if (base.active !== next.active) changes++
    if (base.libraries !== next.libraries) changes++
    if (base.permissions !== next.permissions) changes++
    if (base.filters !== next.filters) changes++
    return changes
  })

  function toggleLibrary(libraryId: number) {
    const next = new Set(selectedLibraryIds.value)
    if (next.has(libraryId)) next.delete(libraryId)
    else next.add(libraryId)
    selectedLibraryIds.value = next
  }

  function setLibraries(libraryIds: number[]) {
    selectedLibraryIds.value = new Set(libraryIds)
  }

  /**
   * Mirrors the dependency the server applies on assignment: granting a permission that is inert on
   * its own pulls in what it needs, and revoking that requirement takes the dependent with it.
   * Without this the checkboxes and the saved account disagree until the next reload.
   */
  function togglePermission(permissionName: string) {
    const next = new Set(selectedPermissionNames.value)
    if (next.has(permissionName)) {
      next.delete(permissionName)
      for (const [dependent, required] of Object.entries(PERMISSION_REQUIRES)) {
        if ((required as readonly string[]).includes(permissionName)) next.delete(dependent)
      }
    } else {
      next.add(permissionName)
      for (const required of PERMISSION_REQUIRES[permissionName as Permission] ?? []) next.add(required)
    }
    selectedPermissionNames.value = next
  }

  /** Presets speak for granting permissions only, so a demo restriction survives applying one. */
  function applyPreset(preset: PermissionPreset) {
    selectedPermissionNames.value = new Set([...presetPermissions(preset), ...restrictionPermissionNames.value])
  }

  function setContentFiltersEnabled(enabled: boolean) {
    contentFiltersEnabled.value = enabled
    if (enabled) return
    includeTagItems.value = []
    excludeTagItems.value = []
    includeGenreItems.value = []
    excludeGenreItems.value = []
    seeOwnRequestedBooks.value = false
  }

  function reset() {
    const target = user.value
    name.value = target?.name ?? ''
    username.value = target?.username ?? ''
    email.value = target?.email ?? ''
    active.value = target?.active ?? true
    isSharedAccount.value = target?.provisioningMethod === 'shared'
    selectedPermissionNames.value = new Set(target?.permissions?.filter((permissionName) => permissionName !== '*') ?? [])
    selectedLibraryIds.value = target?.id ? new Set() : new Set(defaultLibraryIds.value ?? [])
    includeTagItems.value = []
    excludeTagItems.value = []
    includeGenreItems.value = []
    excludeGenreItems.value = []
    contentFiltersEnabled.value = false
    seeOwnRequestedBooks.value = false
    error.value = null
    errorKey.value = null
    snapshot.value = null
  }

  async function load() {
    reset()
    const target = user.value
    if (!target?.id) {
      snapshot.value = currentSnapshot()
      return
    }

    const [librariesRes, filtersRes] = await Promise.all([
      api(`/api/v1/users/${target.id}/libraries`),
      target.isSuperuser ? Promise.resolve(null) : api(`/api/v1/users/${target.id}/content-filters`),
    ])

    if (user.value?.id !== target.id) return

    if (librariesRes.ok) {
      const libraryIds: number[] = await librariesRes.json()
      selectedLibraryIds.value = new Set(libraryIds)
    }
    if (filtersRes?.ok) {
      const filters = await filtersRes.json()
      includeTagItems.value = filters.includeTags ?? []
      excludeTagItems.value = filters.excludeTags ?? []
      includeGenreItems.value = filters.includeGenres ?? []
      excludeGenreItems.value = filters.excludeGenres ?? []
      seeOwnRequestedBooks.value = filters.seeOwnRequestedBooks ?? false
      contentFiltersEnabled.value = hasContentFilters.value
    }

    if (user.value?.id !== target.id) return
    snapshot.value = currentSnapshot()
  }

  function fail(key: string, section: UserFormSection, message?: string): UserFormSaveResult {
    errorKey.value = key
    error.value = message ?? null
    return { ok: false, section }
  }

  async function readMessage(response: Response): Promise<string | undefined> {
    const body = await response.json().catch(() => ({}))
    return typeof body?.message === 'string' ? body.message : undefined
  }

  function validate(): UserFormSaveResult | null {
    if (!name.value.trim()) return fail('nameRequired', 'profile')
    if (!isEdit.value && !username.value.trim()) return fail('usernameRequired', 'profile')
    if (!isEdit.value && !isSharedAccount.value && !email.value.trim()) return fail('emailRequired', 'profile')
    return null
  }

  async function saveExisting(userId: number): Promise<UserFormSaveResult> {
    const trimmedEmail = email.value.trim()

    const userRes = await api(`/api/v1/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.value, email: trimmedEmail || undefined, active: active.value }),
    })
    if (!userRes.ok) return fail('updateUser', 'profile', await readMessage(userRes))

    const permissionsRes = await api(`/api/v1/users/${userId}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionNames: [...selectedPermissionNames.value] }),
    })
    if (!permissionsRes.ok) return fail('updatePermissions', 'permissions', await readMessage(permissionsRes))

    const librariesRes = await api(`/api/v1/users/${userId}/libraries`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ libraryIds: [...selectedLibraryIds.value] }),
    })
    if (!librariesRes.ok) return fail('updateLibraryAccess', 'libraries', await readMessage(librariesRes))

    if (!isSuperuserTarget.value) {
      const filtersRes = await api(`/api/v1/users/${userId}/content-filters`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          includeTagIds: includeTagItems.value.map((item) => item.id),
          excludeTagIds: excludeTagItems.value.map((item) => item.id),
          includeGenreIds: includeGenreItems.value.map((item) => item.id),
          excludeGenreIds: excludeGenreItems.value.map((item) => item.id),
          seeOwnRequestedBooks: seeOwnRequestedBooks.value,
        }),
      })
      if (!filtersRes.ok) return fail('updateContentFilters', 'restrictions', await readMessage(filtersRes))
    }

    return { ok: true }
  }

  async function createNew(): Promise<UserFormSaveResult> {
    const trimmedEmail = email.value.trim()
    const payload = {
      name: name.value,
      username: username.value,
      email: trimmedEmail || undefined,
      permissionNames: [...selectedPermissionNames.value],
      libraryIds: [...selectedLibraryIds.value],
    }

    if (isSharedAccount.value) {
      const res = await api('/api/v1/users/shared', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return fail('createSharedAccount', 'profile', await readMessage(res))
      return { ok: true }
    }

    const res = await api('/api/v1/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, email: trimmedEmail }),
    })
    if (!res.ok) return fail('createUser', 'profile', await readMessage(res))
    const data = await res.json()
    return { ok: true, resetUrl: data.resetUrl }
  }

  async function save(): Promise<UserFormSaveResult> {
    error.value = null
    errorKey.value = null

    const invalid = validate()
    if (invalid) return invalid

    loading.value = true
    try {
      const userId = user.value?.id
      const result = userId ? await saveExisting(userId) : await createNew()
      if (result.ok) snapshot.value = currentSnapshot()
      return result
    } finally {
      loading.value = false
    }
  }

  watch(user, () => void load(), { immediate: true })

  watch(defaultLibraryIds, (libraryIds) => {
    if (!isEdit.value) {
      setLibraries(libraryIds ?? [])
      snapshot.value = currentSnapshot()
    }
  })

  return {
    name,
    username,
    email,
    active,
    isSharedAccount,
    selectedPermissionNames,
    selectedLibraryIds,
    includeTagItems,
    excludeTagItems,
    includeGenreItems,
    excludeGenreItems,
    contentFiltersEnabled,
    seeOwnRequestedBooks,
    loading,
    error,
    errorKey,
    isEdit,
    isSuperuserTarget,
    grantedCount,
    totalPermissions,
    hasContentFilters,
    restrictionState,
    changeCount,
    toggleLibrary,
    setLibraries,
    togglePermission,
    applyPreset,
    setContentFiltersEnabled,
    save,
  }
}
