import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import type { AuthUser, WidgetConfig } from '@bookorbit/types'
import { WIDGET_TYPES } from '@bookorbit/types'

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: vi.fn<() => unknown>(),
}))

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => unknown>(),
}))

import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'
import { useDashboardWidgets } from './useDashboardWidgets'

const mockUseAuth = vi.mocked(useAuth)
const mockApi = vi.mocked(api)

function makeUser(settings: Record<string, unknown> = {}): AuthUser {
  return {
    id: 1,
    username: 'tester',
    name: 'Tester',
    email: undefined,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    settings,
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
  }
}

function setupAuth(settings: Record<string, unknown> = {}) {
  const userRef = ref<AuthUser | null>(makeUser(settings))
  const me = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  mockUseAuth.mockReturnValue({ user: userRef, me } as unknown as ReturnType<typeof useAuth>)
  return { userRef, me }
}

describe('useDashboardWidgets', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockApi.mockResolvedValue(new Response(null, { status: 200 }))
  })

  describe('widgets', () => {
    it('returns default widgets when user has no dashboardConfig', () => {
      setupAuth()
      const { widgets } = useDashboardWidgets()

      expect(widgets.value).toHaveLength(WIDGET_TYPES.length)
      expect(widgets.value[0]!.type).toBe('reading-streak')
      expect(widgets.value[1]!.type).toBe('currently-reading')
      expect(widgets.value[2]!.type).toBe('reading-goal')
      expect(widgets.value[3]!.type).toBe('reading-dna')
      expect(widgets.value[11]!.type).toBe('long-wait')
      expect(widgets.value[9]!.enabled).toBe(false)
      expect(widgets.value[10]!.enabled).toBe(false)
      expect(widgets.value[11]!.enabled).toBe(false)
    })

    it('returns user-saved widgets first, then appends any missing types', () => {
      const widgets: WidgetConfig[] = [
        { id: 'a', type: 'library-overview', enabled: true, order: 1 },
        { id: 'b', type: 'reading-goal', enabled: false, order: 2 },
      ]
      setupAuth({ dashboardConfig: { widgets } })
      const { widgets: result } = useDashboardWidgets()

      expect(result.value).toHaveLength(WIDGET_TYPES.length)
      expect(result.value[0]!.type).toBe('library-overview')
      expect(result.value[1]!.type).toBe('reading-goal')
      expect(result.value[1]!.enabled).toBe(false)
      // Missing types appended after saved ones
      const appendedTypes = result.value.slice(2).map((w) => w.type)
      expect(appendedTypes).toContain('currently-reading')
      expect(appendedTypes).toContain('reading-streak')
    })

    it('falls back to defaults when widgets array is empty', () => {
      setupAuth({ dashboardConfig: { widgets: [] } })
      const { widgets } = useDashboardWidgets()

      expect(widgets.value).toHaveLength(WIDGET_TYPES.length)
    })

    it('filters out widgets with invalid types and appends all valid defaults', () => {
      setupAuth({
        dashboardConfig: {
          widgets: [
            { id: '1', type: 'invalid-type', enabled: true, order: 1 },
            { id: '2', type: 'reading-goal', enabled: true, order: 2 },
          ],
        },
      })
      const { widgets } = useDashboardWidgets()

      // Only reading-goal is valid; the other types are appended
      expect(widgets.value).toHaveLength(WIDGET_TYPES.length)
      expect(widgets.value[0]!.type).toBe('reading-goal')
    })

    it('normalizes missing enabled field to true', () => {
      setupAuth({
        dashboardConfig: {
          widgets: [{ id: '1', type: 'reading-goal' }],
        },
      })
      const { widgets } = useDashboardWidgets()

      const goal = widgets.value.find((w) => w.type === 'reading-goal')!
      expect(goal.enabled).toBe(true)
    })
  })

  describe('enabledWidgets', () => {
    it('returns only enabled widgets sorted by order', () => {
      const widgetsList: WidgetConfig[] = WIDGET_TYPES.map((type, index) => ({
        id: String(index + 1),
        type,
        enabled: type === 'currently-reading' || type === 'reading-streak',
        order: index + 1,
      }))
      setupAuth({ dashboardConfig: { widgets: widgetsList } })
      const { enabledWidgets } = useDashboardWidgets()

      expect(enabledWidgets.value).toHaveLength(2)
      expect(enabledWidgets.value[0]!.type).toBe('reading-streak')
      expect(enabledWidgets.value[1]!.type).toBe('currently-reading')
    })
  })

  describe('readingGoal', () => {
    it('returns null when no reading goal is set', () => {
      setupAuth()
      const { readingGoal } = useDashboardWidgets()

      expect(readingGoal.value).toBeNull()
    })

    it('returns the reading goal when set', () => {
      setupAuth({ dashboardConfig: { readingGoal: 24 } })
      const { readingGoal } = useDashboardWidgets()

      expect(readingGoal.value).toBe(24)
    })
  })

  describe('saveWidgets', () => {
    it('calls PATCH /api/v1/users/me with read-modify-write pattern, appending missing types', async () => {
      const { me } = setupAuth({ dashboardConfig: { readingGoal: 12, widgets: [] } })
      const { saveWidgets } = useDashboardWidgets()

      const newWidgets: WidgetConfig[] = [{ id: '1', type: 'reading-goal', enabled: true, order: 1 }]
      await saveWidgets(newWidgets)

      expect(mockApi).toHaveBeenCalledWith('/api/v1/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: expect.any(String),
      })

      const body = JSON.parse((mockApi.mock.calls[0]![1] as { body: string }).body)
      expect(body.settings.dashboardConfig.readingGoal).toBe(12)
      expect(body.settings.dashboardConfig.widgets).toHaveLength(WIDGET_TYPES.length)
      expect(body.settings.dashboardConfig.widgets[0].type).toBe('reading-goal')
      expect(me).toHaveBeenCalled()
    })

    it('throws if API returns non-ok response', async () => {
      mockApi.mockResolvedValueOnce(new Response(null, { status: 500 }))
      setupAuth({})
      const { saveWidgets } = useDashboardWidgets()

      await expect(saveWidgets([])).rejects.toThrow('500')
    })
  })

  describe('saveReadingGoal', () => {
    it('preserves existing widgets when saving reading goal', async () => {
      const existingWidgets: WidgetConfig[] = [{ id: '1', type: 'reading-goal', enabled: true, order: 1 }]
      const { me } = setupAuth({ dashboardConfig: { widgets: existingWidgets } })
      const { saveReadingGoal } = useDashboardWidgets()

      await saveReadingGoal(30)

      const body = JSON.parse((mockApi.mock.calls[0]![1] as { body: string }).body)
      expect(body.settings.dashboardConfig.readingGoal).toBe(30)
      expect(body.settings.dashboardConfig.widgets).toEqual(existingWidgets)
      expect(me).toHaveBeenCalled()
    })

    it('throws if API returns non-ok response', async () => {
      mockApi.mockResolvedValueOnce(new Response(null, { status: 403 }))
      setupAuth({})
      const { saveReadingGoal } = useDashboardWidgets()

      await expect(saveReadingGoal(12)).rejects.toThrow('403')
    })
  })
})
