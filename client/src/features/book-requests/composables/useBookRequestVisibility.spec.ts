import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useBookRequestVisibility } from './useBookRequestVisibility'

const state = vi.hoisted(() => ({
  user: null as { id: number; settings: { showBookRequests?: boolean } } | null,
  api: vi.fn<() => Promise<{ ok: boolean }>>(),
  fetchNotifications: vi.fn<() => Promise<void>>(),
  fetchUnreadCount: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/features/auth/composables/useAuth', () => ({ useAuth: () => ({ user: ref(state.user) }) }))
vi.mock('@/lib/api', () => ({ api: state.api }))
vi.mock('@/features/notifications/composables/useNotifications', () => ({
  useNotifications: () => ({ fetchNotifications: state.fetchNotifications, fetchUnreadCount: state.fetchUnreadCount }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 7, settings: {} }
  state.api.mockResolvedValue({ ok: true })
})

describe('useBookRequestVisibility', () => {
  it('shows Requests when the preference is absent, including older server responses', () => {
    expect(useBookRequestVisibility().showBookRequests.value).toBe(true)
  })

  it('saves only the new setting and updates the current account after success', async () => {
    const visibility = useBookRequestVisibility()
    expect(await visibility.setShowBookRequests(false)).toBe(true)
    expect(state.api).toHaveBeenCalledWith('/api/v1/users/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { showBookRequests: false } }),
    })
    expect(visibility.showBookRequests.value).toBe(false)
    expect(state.fetchNotifications).toHaveBeenCalledWith(true)
    expect(state.fetchUnreadCount).toHaveBeenCalled()
  })

  it('leaves visibility unchanged when the save fails', async () => {
    state.api.mockResolvedValue({ ok: false })
    const visibility = useBookRequestVisibility()
    expect(await visibility.setShowBookRequests(false)).toBe(false)
    expect(visibility.showBookRequests.value).toBe(true)
  })
})
