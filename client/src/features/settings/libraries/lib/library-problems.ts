import type { LibraryLastScan } from '@bookorbit/types'

/** Something about a library's last scan that needs a person, worst first. */
export type LibraryProblem = { kind: 'never' } | { kind: 'failed'; scan: LibraryLastScan }

/**
 * Reads the problem off the overview's last scan. A library that is scanning right now has none: the
 * running scan is about to replace whatever the last one said.
 */
export function libraryProblem(lastScan: LibraryLastScan | null | undefined, scanning: boolean): LibraryProblem | null {
  if (scanning) return null
  if (!lastScan) return { kind: 'never' }
  if (lastScan.status === 'failed') return { kind: 'failed', scan: lastScan }
  return null
}
