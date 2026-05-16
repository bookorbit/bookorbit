import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'

vi.mock('@/lib/api', () => ({
  api: vi.fn<() => Promise<Response>>(),
}))

import { api } from '@/lib/api'
import { useAchievements } from '../composables/useAchievements'

const mockApi = vi.mocked(api)

function mockResponse(data: unknown) {
  return { ok: true, json: () => Promise.resolve(data) } as Response
}

const MOCK_CATALOGUE = {
  categories: [
    {
      key: 'reading',
      label: 'Reading',
      earnedCount: 2,
      totalCount: 10,
      achievements: [
        {
          key: 'books_finished_1',
          groupKey: 'books_finished',
          tier: 1,
          category: 'reading',
          name: 'First Steps',
          description: 'Finish 1 book',
          iconName: 'book-open',
          rarity: 'common',
          threshold: 1,
          hidden: false,
          sortOrder: 1,
          earned: true,
          awardedAt: '2026-01-01T00:00:00Z',
          context: null,
          currentProgress: null,
        },
      ],
    },
  ],
  totalEarned: 2,
  totalAvailable: 49,
}

function mountComposable() {
  let result!: ReturnType<typeof useAchievements>
  mount(
    defineComponent({
      setup() {
        result = useAchievements()
        return () => null
      },
    }),
  )
  return result
}

describe('useAchievements', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fetches achievements on mount', async () => {
    mockApi.mockResolvedValue(mockResponse(MOCK_CATALOGUE))
    const { categories, totalEarned, totalAvailable, loading } = mountComposable()

    expect(loading.value).toBe(true)
    await flushPromises()
    expect(loading.value).toBe(false)
    expect(categories.value).toHaveLength(1)
    expect(totalEarned.value).toBe(2)
    expect(totalAvailable.value).toBe(49)
  })

  it('sets error on failure', async () => {
    mockApi.mockResolvedValue({ ok: false } as Response)
    const { error, loading } = mountComposable()

    await flushPromises()
    expect(loading.value).toBe(false)
    expect(error.value).toBe(true)
  })

  it('reload refetches data', async () => {
    mockApi.mockResolvedValue(mockResponse(MOCK_CATALOGUE))
    const { reload, totalEarned } = mountComposable()

    await flushPromises()
    expect(totalEarned.value).toBe(2)

    mockApi.mockResolvedValue(mockResponse({ ...MOCK_CATALOGUE, totalEarned: 5 }))
    await reload()
    expect(totalEarned.value).toBe(5)
  })
})
