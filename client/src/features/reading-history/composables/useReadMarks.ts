import { reactive } from 'vue'
import type { ReadingHistoryMarks } from '@bookorbit/types'
import { fetchReadMarks } from '../api/reading-history.api'

type Entry = { status: 'loading' } | { status: 'ready'; marks: ReadingHistoryMarks } | { status: 'error' }

/** The highlights and journal entries of reads the reader opens, fetched once per read. */
export function useReadMarks() {
  const entries = reactive(new Map<number, Entry>())

  async function load(attemptId: number) {
    const existing = entries.get(attemptId)
    if (existing && existing.status !== 'error') return
    entries.set(attemptId, { status: 'loading' })
    try {
      entries.set(attemptId, { status: 'ready', marks: await fetchReadMarks(attemptId) })
    } catch {
      entries.set(attemptId, { status: 'error' })
    }
  }

  function get(attemptId: number): Entry | undefined {
    return entries.get(attemptId)
  }

  return { load, get }
}
