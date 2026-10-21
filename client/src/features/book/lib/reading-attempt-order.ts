import type { ReadingAttempt } from '@bookorbit/types'

/**
 * Orders reads as they happened: by the day each began, or ended when that is all it records. An
 * undated read stands for one before BookOrbit kept history, such as the earlier read a reread
 * implies, so it comes first. Ordered by id, that read, recorded at the reread, was numbered as the
 * newest and shown above the read it came before.
 */
export function compareReadingOrder(left: ReadingAttempt, right: ReadingAttempt): number {
  const leftDay = left.startedOn ?? left.endedOn ?? ''
  const rightDay = right.startedOn ?? right.endedOn ?? ''
  if (leftDay !== rightDay) return leftDay < rightDay ? -1 : 1
  return left.id - right.id
}
