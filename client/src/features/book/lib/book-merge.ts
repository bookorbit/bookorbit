import {
  BOOK_MERGE_MAX_BOOKS,
  type BookMergeBlocker,
  type BookMergeBlockerCode,
  type BookMergeBookSummary,
  type BookMergeField,
  type BookMergeFieldPreview,
  type BookMergeFieldValue,
  type BookMergeFilePlanEntry,
  type BookMergeFileReason,
  type BookMergeJobStatus,
  type BookMergePreviewResponse,
  type BookMergeSourceOutcome,
  type BookMergeSourceStatus,
  type BookMergeWarning,
  type BookMergeWarningCode,
} from '@bookorbit/types'
import { compareVectors } from '@/features/tools/book-duplicates/utils/duplicate-keeper'
import { i18n } from '@/i18n'
import { formatList } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'

/** Request-level error codes the merge endpoints answer with, next to the preview's blockers. */
export const MERGE_PREVIEW_STALE = 'MERGE_PREVIEW_STALE'
export const MERGE_BLOCKED = 'MERGE_BLOCKED'
/** The merge would cut other readers off and the request did not acknowledge it. */
export const MERGE_ACCESS_LOSS_NOT_ACKNOWLEDGED = 'ACCESS_LOSS_NOT_ACKNOWLEDGED'

/** Fields of the audio edition, shown under their own heading in the review. */
export const MERGE_AUDIO_FIELDS: ReadonlySet<BookMergeField> = new Set<BookMergeField>(['narrators', 'audibleId', 'librofmId'])

const TERMINAL_JOB_STATUSES: ReadonlySet<BookMergeJobStatus> = new Set<BookMergeJobStatus>(['done', 'failed', 'rolled_back'])

export function isTerminalMergeStatus(status: BookMergeJobStatus): boolean {
  return TERMINAL_JOB_STATUSES.has(status)
}

