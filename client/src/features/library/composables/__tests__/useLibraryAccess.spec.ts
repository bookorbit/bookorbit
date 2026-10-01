// @vitest-environment node
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

const USERS = [
  { id: 2, username: 'maya', name: 'Maya Ortiz' },
  { id: 3, username: 'sam', name: 'Sam Whitfield' },
]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('useLibraryAccess', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('queues grants while the library does not exist yet', async () => {
    apiMock.mockResolvedValue(jsonResponse(USERS))
    const { useLibraryAccess } = await import('../useLibraryAccess')
    const access = useLibraryAccess(ref<number | null>(null))

    await access.load()
    await access.grant(2, 'editor')
    await access.changeLevel(2, 'owner')

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(access.pending.value).toEqual([{ userId: 2, username: 'maya', name: 'Maya Ortiz', accessLevel: 'owner', failed: false }])
    expect(access.availableUsers.value.map((user) => user.id)).toEqual([3])
    expect(access.count.value).toBe(1)

    await access.revoke(2)
    expect(access.pending.value).toEqual([])
  })

  it('sends queued grants once the library exists and keeps the ones that fail', async () => {
    const libraryId = ref<number | null>(null)
    apiMock.mockImplementation(async (url, init) => {
      const path = String(url)
      if (path.endsWith('/users/assignable')) return jsonResponse(USERS)
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { userId: number }
        return body.userId === 2 ? jsonResponse({}) : jsonResponse({ message: 'nope' }, 500)
      }
      return jsonResponse([{ userId: 2, username: 'maya', name: 'Maya Ortiz', accessLevel: 'viewer' }])
    })
    const { useLibraryAccess } = await import('../useLibraryAccess')
    const access = useLibraryAccess(libraryId)
    await access.load()
    await access.grant(2, 'viewer')
    await access.grant(3, 'viewer')

    libraryId.value = 9
    const failed = await access.applyPending()

    expect(failed).toBe(1)
    expect(access.failedGrants.value.map((grant) => grant.userId)).toEqual([3])
    expect(access.entries.value.map((entry) => entry.userId)).toEqual([2])
    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/libraries/9/access',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ userId: 3, accessLevel: 'viewer' }) }),
    )
  })

  it('writes straight to the server for an existing library and reports its message on failure', async () => {
    apiMock.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/users/assignable')) return jsonResponse(USERS)
      if (init?.method === 'PATCH') return jsonResponse({ message: 'Owners cannot be demoted' }, 400)
      return jsonResponse([])
    })
    const { useLibraryAccess } = await import('../useLibraryAccess')
    const access = useLibraryAccess(ref<number | null>(4))
    await access.load()

    await access.grant(2, 'viewer')
    const changed = await access.changeLevel(2, 'editor')

    expect(apiMock).toHaveBeenCalledWith('/api/v1/libraries/4/access', expect.objectContaining({ method: 'POST' }))
    expect(changed).toBe(false)
    expect(access.error.value).toBe('Owners cannot be demoted')
  })
})
