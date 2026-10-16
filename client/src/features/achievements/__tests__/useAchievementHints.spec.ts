import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(),
}))

import { api } from '@/lib/api'
import { useAchievementHints } from '../composables/useAchievementHints'

const mockApi = vi.mocked(api)

function respond(data: unknown): Response {
  return { ok: true, json: () => Promise.resolve(data) } as Response
}

function mountComposable() {
  let result!: ReturnType<typeof useAchievementHints>
  mount(
    defineComponent({
      setup() {
        result = useAchievementHints()
        return () => null
      },
    }),
  )
  return result
}

const PACE = { key: 'hours_read_3', kind: 'reading_pace', values: { hours: 44, days: 30, remaining: 26, etaDays: 18 } }
const UNRATED = { key: 'critic_2', kind: 'unrated_finished', count: 45, bookIds: [1], values: {} }

describe('useAchievementHints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches hints on mount from their own route and keys them by achievement', async () => {
    mockApi.mockResolvedValue(respond({ hints: [PACE, UNRATED] }))
    const { hints } = mountComposable()

    expect(hints.value.size).toBe(0)
    await flushPromises()
    expect(mockApi).toHaveBeenCalledWith('/api/v1/achievements/hints')
    expect([...hints.value.keys()]).toEqual(['hours_read_3', 'critic_2'])
    expect(hints.value.get('critic_2')).toEqual(UNRATED)
  })

  it('keeps the hints it has while a refetch is in flight and when one fails', async () => {
    mockApi.mockResolvedValue(respond({ hints: [PACE] }))
    const { hints, reload } = mountComposable()
    await flushPromises()

    let resolveNext!: (response: Response) => void
    mockApi.mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)))
    const pending = reload()
    expect(hints.value.get('hours_read_3')).toEqual(PACE)
    resolveNext({ ok: false } as Response)
    await pending
    expect(hints.value.get('hours_read_3')).toEqual(PACE)

    mockApi.mockRejectedValueOnce(new Error('offline'))
    await reload()
    expect(hints.value.size).toBe(1)
  })

  it('treats a response without a hint list as no hints', async () => {
    mockApi.mockResolvedValue(respond({}))
    const { hints } = mountComposable()
    await flushPromises()
    expect(hints.value.size).toBe(0)
  })
})
