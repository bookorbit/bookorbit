import { beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchDiversityScore, fetchReadingDna, fetchReadingGoal } from '../dashboard-widget.api'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn<(...args: unknown[]) => unknown>() }))

vi.mock('@/lib/api', () => ({ api: apiMock }))

function respondWith(items: { type: string; data: unknown; failed: boolean }[]) {
  apiMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({ items }) })
}

describe('dashboard widget batching', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('collapses widgets mounting together into a single request', async () => {
    respondWith([
      { type: 'reading-goal', data: { goalBooks: 12 }, failed: false },
      { type: 'reading-dna', data: { archetype: 'explorer' }, failed: false },
      { type: 'diversity-score', data: { score: 80 }, failed: false },
    ])

    const [goal, dna, diversity] = await Promise.all([fetchReadingGoal(), fetchReadingDna(), fetchDiversityScore()])

    expect(apiMock).toHaveBeenCalledTimes(1)
    const [url, init] = apiMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/dashboard/widgets/batch')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ widgets: ['reading-goal', 'reading-dna', 'diversity-score'] }))

    expect(goal).toEqual({ goalBooks: 12 })
    expect(dna).toEqual({ archetype: 'explorer' })
    expect(diversity).toEqual({ score: 80 })
  })

  it('rejects only the widget the server could not build', async () => {
    respondWith([
      { type: 'reading-goal', data: { goalBooks: 12 }, failed: false },
      { type: 'reading-dna', data: null, failed: true },
    ])

    const results = await Promise.allSettled([fetchReadingGoal(), fetchReadingDna()])

    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('rejected')
  })

  it('rejects every widget in the batch when the request itself fails', async () => {
    apiMock.mockResolvedValue({ ok: false, status: 500 })

    const results = await Promise.allSettled([fetchReadingGoal(), fetchReadingDna()])

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
  })

  it('rejects a widget the server left out of the response', async () => {
    respondWith([{ type: 'reading-goal', data: { goalBooks: 12 }, failed: false }])

    const results = await Promise.allSettled([fetchReadingGoal(), fetchReadingDna()])

    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('rejected')
  })
})
