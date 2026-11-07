import type { BookDuplicateCandidate } from '@bookorbit/types'

export {
  DUPLICATE_KEEP_RULES,
  compareDuplicateRuleVectors as compareVectors,
  duplicateCopyBytes as copyBytes,
  duplicateCopyFormats as copyFormats,
  duplicateReclaimableBytes as reclaimableBytes,
  isProtectedDuplicateCopy as isProtectedCopy,
  protectedDuplicateDiscards as protectedDiscards,
  recommendDuplicateKeeper as recommendKeeper,
  type DuplicateKeepRule,
  type DuplicateKeeperReason as KeeperReason,
} from '@bookorbit/types'

/**
 * The folder that tells two copies apart. Copies of one book share a title, so the row label has to
 * come from the path: the parent folder, or the file name when the book is a loose file.
 */
export function copyFolderLabel(book: BookDuplicateCandidate): string {
  const path = book.files[0]?.path ?? book.folderPath
  if (!path) return ''
  const segments = path.split('/').filter(Boolean)
  return segments.at(-2) ?? segments.at(-1) ?? ''
}

/**
 * The library a merge of a group that spans libraries is expected to land in: the keeper's, unless
 * its library keeps one book per file and cannot hold a merged folder. Null within one library. The
 * merge review names the library the server actually chose; this only labels the row before then.
 */
export function crossLibraryMergeLibrary(
  books: Pick<BookDuplicateCandidate, 'id' | 'libraryId' | 'libraryName' | 'bookPerFile'>[],
  keeperId: number,
): { libraryId: number; libraryName: string } | null {
  if (new Set(books.map((book) => book.libraryId)).size < 2) return null
  const keeper = books.find((book) => book.id === keeperId)
  const destination = keeper && !keeper.bookPerFile ? keeper : (books.find((book) => !book.bookPerFile) ?? keeper)
  return destination ? { libraryId: destination.libraryId, libraryName: destination.libraryName } : null
}
