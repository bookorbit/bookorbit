import type { Ref } from 'vue'
import type { AddedAtRecomputeJob } from '@bookorbit/types'
import { useLibraryJob } from './useLibraryJob'

const ERROR_KEYS: Record<string, string> = {
  ADDED_AT_SOURCE_IMPORTED: 'sourceImported',
  ADDED_AT_ALREADY_RUNNING: 'alreadyRunning',
  ADDED_AT_BUSY: 'busy',
}

export function useLibraryAddedAt(libraryId: Ref<number | null>) {
  return useLibraryJob<AddedAtRecomputeJob>(libraryId, {
    path: (id) => `/api/v1/libraries/${id}/recompute-added-at`,
    errorKeys: ERROR_KEYS,
    errorPrefix: 'library.creator.scanner.addedAt.errors.',
  })
}
