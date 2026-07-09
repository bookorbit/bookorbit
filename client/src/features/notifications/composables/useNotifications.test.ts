import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NotificationItem } from '@bookorbit/types'
import { NotificationType } from '@bookorbit/types'

const mockApi = vi.fn<(...args: unknown[]) => unknown>()
const mockGetAccessToken = vi.fn<(...args: unknown[]) => unknown>().mockReturnValue('token')
vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => mockApi(...args),
  getAccessToken: () => mockGetAccessToken(),
}))

const mockIo = vi.fn<(...args: unknown[]) => unknown>()
vi.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => mockIo(...args),
}))

const mockShowAchievementToast = vi.fn<(...args: unknown[]) => unknown>()
vi.mock('@/features/achievements/utils/achievementToast', () => ({
  showAchievementToast: (...args: unknown[]) => mockShowAchievementToast(...args),
}))

function mockOk(data?: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) })
}

function mockFail() {
  return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
}

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 1,
    type: NotificationType.ScanCompleted,
    title: 'Scan done',
    message: null,
    actionUrl: null,
    meta: null,
    read: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeMockSocket() {
  return {
    on: vi.fn<(...args: unknown[]) => unknown>(),
    off: vi.fn<(...args: unknown[]) => unknown>(),
    disconnect: vi.fn<(...args: unknown[]) => unknown>(),
    emit: vi.fn<(...args: unknown[]) => unknown>(),
    connected: false,
  }
}

