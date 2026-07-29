import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { Permission, type SmartScope } from '@bookorbit/types'

const mockState = vi.hoisted(() => ({
  permissions: [] as string[],
  isSuperuser: false,
  setKoboSync: vi.fn<(id: number, enabled: boolean) => Promise<SmartScope>>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: (name: string) => mockState.isSuperuser || mockState.permissions.includes(name),
  }),
}))

vi.mock('../useSmartScopes', () => ({
  useSmartScopes: () => ({ setKoboSync: mockState.setKoboSync }),
}))

function makeSmartScope(overrides: Partial<SmartScope> = {}): SmartScope {
  return {
    id: 11,
    userId: 3,
    name: 'Book Club',
    icon: null,
    filter: null,
    defaultSort: [],
    isPublic: true,
    syncToKobo: false,
    koboSyncEnabled: false,
    isOwner: false,
    displayOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('useSmartScopeKoboSync', () => {
  beforeEach(() => {
    mockState.permissions = [Permission.KoboSync]
    mockState.isSuperuser = false
    mockState.setKoboSync.mockReset()
    mockState.setKoboSync.mockResolvedValue(makeSmartScope())
  })

  it('offers the opt-in to a viewer of a shared scope', async () => {
    const { useSmartScopeKoboSync } = await import('../useSmartScopeKoboSync')
    const { canToggle, isOwner, enabled } = useSmartScopeKoboSync(ref(makeSmartScope()))

    expect(canToggle.value).toBe(true)
    expect(isOwner.value).toBe(false)
    expect(enabled.value).toBe(false)
  })

  it('hides the opt-in from the owner, whose toggle lives in the editor', async () => {
    const { useSmartScopeKoboSync } = await import('../useSmartScopeKoboSync')
    const { canToggle, isOwner } = useSmartScopeKoboSync(ref(makeSmartScope({ isOwner: true, syncToKobo: true })))

    expect(canToggle.value).toBe(false)
    expect(isOwner.value).toBe(true)
  })

  it('hides the opt-in from users without Kobo sync permission', async () => {
    mockState.permissions = []
    const { useSmartScopeKoboSync } = await import('../useSmartScopeKoboSync')
    const { canToggle } = useSmartScopeKoboSync(ref(makeSmartScope()))

    expect(canToggle.value).toBe(false)
  })

  it('reports the viewer own opt-in, not the owner Kobo preference', async () => {
    const { useSmartScopeKoboSync } = await import('../useSmartScopeKoboSync')
    const { enabled } = useSmartScopeKoboSync(ref(makeSmartScope({ syncToKobo: true, koboSyncEnabled: false })))

    expect(enabled.value).toBe(false)
  })

  it('sends the inverted state and clears pending when it succeeds', async () => {
    const { useSmartScopeKoboSync } = await import('../useSmartScopeKoboSync')
    const scope = ref(makeSmartScope({ koboSyncEnabled: false }))
    const { toggle, pending } = useSmartScopeKoboSync(scope)

    const promise = toggle()
    expect(pending.value).toBe(true)

    await expect(promise).resolves.toBe(true)
    expect(mockState.setKoboSync).toHaveBeenCalledWith(11, true)
    expect(pending.value).toBe(false)
  })

  it('turns sync back off for a scope the viewer already opted into', async () => {
    const { useSmartScopeKoboSync } = await import('../useSmartScopeKoboSync')
    const { toggle } = useSmartScopeKoboSync(ref(makeSmartScope({ koboSyncEnabled: true })))

    await expect(toggle()).resolves.toBe(false)
    expect(mockState.setKoboSync).toHaveBeenCalledWith(11, false)
  })

  it('rethrows failures and clears pending so the control stays usable', async () => {
    mockState.setKoboSync.mockRejectedValue(new Error('HTTP 500'))
    const { useSmartScopeKoboSync } = await import('../useSmartScopeKoboSync')
    const { toggle, pending } = useSmartScopeKoboSync(ref(makeSmartScope()))

    await expect(toggle()).rejects.toThrow('HTTP 500')
    expect(pending.value).toBe(false)
  })

  it('does nothing for the owner or a missing scope instead of calling a request that would fail', async () => {
    const { useSmartScopeKoboSync } = await import('../useSmartScopeKoboSync')

    await expect(useSmartScopeKoboSync(ref(makeSmartScope({ isOwner: true }))).toggle()).resolves.toBeNull()
    await expect(useSmartScopeKoboSync(ref(null)).toggle()).resolves.toBeNull()
    expect(mockState.setKoboSync).not.toHaveBeenCalled()
  })

  it('ignores a second toggle while the first is still in flight', async () => {
    let resolveRequest!: (value: SmartScope) => void
    mockState.setKoboSync.mockReturnValueOnce(new Promise<SmartScope>((resolve) => (resolveRequest = resolve)))
    const { useSmartScopeKoboSync } = await import('../useSmartScopeKoboSync')
    const { toggle } = useSmartScopeKoboSync(ref(makeSmartScope()))

    const first = toggle()
    await expect(toggle()).resolves.toBeNull()

    resolveRequest(makeSmartScope({ koboSyncEnabled: true }))
    await first
    expect(mockState.setKoboSync).toHaveBeenCalledTimes(1)
  })
})
