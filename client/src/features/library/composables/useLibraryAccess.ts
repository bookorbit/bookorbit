import { computed, ref, type InjectionKey, type Ref } from 'vue'
import type { AccessLevel, LibraryAccessEntry } from '@bookorbit/types'
import { api } from '@/lib/api'
import { i18n } from '@/i18n'

export interface AssignableUser {
  id: number
  username: string
  name: string
}

/** A grant chosen while creating a library, sent once the library exists. */
export interface PendingGrant {
  userId: number
  username: string
  name: string
  accessLevel: AccessLevel
  failed: boolean
}

/**
 * Library access for the library editor. Once the library exists every change goes straight to the
 * server, as before. While it is being created there is nothing to grant against yet, so choices
 * queue up and `applyPending` sends them after the create succeeds; any that fail stay queued and
 * flagged so the editor can say who was not added and retry.
 */
export function useLibraryAccess(libraryId: Ref<number | null>) {
  const entries = ref<LibraryAccessEntry[]>([])
  const assignable = ref<AssignableUser[]>([])
  const pending = ref<PendingGrant[]>([])
  const loading = ref(false)
  const busy = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const availableUsers = computed(() => {
    const taken = new Set([...entries.value.map((entry) => entry.userId), ...pending.value.map((grant) => grant.userId)])
    return assignable.value.filter((user) => !taken.has(user.id))
  })
  const failedGrants = computed(() => pending.value.filter((grant) => grant.failed))
  const count = computed(() => (libraryId.value === null ? pending.value.length : entries.value.length))

  async function load(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const [usersRes, accessRes] = await Promise.all([
        api('/api/v1/users/assignable'),
        libraryId.value === null ? Promise.resolve(null) : api(`/api/v1/libraries/${libraryId.value}/access`),
      ])
      if (!usersRes.ok || (accessRes && !accessRes.ok)) {
        error.value = i18n.global.t('library.creator.access.errors.load')
        return
      }
      const users: unknown = await usersRes.json()
      const granted: unknown = accessRes ? await accessRes.json() : []
      assignable.value = Array.isArray(users) ? (users as AssignableUser[]) : []
      entries.value = Array.isArray(granted) ? (granted as LibraryAccessEntry[]) : []
      loaded.value = true
    } catch {
      error.value = i18n.global.t('library.creator.errors.connection')
    } finally {
      loading.value = false
    }
  }

  async function mutate(request: () => Promise<Response>, fallbackKey: string): Promise<boolean> {
    error.value = null
    busy.value = true
    try {
      const res = await request()
      if (!res.ok) {
        error.value = await messageFrom(res, i18n.global.t(fallbackKey))
        return false
      }
      await load()
      return true
    } catch {
      error.value = i18n.global.t('library.creator.errors.connection')
      return false
    } finally {
      busy.value = false
    }
  }

  async function grant(userId: number, accessLevel: AccessLevel): Promise<boolean> {
    const user = assignable.value.find((candidate) => candidate.id === userId)
    if (!user) return false
    if (libraryId.value === null) {
      pending.value = [...pending.value, { userId, username: user.username, name: user.name, accessLevel, failed: false }]
      return true
    }
    const id = libraryId.value
    return mutate(() => api(`/api/v1/libraries/${id}/access`, jsonRequest('POST', { userId, accessLevel })), 'library.creator.access.errors.grant')
  }

  async function changeLevel(userId: number, accessLevel: AccessLevel): Promise<boolean> {
    if (pending.value.some((grant) => grant.userId === userId)) {
      pending.value = pending.value.map((grant) => (grant.userId === userId ? { ...grant, accessLevel } : grant))
      return true
    }
    if (libraryId.value === null) return false
    const id = libraryId.value
    return mutate(
      () => api(`/api/v1/libraries/${id}/access/${userId}`, jsonRequest('PATCH', { accessLevel })),
      'library.creator.access.errors.updateLevel',
    )
  }

  async function revoke(userId: number): Promise<boolean> {
    if (pending.value.some((grant) => grant.userId === userId)) {
      pending.value = pending.value.filter((grant) => grant.userId !== userId)
      return true
    }
    if (libraryId.value === null) return false
    const id = libraryId.value
    return mutate(() => api(`/api/v1/libraries/${id}/access/${userId}`, { method: 'DELETE' }), 'library.creator.access.errors.revoke')
  }

  /** Sends queued grants one at a time. Returns how many could not be added. */
  async function applyPending(): Promise<number> {
    const id = libraryId.value
    if (id === null || pending.value.length === 0) return 0
    busy.value = true
    const remaining: PendingGrant[] = []
    try {
      for (const grant of pending.value) {
        try {
          const res = await api(`/api/v1/libraries/${id}/access`, jsonRequest('POST', { userId: grant.userId, accessLevel: grant.accessLevel }))
          if (!res.ok) remaining.push({ ...grant, failed: true })
        } catch {
          remaining.push({ ...grant, failed: true })
        }
      }
    } finally {
      pending.value = remaining
      busy.value = false
    }
    await load()
    return remaining.length
  }

  return {
    entries,
    assignable,
    pending,
    loading,
    busy,
    loaded,
    error,
    availableUsers,
    failedGrants,
    count,
    load,
    grant,
    changeLevel,
    revoke,
    applyPending,
  }
}

export type LibraryAccessState = ReturnType<typeof useLibraryAccess>
export const LIBRARY_ACCESS_KEY: InjectionKey<LibraryAccessState> = Symbol('library-access')

function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

async function messageFrom(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null)
  const message = body?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}