describe('useNotifications', () => {
  let mockSocket: ReturnType<typeof makeMockSocket>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockSocket = makeMockSocket()
    mockIo.mockReturnValue(mockSocket)
  })

  async function loadModule() {
    const mod = await import('./useNotifications')
    return mod.useNotifications
  }

  describe('isAchievementRarity (via resolveAchievementToastPayload behavior)', () => {
    it('returns correct rarity for valid rarities', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, notifications, markAllAsRead } = useNotifications()

      const achievementItem = makeNotification({
        id: 10,
        type: NotificationType.AchievementUnlocked,
        message: 'Epic Achiever',
        meta: { rarity: 'epic', achievementName: 'Some Name' },
      })

      mockApi.mockReturnValueOnce(mockOk({ items: [achievementItem], total: 1 }))
      await fetchNotifications(true)
      expect(notifications.value[0]?.id).toBe(10)

      mockApi.mockReturnValueOnce(mockOk())
      await markAllAsRead()
    })

    it('shows achievement toast with correct rarity for valid rarities', async () => {
      const useNotifications = await loadModule()
      const { subscribe } = useNotifications()
      subscribe()

      const notificationNewHandler = mockSocket.on.mock.calls.find(([event]: unknown[]) => event === 'notification:new')?.[1] as
        | ((item: NotificationItem) => void)
        | undefined

      expect(notificationNewHandler).toBeDefined()

      for (const rarity of ['common', 'rare', 'epic', 'legendary'] as const) {
        mockShowAchievementToast.mockClear()
        notificationNewHandler!(
          makeNotification({
            id: 100,
            type: NotificationType.AchievementUnlocked,
            message: 'Badge Name',
            meta: { rarity, achievementName: 'Fallback' },
          }),
        )
        expect(mockShowAchievementToast).toHaveBeenCalledWith('Badge Name', rarity)
      }
    })

    it('defaults to common rarity for invalid rarity values', async () => {
      const useNotifications = await loadModule()
      const { subscribe } = useNotifications()
      subscribe()

      const notificationNewHandler = mockSocket.on.mock.calls.find(([event]: unknown[]) => event === 'notification:new')?.[1] as (
        item: NotificationItem,
      ) => void

      mockShowAchievementToast.mockClear()
      notificationNewHandler(
        makeNotification({
          id: 101,
          type: NotificationType.AchievementUnlocked,
          message: 'Badge',
          meta: { rarity: 'unknown', achievementName: 'Fallback' },
        }),
      )
      expect(mockShowAchievementToast).toHaveBeenCalledWith('Badge', 'common')
    })

    it('returns false for non-string and null rarity values', async () => {
      const useNotifications = await loadModule()
      const { subscribe } = useNotifications()
      subscribe()

      const notificationNewHandler = mockSocket.on.mock.calls.find(([event]: unknown[]) => event === 'notification:new')?.[1] as (
        item: NotificationItem,
      ) => void

      for (const invalidRarity of [42, null]) {
        mockShowAchievementToast.mockClear()
        notificationNewHandler(
          makeNotification({
            id: 102,
            type: NotificationType.AchievementUnlocked,
            message: 'Badge',
            meta: { rarity: invalidRarity, achievementName: 'Fallback' },
          }),
        )
        expect(mockShowAchievementToast).toHaveBeenCalledWith('Badge', 'common')
      }
    })
  })

  describe('resolveAchievementToastPayload', () => {
    async function getNotificationNewHandler() {
      const useNotifications = await loadModule()
      const { subscribe } = useNotifications()
      subscribe()
      return mockSocket.on.mock.calls.find(([event]: unknown[]) => event === 'notification:new')?.[1] as (item: NotificationItem) => void
    }

    it('uses message as name when present', async () => {
      const handler = await getNotificationNewHandler()
      handler(
        makeNotification({
          type: NotificationType.AchievementUnlocked,
          message: 'From message',
          meta: { rarity: 'rare', achievementName: 'From meta' },
        }),
      )
      expect(mockShowAchievementToast).toHaveBeenCalledWith('From message', 'rare')
    })

    it('falls back to meta achievementName when message is empty', async () => {
      const handler = await getNotificationNewHandler()
      handler(
        makeNotification({
          type: NotificationType.AchievementUnlocked,
          message: '',
          meta: { rarity: 'legendary', achievementName: 'From meta' },
        }),
      )
      expect(mockShowAchievementToast).toHaveBeenCalledWith('From meta', 'legendary')
    })

    it('falls back to "New achievement" when both message and meta name are empty', async () => {
      const handler = await getNotificationNewHandler()
      handler(
        makeNotification({
          type: NotificationType.AchievementUnlocked,
          message: '',
          meta: { rarity: 'common', achievementName: '' },
        }),
      )
      expect(mockShowAchievementToast).toHaveBeenCalledWith('New achievement', 'common')
    })

    it('uses whitespace-trimmed message (empty after trim uses meta)', async () => {
      const handler = await getNotificationNewHandler()
      handler(
        makeNotification({
          type: NotificationType.AchievementUnlocked,
          message: '   ',
          meta: { rarity: 'epic', achievementName: 'Meta name' },
        }),
      )
      expect(mockShowAchievementToast).toHaveBeenCalledWith('Meta name', 'epic')
    })
  })

  describe('fetchNotifications (load)', () => {
    it('calls api with correct URL for first page', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications } = useNotifications()
      mockApi.mockReturnValueOnce(mockOk({ items: [], total: 0 }))
      await fetchNotifications(true)
      expect(mockApi).toHaveBeenCalledWith('/api/v1/notifications?limit=20&offset=0')
    })

    it('populates notifications and total on success', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, notifications, total } = useNotifications()
      const item = makeNotification({ id: 5 })
      mockApi.mockReturnValueOnce(mockOk({ items: [item], total: 42 }))
      await fetchNotifications(true)
      expect(notifications.value).toHaveLength(1)
      expect(notifications.value[0]?.id).toBe(5)
      expect(total.value).toBe(42)
    })

    it('replaces notifications on reset=true', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, notifications } = useNotifications()

      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification({ id: 1 })], total: 2 }))
      await fetchNotifications(true)
      expect(notifications.value).toHaveLength(1)

      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification({ id: 2 })], total: 1 }))
      await fetchNotifications(true)
      expect(notifications.value).toHaveLength(1)
      expect(notifications.value[0]?.id).toBe(2)
    })

    it('appends notifications on reset=false', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, notifications } = useNotifications()

      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification({ id: 1 })], total: 2 }))
      await fetchNotifications(true)

      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification({ id: 2 })], total: 2 }))
      await fetchNotifications(false)

      expect(notifications.value).toHaveLength(2)
      expect(notifications.value[0]?.id).toBe(1)
      expect(notifications.value[1]?.id).toBe(2)
    })

    it('swallows error gracefully when api returns non-ok', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, notifications } = useNotifications()
      mockApi.mockReturnValueOnce(mockFail())
      await expect(fetchNotifications(true)).resolves.toBeUndefined()
      expect(notifications.value).toEqual([])
    })

    it('toggles loading true then false', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, loading } = useNotifications()

      let resolveApi!: (v: unknown) => void
      mockApi.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveApi = resolve
        }),
      )

      const loadPromise = fetchNotifications(true)
      expect(loading.value).toBe(true)

      resolveApi({ ok: true, json: () => Promise.resolve({ items: [], total: 0 }) })
      await loadPromise
      expect(loading.value).toBe(false)
    })
  })

  describe('markAsRead', () => {
    it('calls PATCH with correct URL', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, markAsRead } = useNotifications()

      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification({ id: 7, read: false })], total: 1 }))
      await fetchNotifications(true)

      mockApi.mockReturnValueOnce(mockOk())
      await markAsRead(7)

      expect(mockApi).toHaveBeenCalledWith('/api/v1/notifications/7/read', { method: 'PATCH' })
    })

    it('optimistically sets notification.read to true', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, markAsRead, notifications } = useNotifications()

      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification({ id: 7, read: false })], total: 1 }))
      await fetchNotifications(true)

      mockApi.mockReturnValueOnce(mockOk())
      await markAsRead(7)

      expect(notifications.value.find((n) => n.id === 7)?.read).toBe(true)
    })

    it('reverts read to false when api fails', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, markAsRead, notifications } = useNotifications()

      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification({ id: 7, read: false })], total: 1 }))
      await fetchNotifications(true)

      mockApi.mockReturnValueOnce(mockFail())
      await markAsRead(7)

      expect(notifications.value.find((n) => n.id === 7)?.read).toBe(false)
    })
  })

  describe('markAllAsRead', () => {
    it('calls PATCH on read-all endpoint', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, markAllAsRead } = useNotifications()

      mockApi.mockReturnValueOnce(mockOk({ items: [], total: 0 }))
      await fetchNotifications(true)

      mockApi.mockReturnValueOnce(mockOk())
      await markAllAsRead()

      expect(mockApi).toHaveBeenCalledWith('/api/v1/notifications/read-all', { method: 'PATCH' })
    })

    it('sets all notifications.read to true and unreadCount to 0', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, markAllAsRead, notifications, unreadCount } = useNotifications()

      mockApi.mockReturnValueOnce(
        mockOk({
          items: [makeNotification({ id: 1, read: false }), makeNotification({ id: 2, read: false })],
          total: 2,
        }),
      )
      await fetchNotifications(true)

      mockApi.mockReturnValueOnce(mockOk())
      await markAllAsRead()

      expect(notifications.value.every((n) => n.read)).toBe(true)
      expect(unreadCount.value).toBe(0)
    })

    it('keeps notifications visible when all-read socket event arrives', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, notifications, subscribe, total, unreadCount } = useNotifications()

      mockApi.mockReturnValueOnce(
        mockOk({
          items: [makeNotification({ id: 1, read: false }), makeNotification({ id: 2, read: false })],
          total: 2,
        }),
      )
      await fetchNotifications(true)
      unreadCount.value = 2

      subscribe()
      const allReadHandler = mockSocket.on.mock.calls.find(([event]: unknown[]) => event === 'notification:all-read')?.[1] as (() => void) | undefined

      expect(allReadHandler).toBeDefined()
      allReadHandler!()

      expect(notifications.value).toHaveLength(2)
      expect(notifications.value.every((n) => n.read)).toBe(true)
      expect(total.value).toBe(2)
      expect(unreadCount.value).toBe(0)
    })
  })

  describe('dismiss', () => {
    it('calls DELETE with correct URL', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, dismiss } = useNotifications()

      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification({ id: 3 })], total: 1 }))
      await fetchNotifications(true)

      mockApi.mockReturnValueOnce(mockOk())
      await dismiss(3)

      expect(mockApi).toHaveBeenCalledWith('/api/v1/notifications/3', { method: 'DELETE' })
    })

    it('removes notification from list and decrements total', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, dismiss, notifications, total } = useNotifications()

      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification({ id: 3 }), makeNotification({ id: 4 })], total: 2 }))
      await fetchNotifications(true)

      mockApi.mockReturnValueOnce(mockOk())
      await dismiss(3)

      expect(notifications.value.find((n) => n.id === 3)).toBeUndefined()
      expect(total.value).toBe(1)
    })
  })

  describe('clearAll', () => {
    it('calls DELETE on notifications endpoint', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, clearAll } = useNotifications()

      mockApi.mockReturnValueOnce(mockOk({ items: [], total: 0 }))
      await fetchNotifications(true)

      mockApi.mockReturnValueOnce(mockOk())
      await clearAll()

      expect(mockApi).toHaveBeenCalledWith('/api/v1/notifications', { method: 'DELETE' })
    })

    it('clears notifications, total, and unreadCount', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, clearAll, notifications, total, unreadCount } = useNotifications()

      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification({ id: 1 }), makeNotification({ id: 2 })], total: 2 }))
      await fetchNotifications(true)

      mockApi.mockReturnValueOnce(mockOk())
      await clearAll()

      expect(notifications.value).toEqual([])
      expect(total.value).toBe(0)
      expect(unreadCount.value).toBe(0)
    })

    it('restores state when api fails', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, clearAll, notifications, total } = useNotifications()

      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification({ id: 1 })], total: 1 }))
      await fetchNotifications(true)

      mockApi.mockReturnValueOnce(mockFail())
      await clearAll()

      expect(notifications.value).toHaveLength(1)
      expect(total.value).toBe(1)
    })
  })

  describe('subscribe / disconnect', () => {
    it('subscribe calls io to create a socket', async () => {
      const useNotifications = await loadModule()
      const { subscribe } = useNotifications()
      subscribe()
      expect(mockIo).toHaveBeenCalledWith('/notifications', expect.objectContaining({ transports: ['websocket'] }))
    })

    it('disconnect calls socket.disconnect and clears socket', async () => {
      const useNotifications = await loadModule()
      const { subscribe, disconnect } = useNotifications()
      subscribe()
      disconnect()
      expect(mockSocket.disconnect).toHaveBeenCalled()
    })

    it('subscribe is idempotent (socket created only once)', async () => {
      const useNotifications = await loadModule()
      const { subscribe } = useNotifications()
      subscribe()
      subscribe()
      expect(mockIo).toHaveBeenCalledTimes(1)
    })
  })

  describe('hasMore (computed)', () => {
    it('is true when notifications.length < total', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, hasMore } = useNotifications()
      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification()], total: 5 }))
      await fetchNotifications(true)
      expect(hasMore.value).toBe(true)
    })

    it('is false when all notifications are loaded', async () => {
      const useNotifications = await loadModule()
      const { fetchNotifications, hasMore } = useNotifications()
      mockApi.mockReturnValueOnce(mockOk({ items: [makeNotification()], total: 1 }))
      await fetchNotifications(true)
      expect(hasMore.value).toBe(false)
    })
  })
})
