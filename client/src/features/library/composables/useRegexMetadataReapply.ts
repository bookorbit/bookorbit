import type { Ref } from 'vue'
import type { RegexMetadataReapplyJob } from '@bookorbit/types'
import { useLibraryJob } from './useLibraryJob'

const ERROR_KEYS: Record<string, string> = {
  REGEX_METADATA_NOT_CONFIGURED: 'notConfigured',
  REGEX_REAPPLY_ALREADY_RUNNING: 'alreadyRunning',
  REGEX_REAPPLY_BUSY: 'busy',
}

export function useRegexMetadataReapply(libraryId: Ref<number | null>) {
  return useLibraryJob<RegexMetadataReapplyJob>(libraryId, {
    path: (id) => `/api/v1/scanner/libraries/${id}/reapply-regex-metadata`,
    errorKeys: ERROR_KEYS,
    errorPrefix: 'library.creator.metadata.regex.reapply.errors.',
  })
}
