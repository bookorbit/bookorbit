import {
  EXAMPLE_PATTERN_METADATA,
  resolveDownloadFilename,
  resolveUploadPath,
  type PathResolverOptions,
  DEFAULT_DOWNLOAD_PATTERN,
} from '@bookorbit/types'

/**
 * The optional-segment grammar only earns its keep when metadata is missing, and the old
 * page never showed that case. Each variant strips one field from the sample book so the
 * preview can answer "what happens to a book without a series?" without leaving the page.
 */
export type PreviewCaseId = 'complete' | 'noSeries' | 'noYear' | 'noAuthor'

export interface PreviewCase {
  id: PreviewCaseId
  metadata: Record<string, string>
}

/** The sample book with some fields blanked, for previewing what a pattern drops. */
export const metadataWithout = (...fields: string[]): Record<string, string> => {
  const metadata = { ...EXAMPLE_PATTERN_METADATA }
  for (const field of fields) metadata[field] = ''
  return metadata
}

export const PREVIEW_CASES: PreviewCase[] = [
  { id: 'complete', metadata: { ...EXAMPLE_PATTERN_METADATA } },
  { id: 'noSeries', metadata: metadataWithout('series', 'seriesIndex') },
  { id: 'noYear', metadata: metadataWithout('year') },
  { id: 'noAuthor', metadata: metadataWithout('authors') },
]

/** Cases other than the complete one, which the panels render as the headline result. */
export const MISSING_METADATA_CASES = PREVIEW_CASES.filter((previewCase) => previewCase.id !== 'complete')

export const PREVIEW_EXTENSION = 'epub'

export interface PreviewOptions {
  sanitizeForCrossPlatform: boolean
}

const resolverOptions = ({ sanitizeForCrossPlatform }: PreviewOptions): PathResolverOptions => ({ sanitizeForCrossPlatform })

/** Resolved upload path for the sample book, always leading-slashed so it reads as a path. */
export function previewUploadPath(pattern: string, options: PreviewOptions, metadata = EXAMPLE_PATTERN_METADATA): string {
  if (!pattern.trim()) return ''
  const resolved = resolveUploadPath(pattern, metadata, PREVIEW_EXTENSION, resolverOptions(options))
  if (!resolved) return ''
  return resolved.startsWith('/') ? resolved : `/${resolved}`
}

export function previewDownloadName(pattern: string, options: PreviewOptions, metadata = EXAMPLE_PATTERN_METADATA): string {
  const resolved = resolveDownloadFilename(pattern || DEFAULT_DOWNLOAD_PATTERN, metadata, PREVIEW_EXTENSION, resolverOptions(options))
  return resolved ?? ''
}

export interface PathParts {
  folders: string[]
  stem: string
  extension: string
}

/** Splits a resolved path so the tree can render folders, filename and extension separately. */
export function splitResolvedPath(path: string): PathParts {
  const segments = path.replace(/^\//, '').split('/').filter(Boolean)
  const filename = segments.pop() ?? ''
  const dot = filename.lastIndexOf('.')
  return {
    folders: segments,
    stem: dot === -1 ? filename : filename.slice(0, dot),
    extension: dot === -1 ? '' : filename.slice(dot),
  }
}
