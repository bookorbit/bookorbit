import { describe, expect, it } from 'vitest'
import type { ReadingAttempt } from '@bookorbit/types'
import { compareReadingOrder } from './reading-attempt-order'

function attempt(id: number, startedOn: string | null, endedOn: string | null): ReadingAttempt {
  return { id, bookId: 7, startedOn, endedOn, outcome: 'completed', origin: 'bookorbit' } as ReadingAttempt
}

describe('compareReadingOrder', () => {
  it('puts an undated earlier read before the dated reads recorded before it', () => {
    const first = attempt(15, '2026-08-17', '2026-10-17')
    const earlier = attempt(427, null, null)
    const reread = attempt(428, '2026-10-17', '2026-10-17')

    expect([reread, earlier, first].sort(compareReadingOrder).map((read) => read.id)).toEqual([427, 15, 428])
  })

  it('places a past read added later by its dates', () => {
    const current = attempt(30, '2026-10-01', null)
    const past = attempt(31, '2019-03-01', '2019-03-20')

    expect([current, past].sort(compareReadingOrder).map((read) => read.id)).toEqual([31, 30])
  })

  it('orders a read that records only its end by that day, and same-day reads by id', () => {
    const ended = attempt(5, null, '2024-04-05')
    const started = attempt(6, '2024-04-05', null)
    const later = attempt(4, '2024-05-01', null)

    expect([later, started, ended].sort(compareReadingOrder).map((read) => read.id)).toEqual([5, 6, 4])
  })
})
