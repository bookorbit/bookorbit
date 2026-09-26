import { describe, expect, it, vi } from 'vitest'
import { runBoundedBatch } from './podcast-bulk'

describe('runBoundedBatch', () => {
  it('counts rejected items as failed instead of discarding them', async () => {
    const outcome = await runBoundedBatch([1, 2, 3, 4], 2, async (item) => {
      if (item % 2 === 0) throw new Error('nope')
      return true
    })

    expect(outcome).toEqual({ completed: 2, failed: 2 })
  })

  it('reports zero completed when every item fails', async () => {
    const outcome = await runBoundedBatch([1, 2, 3], 4, async () => {
      throw new Error('nope')
    })

    expect(outcome).toEqual({ completed: 0, failed: 3 })
  })

  it('separates skipped items from failures', async () => {
    const outcome = await runBoundedBatch([1, 2, 3], 2, async (item) => item === 1)

    expect(outcome).toEqual({ completed: 1, failed: 0 })
  })

  it('never runs more than the configured number of actions at once', async () => {
    let active = 0
    let peak = 0
    const action = vi.fn<() => Promise<boolean>>(async () => {
      active++
      peak = Math.max(peak, active)
      await Promise.resolve()
      active--
      return true
    })

    const outcome = await runBoundedBatch([1, 2, 3, 4, 5], 2, action)

    expect(peak).toBeLessThanOrEqual(2)
    expect(action).toHaveBeenCalledTimes(5)
    expect(outcome).toEqual({ completed: 5, failed: 0 })
  })
})