export function isBlankMergeValue(value: BookMergeFieldValue): boolean {
  if (value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.every((entry) => entry.trim().length === 0)
  return false
}

/** Why the selection bar offers Merge but cannot run it. */
export type MergeDisabledReason = 'queryScoped' | 'tooFew' | 'tooMany' | 'notEditable'

export interface MergeSelectionState {
  disabledReason: MergeDisabledReason | null
}

/**
 * Books from different libraries merge, but the server needs editor access to every selected book's
 * library, which a mixed selection may not have.
 */
export function mergeDisabledReason(options: { queryScoped: boolean; count: number; allEditable: boolean }): MergeDisabledReason | null {
  if (options.queryScoped) return 'queryScoped'
  if (options.count < 2) return 'tooFew'
  if (options.count > BOOK_MERGE_MAX_BOOKS) return 'tooMany'
  if (!options.allEditable) return 'notEditable'
  return null
}

/** The way out a blocker suggests, if any. `link` shows only where the host can open Link. */
export type MergeBlockerAlternative = 'link' | 'chooseKeeper'

const BLOCKER_ALTERNATIVES: Partial<Record<BookMergeBlockerCode, MergeBlockerAlternative>> = {
  DIFFERENT_LIBRARIES: 'link',
  FILE_PER_BOOK_LIBRARY: 'link',
  TARGET_NOT_PRESENT: 'chooseKeeper',
  BOTH_HAVE_AUDIO: 'link',
  FOLDER_NOT_WRITABLE: 'link',
  FORMAT_NOT_ALLOWED: 'link',
  PATH_EXCLUDED: 'link',
  LEFTOVER_CONTENT: 'link',
  READERS_LOSE_ACCESS: 'link',
}

export function blockerAlternative(code: BookMergeBlockerCode): MergeBlockerAlternative | null {
  return BLOCKER_ALTERNATIVES[code] ?? null
}

/** True when the books sit in more than one library, so the merged book has to live in one of them. */
export function mergeSpansLibraries(preview: Pick<BookMergePreviewResponse, 'books'>): boolean {
  return new Set(preview.books.map((book) => book.libraryId)).size > 1
}

/** The library the merged book lives in afterwards; older servers leave it to the destination book's. */
export function mergeDestinationLibraryId(preview: BookMergePreviewResponse): number | null {
  if (preview.destinationLibraryId != null) return preview.destinationLibraryId
  const destination = preview.books.find((book) => book.id === preview.destinationBookId) ?? preview.books[0]
  return destination?.libraryId ?? null
}

/**
 * Names for every library the merge touches: the preview's own names first, then the libraries the
 * viewer can see. Library names are user content, so they are never translated.
 */
export function mergeLibraryNames(books: BookMergeBookSummary[], libraries: { id: number; name: string }[]): Map<number, string> {
  const names = new Map(libraries.map((library): [number, string] => [library.id, library.name]))
  for (const book of books) {
    if (book.libraryName) names.set(book.libraryId, book.libraryName)
  }
  return names
}

/**
 * Whether picking another destination candidate could clear this blocker. Only offered across
 * libraries, where "Where the merged book lives" is always on screen.
 */
export function destinationAvoidsBlocker(blocker: BookMergeBlocker, preview: BookMergePreviewResponse): boolean {
  if (!mergeSpansLibraries(preview)) return false
  const current = preview.books.find((book) => book.id === preview.destinationBookId) ?? null
  const others = preview.books.filter((book) => book.id !== preview.destinationBookId && preview.destinationCandidates.includes(book.id))
  if (others.length === 0) return false
  const blockedLibraryId = blocker.libraryId ?? mergeDestinationLibraryId(preview)
  switch (blocker.code) {
    case 'READERS_LOSE_ACCESS': {
      const loss = new Map((preview.destinationAccessLoss ?? []).map((entry) => [entry.bookId, entry.losesAccess]))
      return others.some((book) => loss.get(book.id) === false)
    }
    case 'INSUFFICIENT_SPACE':
      if (current?.libraryFolderId != null)
        return others.some((book) => book.libraryFolderId != null && book.libraryFolderId !== current.libraryFolderId)
      return others.some((book) => book.libraryId !== blockedLibraryId)
    case 'FILE_PER_BOOK_LIBRARY':
    case 'FORMAT_NOT_ALLOWED':
    case 'PATH_EXCLUDED':
      return others.some((book) => book.libraryId !== blockedLibraryId)
    default:
      return false
  }
}

/** Files that cross from one library into another (or stay put within one), for the grouped review. */
export interface MergeFileGroup {
  key: string
  fromLibraryId: number
  toLibraryId: number
  files: BookMergeFilePlanEntry[]
  bytes: number
  /** Bytes of this group copied to another drive; zero when none are. */
  crossDeviceBytes: number
}

/** Files a cross-library merge leaves in a source library's folder, where BookOrbit stops tracking them. */
export interface MergeLeftBehind {
  libraryId: number
  files: BookMergeFilePlanEntry[]
}

const LEFT_BEHIND_REASONS: ReadonlySet<BookMergeFileReason> = new Set<BookMergeFileReason>([
  'metadata_kept_in_place',
  'cover_kept_in_place',
  'missing',
])

/**
 * The file plan split by direction for a merge across libraries. Null `groups` means the flat list:
 * one library, or an older server that does not say which library each file is in.
 */
export function splitMergeFiles(preview: BookMergePreviewResponse): { groups: MergeFileGroup[] | null; leftBehind: MergeLeftBehind[] } {
  const files = preview.files
  if (!mergeSpansLibraries(preview) || files.length === 0 || files.some((file) => file.fromLibraryId == null)) {
    return { groups: null, leftBehind: [] }
  }
  const destinationLibraryId = mergeDestinationLibraryId(preview)
  const groups = new Map<string, MergeFileGroup>()
  const left = new Map<number, BookMergeFilePlanEntry[]>()
  for (const file of files) {
    const from = file.fromLibraryId!
    if (file.action !== 'move' && LEFT_BEHIND_REASONS.has(file.reason) && from !== destinationLibraryId) {
      left.set(from, [...(left.get(from) ?? []), file])
      continue
    }
    const to = file.toLibraryId ?? from
    const key = `${from}-${to}`
    const group = groups.get(key) ?? { key, fromLibraryId: from, toLibraryId: to, files: [], bytes: 0, crossDeviceBytes: 0 }
    group.files.push(file)
    group.bytes += file.sizeBytes ?? 0
    if (file.crossDevice && file.action === 'move') group.crossDeviceBytes += file.sizeBytes ?? 0
    groups.set(key, group)
  }
  // Files coming in from other libraries first, then those already where the merged book lives.
  const ordered = [...groups.values()].sort((a, b) => Number(a.fromLibraryId === a.toLibraryId) - Number(b.fromLibraryId === b.toLibraryId))
  return { groups: ordered, leftBehind: [...left.entries()].map(([libraryId, entries]) => ({ libraryId, files: entries })) }
}

/** Warnings the review shows in their own sections rather than in the "Before you merge" list. */
export const MERGE_SECTION_WARNINGS: ReadonlySet<BookMergeWarningCode> = new Set<BookMergeWarningCode>([
  'LIBRARY_ACCESS_NARROWS',
  'KOBO_REMOVAL',
  'CUSTOM_FIELDS_HIDDEN',
])

/**
 * A warning in words. A newer server may send a code this bundle does not know; it still shows, in
 * general words. `libraryName` names the warning's library, or the destination when it names none.
 */
export function mergeWarningMessage(warning: BookMergeWarning, libraryName: (libraryId: number | null) => string): string {
  const { t, te } = i18n.global
  const base = `book.merge.warnings.${warning.code}`
  if (!te(`${base}.message`)) return t('book.merge.warnings.unknown')
  const library = libraryName(warning.libraryId ?? null)
  if (warning.bytes != null && warning.code === 'CROSS_DEVICE_COPY') return t(`${base}.detailed`, { size: formatBytes(warning.bytes) })
  if (warning.count != null && te(`${base}.detailed`)) return t(`${base}.detailed`, { count: warning.count, library })
  return t(`${base}.message`, { library })
}

/** The preview asks for `acknowledgeAccessLoss`: readers would lose access to the merged book. */
export function accessLossWarning(preview: BookMergePreviewResponse | null): BookMergeWarning | null {
  return preview?.warnings.find((warning) => warning.code === 'LIBRARY_ACCESS_NARROWS') ?? null
}

/**
 * Names that tell the books apart. Records of one book usually share a title, so a repeated title
 * gets its folder name (or its formats, for a loose file) beside it.
 */
export function mergeBookLabels(
  books: BookMergeBookSummary[],
  untitled: string,
  withDetail: (title: string, detail: string) => string,
): Map<number, string> {
  const titleOf = (book: BookMergeBookSummary): string => book.title.trim() || untitled
  const counts = new Map<string, number>()
  for (const book of books) {
    const key = titleOf(book).toLocaleLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return new Map(
    books.map((book): [number, string] => {
      const title = titleOf(book)
      if ((counts.get(title.toLocaleLowerCase()) ?? 0) < 2) return [book.id, title]
      const folder = book.folderRelPath?.split('/').filter(Boolean).at(-1)
      const detail = folder ?? formatList(book.formats.map((format) => format.toUpperCase()))
      return [book.id, detail ? withDetail(title, detail) : title]
    }),
  )
}

/** How many of the previewed fields a book has a value for: the card's "details filled" figure. */
export function filledFieldCount(fields: BookMergeFieldPreview[], bookId: number): number {
  return fields.filter((field) => field.candidates.some((candidate) => candidate.bookId === bookId && !isBlankMergeValue(candidate.value))).length
}

function bookBytes(preview: BookMergePreviewResponse, bookId: number): number {
  return preview.files.reduce((total, file) => total + (file.bookId === bookId ? (file.sizeBytes ?? 0) : 0), 0)
}

/**
 * The Duplicate Books "metadata" keeper rule applied to a preview: the most complete record wins,
 * then the one with more files, then more bytes, then the oldest. A book that is missing or still
 * processing cannot be kept, so it only wins when nothing else can.
 */
export function recommendMergeKeeper(preview: BookMergePreviewResponse): number | null {
  const present = preview.books.filter((book) => book.status === 'present')
  const pool = present.length > 0 ? present : preview.books
  const vector = (bookId: number, fileCount: number, addedAt: string | null): number[] => {
    const added = addedAt ? new Date(addedAt).getTime() : Number.POSITIVE_INFINITY
    return [
      filledFieldCount(preview.fields, bookId),
      fileCount,
      bookBytes(preview, bookId),
      Number.isFinite(added) ? -added : Number.NEGATIVE_INFINITY,
    ]
  }
  const ranked = [...pool].sort((a, b) => compareVectors(vector(a.id, a.fileCount, a.addedAt), vector(b.id, b.fileCount, b.addedAt)))
  return ranked[0]?.id ?? null
}

export type BookMergePreviewChange =
  | { kind: 'field'; field: BookMergeField }
  | { kind: 'files' }
  | { kind: 'readingData' }
  | { kind: 'warnings' }
  | { kind: 'blockers' }
  | { kind: 'visibility' }

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** What a reloaded preview changed, so a stale confirm can say what to look at again (F3). */
export function describePreviewChanges(before: BookMergePreviewResponse, after: BookMergePreviewResponse): BookMergePreviewChange[] {
  const changes: BookMergePreviewChange[] = []
  const previous = new Map(before.fields.map((field) => [field.field, field]))
  for (const field of after.fields) {
    const old = previous.get(field.field)
    if (
      !old ||
      !sameJson(old.candidates, field.candidates) ||
      old.defaultBookId !== field.defaultBookId ||
      old.lockedOnTarget !== field.lockedOnTarget
    ) {
      changes.push({ kind: 'field', field: field.field })
    }
  }
  if (!sameJson(before.files, after.files)) changes.push({ kind: 'files' })
  if (!sameJson(before.userData, after.userData)) changes.push({ kind: 'readingData' })
  if (!sameJson(before.visibility, after.visibility)) changes.push({ kind: 'visibility' })
  if (!sameJson(before.warnings, after.warnings)) changes.push({ kind: 'warnings' })
  if (!sameJson(before.blockers, after.blockers)) changes.push({ kind: 'blockers' })
  return changes
}

/**
 * Each source's outcome. A finished job may omit outcomes for sources that merged cleanly, so a
 * missing entry reads as merged once the job is `done` and as still pending otherwise.
 */
export function sourceOutcomes(job: {
  status: BookMergeJobStatus
  sourceBookIds: number[]
  outcomes: BookMergeSourceOutcome[]
}): BookMergeSourceOutcome[] {
  const byId = new Map(job.outcomes.map((outcome) => [outcome.sourceBookId, outcome]))
  return job.sourceBookIds.map((sourceBookId) => {
    const known = byId.get(sourceBookId)
    if (known) return known
    const status: BookMergeSourceStatus = job.status === 'done' ? 'merged' : 'pending'
    return { sourceBookId, status, errorCode: null }
  })
}

export function mergedSourceIds(job: { status: BookMergeJobStatus; sourceBookIds: number[]; outcomes: BookMergeSourceOutcome[] }): number[] {
  return sourceOutcomes(job)
    .filter((outcome) => outcome.status === 'merged')
    .map((outcome) => outcome.sourceBookId)
}
