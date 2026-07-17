import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ReadingAttemptHistory from '../ReadingAttemptHistory.vue'

type MockResponse = { ok: boolean; json: () => Promise<unknown> }
const api = vi.fn<(...args: unknown[]) => Promise<MockResponse>>()
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => api(...args) }))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }))

function response(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) })
}

describe('ReadingAttemptHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.mockReturnValue(
      response({
        items: [
          {
            id: 1,
            bookId: 10,
            startedOn: '2024-01-01',
            endedOn: '2024-01-12',
            outcome: 'completed',
            origin: 'manual',
            externalProvider: null,
            externalId: null,
            totalSessions: 4,
            totalSeconds: 3600,
            createdAt: '2024-01-12T00:00:00.000Z',
            updatedAt: '2024-01-12T00:00:00.000Z',
          },
        ],
        page: 1,
        pageSize: 10,
        total: 1,
      }),
    )
  })

  it('loads and displays paginated attempt history', async () => {
    const wrapper = mount(ReadingAttemptHistory, { props: { bookId: 10 } })
    await flushPromises()

    expect(api).toHaveBeenCalledWith('/api/v1/books/10/reading-attempts?page=1&pageSize=10')
    expect(wrapper.text()).toContain('Completed')
    expect(wrapper.text()).toContain('4 sessions')
  })

  it('starts a reread with progress reset enabled by default', async () => {
    const wrapper = mount(ReadingAttemptHistory, { props: { bookId: 10 } })
    await flushPromises()
    api.mockReturnValueOnce(
      response({ status: 'rereading', source: 'manual', startedAt: '2026-07-12', finishedAt: null, updatedAt: '2026-07-12T00:00:00Z' }),
    )
    api.mockReturnValueOnce(response({ items: [], page: 1, pageSize: 10, total: 0 }))

    const initialStartButton = wrapper.findAll('button').find((button) => button.text() === 'Start reread')!
    await initialStartButton.trigger('click')
    const startButton = wrapper
      .findAll('button')
      .filter((button) => button.text() === 'Start reread')
      .at(-1)!
    await startButton.trigger('click')
    await flushPromises()

    expect(api).toHaveBeenCalledWith(
      '/api/v1/books/10/reading-attempts/start-reread',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ resetProgress: true }) }),
    )
    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ status: 'rereading' })
  })
})
