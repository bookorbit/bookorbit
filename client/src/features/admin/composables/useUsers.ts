import { computed, ref, watch } from 'vue'
import type {
  AuthUser,
  DefaultLibraryAccessConfig,
  Library,
  ProvisioningMethod,
  UserAttentionItem,
  UserAttentionResponse,
  UserListSortDirection,
  UserListSortField,
  UserListState,
  UserListSummary,
} from '@bookorbit/types'

import { api } from '@/lib/api'

export interface UserRow extends AuthUser {
  id: number
  hasContentFilters?: boolean
  lockedUntil?: string | null
  failedLoginAttempts?: number
  createdAt?: string
  lastAuthenticatedAt?: string | null
  libraryAccessCount?: number
  provisioningMethod: ProvisioningMethod
}

export type UserLibrary = Pick<Library, 'id' | 'name' | 'bookCount'>

const EMPTY_SUMMARY: UserListSummary = { total: 0, admins: 0, active: 0, inactive: 0, attention: 0 }

/** Long enough that a burst of typing is one request, short enough to feel immediate. */
const SEARCH_DEBOUNCE_MS = 250

export function useUsers() {
  const users = ref<UserRow[]>([])
  const libraries = ref<UserLibrary[]>([])
  const defaultLibraryIds = ref<Set<number>>(new Set())
  const savedDefaultLibraryIds = ref<Set<number>>(new Set())
  const summary = ref<UserListSummary>({ ...EMPTY_SUMMARY })
  const attention = ref<UserAttentionItem[]>([])

  const total = ref(0)
  const page = ref(1)
  const pageSize = ref(25)
  const search = ref('')
  const state = ref<UserListState | ''>('')
  const sortBy = ref<UserListSortField>('username')
  const sortDir = ref<UserListSortDirection>('asc')

  const loading = ref(false)
  /** True only until the first page arrives, so a refetch never flashes the skeleton back. */
  const initialLoad = ref(true)
  const error = ref<string | null>(null)
  let loadVersion = 0
  let searchTimer: ReturnType<typeof setTimeout> | undefined

  const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
  const defaultLibraryIdsArray = computed(() => [...defaultLibraryIds.value])
  const hasDefaultLibraryChanges = computed(() => !setsEqual(defaultLibraryIds.value, savedDefaultLibraryIds.value))
  const hasActiveFilters = computed(() => search.value.trim().length > 0 || state.value !== '')

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
      const res = await api(buildListUrl())
      if (version !== loadVersion) return
      if (!res.ok) throw new Error('load')
      const data = await res.json()
      users.value = data.users ?? data.items ?? data
      total.value = data.total ?? users.value.length
    } catch {
      if (version !== loadVersion) return
      error.value = 'load'
    } finally {
      if (version === loadVersion) {
        loading.value = false
        initialLoad.value = false
      }
    }
  }

  /**
   * Libraries and the default-access config do not change between pages or keystrokes, so
   * they are fetched once rather than riding along with every debounced list request.
   */
  async function loadStatic() {
    try {
      const [librariesRes, defaultAccessRes] = await Promise.all([api('/api/v1/libraries'), api('/api/v1/app-settings/default-library-access')])
      if (!librariesRes.ok || !defaultAccessRes.ok) throw new Error('load')

      const librariesData = await librariesRes.json()
      libraries.value = librariesData.libraries ?? librariesData.items ?? librariesData

      const defaultAccess = (await defaultAccessRes.json()) as DefaultLibraryAccessConfig
      defaultLibraryIds.value = new Set(defaultAccess.libraryIds ?? [])
      savedDefaultLibraryIds.value = new Set(defaultAccess.libraryIds ?? [])
    } catch {
      error.value = 'load'
    }
  }

  /** Counts and the attention band describe every account, so they are refreshed together. */
  async function loadOverview() {
    try {
      const [summaryRes, attentionRes] = await Promise.all([api('/api/v1/users/summary'), api('/api/v1/users/attention')])
      if (summaryRes.ok) summary.value = (await summaryRes.json()) as UserListSummary
      if (attentionRes.ok) attention.value = ((await attentionRes.json()) as UserAttentionResponse).items
    } catch {
      // The roster is still usable without its counts; the list's own error covers a real outage.
    }
  }

  async function reload() {
    await Promise.all([load(), loadOverview()])
  }

  function applyFilters() {
    page.value = 1
    void load()
  }

  /** First click sorts ascending; clicking the active column flips the direction. */
  function toggleSort(field: UserListSortField) {
    if (sortBy.value === field) sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    else {
      sortBy.value = field
      // Recency reads best newest-first; names read best A-Z.
      sortDir.value = field === 'lastActive' || field === 'createdAt' ? 'desc' : 'asc'
    }
    applyFilters()
  }

  function setState(next: UserListState | '') {
    if (state.value === next) return
    state.value = next
    applyFilters()
  }

  watch(search, () => {
    clearTimeout(searchTimer)
    searchTimer = setTimeout(applyFilters, SEARCH_DEBOUNCE_MS)
  })

  function resetFilters() {
    clearTimeout(searchTimer)
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
    summary,
    attention,
    total,
    page,
    pageSize,
    totalPages,
    search,
    state,
    sortBy,
    sortDir,
    loading,
    initialLoad,
    error,
    hasActiveFilters,
    defaultLibraryIds,
    defaultLibraryIdsArray,
    hasDefaultLibraryChanges,
    load,
    loadStatic,
    loadOverview,
    reload,
    applyFilters,
    toggleSort,
    setState,
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
