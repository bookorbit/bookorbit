import { computed, ref } from 'vue'
import type { AuthUser, DefaultLibraryAccessConfig, Library, UserListSortDirection, UserListSortField, UserListState } from '@bookorbit/types'

import { api } from '@/lib/api'

export interface UserRow extends AuthUser {
  id: number
  hasContentFilters?: boolean
}

export type UserLibrary = Pick<Library, 'id' | 'name'>

export function useUsers() {
  const users = ref<UserRow[]>([])
  const libraries = ref<UserLibrary[]>([])
  const defaultLibraryIds = ref<Set<number>>(new Set())
  const savedDefaultLibraryIds = ref<Set<number>>(new Set())

  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(25)
  const search = ref('')
  const state = ref<UserListState | ''>('')
  const sortBy = ref<UserListSortField>('username')
  const sortDir = ref<UserListSortDirection>('asc')

  const loading = ref(false)
  const error = ref<string | null>(null)
  let loadVersion = 0

  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const defaultLibraryIdsArray = computed(() => [...defaultLibraryIds.value])
  const hasDefaultLibraryChanges = computed(() => !setsEqual(defaultLibraryIds.value, savedDefaultLibraryIds.value))

  function buildListUrl(): string {
    const params = new URLSearchParams({
      page: String(page.value - 1),
      pageSize: String(pageSize.value),
      sortBy: sortBy.value,
      sortDir: sortDir.value,
    })
    if (search.value.trim()) params.set('search', search.value.trim())
    if (state.value) params.set('state', state.value)
    return `/api/v1/users?${params.toString()}`
  }

  async function load() {
    const version = ++loadVersion
    loading.value = true
    error.value = null
    try {
      const [usersRes, librariesRes, defaultAccessRes] = await Promise.all([
        api(buildListUrl()),
        api('/api/v1/libraries'),
        api('/api/v1/app-settings/default-library-access'),
      ])
      if (version !== loadVersion) return
      if (!usersRes.ok || !librariesRes.ok || !defaultAccessRes.ok) throw new Error('load')

      const usersData = await usersRes.json()
      users.value = usersData.users ?? usersData.items ?? usersData
      total.value = usersData.total ?? users.value.length

      const librariesData = await librariesRes.json()
      libraries.value = librariesData.libraries ?? librariesData.items ?? librariesData

      const defaultAccess = (await defaultAccessRes.json()) as DefaultLibraryAccessConfig
      defaultLibraryIds.value = new Set(defaultAccess.libraryIds ?? [])
      savedDefaultLibraryIds.value = new Set(defaultAccess.libraryIds ?? [])
    } catch {
      if (version !== loadVersion) return
      error.value = 'load'
    } finally {
      if (version === loadVersion) loading.value = false
    }
  }

  function resetFilters() {
    search.value = ''
    state.value = ''
    sortBy.value = 'username'
    sortDir.value = 'asc'
    page.value = 1
  }

  function toggleDefaultLibrary(libraryId: number) {
    const next = new Set(defaultLibraryIds.value)
    if (next.has(libraryId)) next.delete(libraryId)
    else next.add(libraryId)
    defaultLibraryIds.value = next
  }

  function markDefaultLibrariesSaved(libraryIds: number[]) {
    defaultLibraryIds.value = new Set(libraryIds)
    savedDefaultLibraryIds.value = new Set(libraryIds)
  }

  return {
    users,
    libraries,
    total,
    page,
    pageSize,
    totalPages,
    search,
    state,
    sortBy,
    sortDir,
    loading,
    error,
    defaultLibraryIds,
    defaultLibraryIdsArray,
    hasDefaultLibraryChanges,
    load,
    resetFilters,
    toggleDefaultLibrary,
    markDefaultLibrariesSaved,
  }
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) {
    if (!b.has(value)) return false
  }
  return true
}
