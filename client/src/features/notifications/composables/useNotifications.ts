import { computed, ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import { formatRelativeTime as formatLocaleRelativeTime } from '@/i18n/formatters'
import { api, getAccessToken } from '@/lib/api'
import type { AchievementRarity, NotificationItem, NotificationPage } from '@bookorbit/types'
import { NotificationType } from '@bookorbit/types'
import { showAchievementToast } from '@/features/achievements/utils/achievementToast'

const PAGE_SIZE = 20
const ACHIEVEMENT_RARITIES: readonly AchievementRarity[] = ['common', 'rare', 'epic', 'legendary']

const notifications = ref<NotificationItem[]>([])
const unreadCount = ref(0)
const total = ref(0)
const loading = ref(false)
const socketConnected = ref(true)
let socket: Socket | null = null
let fetchPromise: Promise<void> | null = null
let loaded = false
let offset = 0

const hasMore = computed(() => notifications.value.length < total.value)

function isAchievementRarity(value: unknown): value is AchievementRarity {
  return typeof value === 'string' && ACHIEVEMENT_RARITIES.includes(value as AchievementRarity)
}

function resolveAchievementToastPayload(item: NotificationItem): { name: string; rarity: AchievementRarity } {
  const meta = item.meta
  const metaRarity = meta?.['rarity']
  const metaName = meta?.['achievementName']

  const rarity = isAchievementRarity(metaRarity) ? metaRarity : 'common'
  const messageName = item.message?.trim() ?? ''
  const fallbackName = typeof metaName === 'string' ? metaName.trim() : ''

  return {
    name: messageName || fallbackName || 'New achievement',
    rarity,
  }
}

function requestNotifications(reset: boolean, markLoading: boolean): Promise<void> {
  if (fetchPromise) return fetchPromise
  if (markLoading) loading.value = true
  if (reset) offset = 0

  fetchPromise = api(`/api/v1/notifications?limit=${PAGE_SIZE}&offset=${offset}`)
    .then(async (res) => {
      if (res.ok) {
        const data: NotificationPage = await res.json()
        if (reset) {
          notifications.value = data.items
        } else {
          notifications.value = [...notifications.value, ...data.items]
        }
        total.value = data.total
        offset = notifications.value.length
        loaded = true
      }
    })
    .catch(() => {})
    .finally(() => {
      if (markLoading) loading.value = false
      fetchPromise = null
    })
  return fetchPromise
}

function requestUnreadCount(): Promise<void> {
  return api('/api/v1/notifications/unread-count')
    .then(async (res) => {
      if (res.ok) {
        const data = await res.json()
        unreadCount.value = data.count
      }
    })
    .catch(() => {})
}

function getSocket(): Socket {
  if (!socket) {
    socket = io('/notifications', {
      auth: (cb: (data: object) => void) => cb({ token: getAccessToken() }),
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    })

    socket.on('notification:new', (item: NotificationItem) => {
      notifications.value = [item, ...notifications.value]
      total.value++
      unreadCount.value++

      if (item.type === NotificationType.AchievementUnlocked) {
        const { name, rarity } = resolveAchievementToastPayload(item)
        showAchievementToast(name, rarity)
      }
    })

    socket.on('notification:unread-count', (data: { count: number }) => {
      unreadCount.value = data.count
    })

    socket.on('notification:read', (data: { id: number }) => {
      const item = notifications.value.find((n) => n.id === data.id)
      if (item && !item.read) {
        item.read = true
      }
    })

    socket.on('notification:dismissed', (data: { id: number }) => {
      notifications.value = notifications.value.filter((n) => n.id !== data.id)
      total.value = Math.max(0, total.value - 1)
    })

    socket.on('notification:all-read', () => {
      notifications.value.forEach((n) => (n.read = true))
      unreadCount.value = 0
    })

    socket.on('notification:cleared', () => {
      notifications.value = []
      total.value = 0
      unreadCount.value = 0
    })

    socket.on('connect', () => {
      socketConnected.value = true
      requestNotifications(true, false)
      requestUnreadCount()
    })

    socket.on('disconnect', () => {
      socketConnected.value = false
    })
  }
  return socket
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return formatLocaleRelativeTime(0, 'second')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return formatLocaleRelativeTime(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return formatLocaleRelativeTime(-hours, 'hour')
  const days = Math.floor(hours / 24)
  if (days < 14) return formatLocaleRelativeTime(-days, 'day')
  const weeks = Math.floor(days / 7)
  return formatLocaleRelativeTime(-weeks, 'week')
}

export function useNotifications() {
  async function fetchNotifications(reset = false): Promise<void> {
    if (!reset && loaded && !hasMore.value) return
    return requestNotifications(reset, true)
  }

  async function fetchUnreadCount(): Promise<void> {
    return requestUnreadCount()
  }

  async function markAsRead(id: number): Promise<void> {
    const item = notifications.value.find((n) => n.id === id)
    if (!item || item.read) return
    item.read = true
    unreadCount.value = Math.max(0, unreadCount.value - 1)
    try {
      const res = await api(`/api/v1/notifications/${id}/read`, { method: 'PATCH' })
      if (!res.ok) {
        item.read = false
        unreadCount.value++
      }
    } catch {
      item.read = false
      unreadCount.value++
    }
  }

  async function markAllAsRead(): Promise<void> {
    const previousStates = notifications.value.map((n) => ({ id: n.id, read: n.read }))
    const previousUnread = unreadCount.value
    notifications.value.forEach((n) => (n.read = true))
    unreadCount.value = 0
    try {
      const res = await api('/api/v1/notifications/read-all', { method: 'PATCH' })
      if (!res.ok) {
        previousStates.forEach((s) => {
          const item = notifications.value.find((n) => n.id === s.id)
          if (item) item.read = s.read
        })
        unreadCount.value = previousUnread
      }
    } catch {
      previousStates.forEach((s) => {
        const item = notifications.value.find((n) => n.id === s.id)
        if (item) item.read = s.read
      })
      unreadCount.value = previousUnread
    }
  }

  async function dismiss(id: number): Promise<void> {
    const idx = notifications.value.findIndex((n) => n.id === id)
    if (idx === -1) return
    const removed = notifications.value[idx]!
    notifications.value = notifications.value.filter((n) => n.id !== id)
    total.value = Math.max(0, total.value - 1)
    if (!removed.read) unreadCount.value = Math.max(0, unreadCount.value - 1)
    try {
      const res = await api(`/api/v1/notifications/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        notifications.value.splice(idx, 0, removed)
        total.value++
        if (!removed.read) unreadCount.value++
      }
    } catch {
      notifications.value.splice(idx, 0, removed)
      total.value++
      if (!removed.read) unreadCount.value++
    }
  }

  async function clearAll(): Promise<void> {
    const previousNotifications = [...notifications.value]
    const previousTotal = total.value
    const previousUnread = unreadCount.value
    notifications.value = []
    total.value = 0
    unreadCount.value = 0
    try {
      const res = await api('/api/v1/notifications', { method: 'DELETE' })
      if (!res.ok) {
        notifications.value = previousNotifications
        total.value = previousTotal
        unreadCount.value = previousUnread
      }
    } catch {
      notifications.value = previousNotifications
      total.value = previousTotal
      unreadCount.value = previousUnread
    }
  }

  function subscribe() {
    getSocket()
  }

  function disconnect() {
    if (socket) {
      socket.disconnect()
      socket = null
    }
  }

  return {
    notifications,
    unreadCount,
    total,
    loading,
    hasMore,
    socketConnected,
    fetchNotifications,
    fetchUnreadCount,
    markAsRead,
    markAllAsRead,
    dismiss,
    clearAll,
    subscribe,
    disconnect,
    formatRelativeTime,
  }
}
