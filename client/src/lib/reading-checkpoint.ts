import type { BookReadingSession } from '@bookorbit/types'
import { getFormatGroup, READER_OPENABLE_FORMATS } from '@bookorbit/types'
import type { RouteLocationRaw } from 'vue-router'

export interface ReaderResumeTarget {
  checkpointPercentage: number | null
  cfi: string | null
  fraction: number | undefined
}

export function parseReadingCheckpointPercentage(value: unknown): number | null {
  if (typeof value !== 'string') return null

  const raw = value.trim()
  if (raw.length === 0) return null

  const percentage = Number(raw)
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null
  return percentage
}

export function resolveReaderResumeTarget(checkpointValue: unknown, savedCfi: string | null, savedPercentage: number): ReaderResumeTarget {
  const checkpointPercentage = parseReadingCheckpointPercentage(checkpointValue)
  if (checkpointPercentage !== null) {
    return {
      checkpointPercentage,
      cfi: null,
      fraction: checkpointPercentage / 100,
    }
  }

  return {
    checkpointPercentage: null,
    cfi: savedCfi,
    fraction: savedPercentage > 0 ? savedPercentage / 100 : undefined,
  }
}

export function buildReadingCheckpointRoute(bookId: number, session: BookReadingSession): RouteLocationRaw | null {
  const bookFileId = session.bookFileId
  const format = session.format?.trim().toLowerCase()
  const percentage = session.endProgress

  if (!Number.isInteger(bookId) || bookId <= 0) return null
  if (bookFileId === null || !Number.isInteger(bookFileId) || bookFileId <= 0) return null
  if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null
  if (!format || !READER_OPENABLE_FORMATS.has(format) || getFormatGroup(format) !== 'epub') return null

  return {
    name: 'reader',
    params: { bookId, fileId: bookFileId },
    query: { format, checkpoint: String(percentage) },
  }
}
