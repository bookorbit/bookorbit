import { Injectable } from '@nestjs/common';
import { basename, dirname, extname, join, relative } from 'path';

import type { BookMoveCollisionKind, BookMoveCollisionPolicy, BookMoveIneligibleReason, BookMoveLayoutChange } from '@bookorbit/types';
import { resolveUploadPath } from '@bookorbit/types';

import { buildTokens } from '../file-write/file-rename.utils';
import type { MoveBookData, MoveBookFile, MoveTargetLibrary } from './book-move.repository';
import { MAX_PATH_LENGTH, isInsideRoot, withCollisionSuffix } from './book-move.utils';

export interface PlannedFileMove {
  fileId: number;
  from: string;
  to: string;
  role: string;
  format: string | null;
  fileHash: string | null;
}

export interface BookMovePlan {
  bookId: number;
  title: string;
  sourceLibraryId: number;
  sourceLibraryFolderPath: string;
  sourceFolderPath: string;
  sourceHasOwnFolder: boolean;
  currentPath: string;
  targetPath: string;
  /** Value written to books.folderPath in the target library. */
  targetFolderPathKey: string;
  files: PlannedFileMove[];
  layoutChange: BookMoveLayoutChange | null;
  primaryFormat: string;
}

export interface PlanCollision {
  kind: BookMoveCollisionKind;
  existingBookId: number | null;
  suggestedPolicy: BookMoveCollisionPolicy;
  /** Alternative plan used when the collision is resolved with "keep_both". */
  keepBothPlan: BookMovePlan;
}

export type BookMovePlanOutcome =
  | { kind: 'ineligible'; bookId: number; title: string; reason: BookMoveIneligibleReason; detail?: string }
  | { kind: 'already_in_target'; bookId: number; title: string }
  | { kind: 'ready'; plan: BookMovePlan }
  | { kind: 'collision'; plan: BookMovePlan; collision: PlanCollision };

export interface PlanInput {
  books: MoveBookData[];
  target: MoveTargetLibrary;
  pattern: string | null;
  sanitizeForCrossPlatform: boolean;
  /** folderPath -> owning book id, already in the target library. */
  folderPathOwners: Map<string, number>;
  /** absolutePath -> owning book id, across all libraries. */
  filePathOwners: Map<string, number>;
  /** content hash -> present book in the target library holding it. */
  hashOwners: Map<string, number>;
}

const CONTENT_ROLE = 'content';
const MAX_KEEP_BOTH_ATTEMPTS = 50;

function displayTitle(book: MoveBookData): string {
  if (book.metadata.title) return book.metadata.title;
  const primary = book.files.find((file) => file.id === book.primaryFileId) ?? book.files[0];
  return primary ? basename(primary.absolutePath, extname(primary.absolutePath)) : `Book ${book.bookId}`;
}

function pickPrimaryFile(book: MoveBookData): MoveBookFile | null {
  const contentFiles = book.files.filter((file) => file.role === CONTENT_ROLE);
  if (contentFiles.length === 0) return null;
  return contentFiles.find((file) => file.id === book.primaryFileId) ?? contentFiles[0];
}

/**
 * Resolves destination paths and eligibility for cross-library moves.
 *
 * Naming follows the rename service rather than the upload service: a move is a
 * rename across roots, so `resolveUploadPath` is used for both target organization
 * modes. Using upload's resolver would flatten per-file targets into the library
 * root and then let a later rename reorganize them, a double hop with two different
 * on-disk outcomes for the same book.
 */
@Injectable()
export class BookMovePlannerService {
  plan(input: PlanInput): BookMovePlanOutcome[] {
    const allocator = new DestinationAllocator(input.folderPathOwners, input.filePathOwners);
    const outcomes: BookMovePlanOutcome[] = [];

    for (const book of input.books) {
      outcomes.push(this.planBook(book, input, allocator));
    }

    return outcomes;
  }

  private planBook(book: MoveBookData, input: PlanInput, allocator: DestinationAllocator): BookMovePlanOutcome {
    const title = displayTitle(book);
    const target = input.target;

    if (book.libraryId === target.libraryId && book.libraryFolderId === target.folderId) {
      return { kind: 'already_in_target', bookId: book.bookId, title };
    }

    if (book.status !== 'present') {
      return { kind: 'ineligible', bookId: book.bookId, title, reason: 'book_not_present', detail: book.status };
    }

    const primaryFile = pickPrimaryFile(book);
    if (!primaryFile) {
      return { kind: 'ineligible', bookId: book.bookId, title, reason: 'no_content_file' };
    }

    // A book_per_file library registers exactly one file per book: its scanner drops
    // sidecars and cannot represent multi-format books. Anything larger is refused
    // rather than silently split or stripped.
    if (target.organizationMode === 'book_per_file' && book.files.length > 1) {
      return {
        kind: 'ineligible',
        bookId: book.bookId,
        title,
        reason: 'multi_file_target_per_file',
        detail: String(book.files.length),
      };
    }

    if (!input.pattern) {
      return { kind: 'ineligible', bookId: book.bookId, title, reason: 'pattern_unresolved' };
    }

    const primaryFormat = (primaryFile.format ?? extname(primaryFile.absolutePath).slice(1)).toLowerCase();
    const resolvedRelPath = this.resolvePathForFile(primaryFile, book, input, primaryFormat);
    if (!resolvedRelPath) {
      return { kind: 'ineligible', bookId: book.bookId, title, reason: 'pattern_unresolved' };
    }

    const basePrimaryTarget = join(target.folderPath, resolvedRelPath);
    if (!isInsideRoot(target.folderPath, basePrimaryTarget)) {
      return { kind: 'ineligible', bookId: book.bookId, title, reason: 'path_outside_target_root' };
    }

    const buildPlan = (attempt: number): BookMovePlan | null =>
      this.buildPlan({ book, input, primaryFile, primaryFormat, basePrimaryTarget, attempt, title });

    const basePlan = buildPlan(0);
    if (!basePlan) {
      return { kind: 'ineligible', bookId: book.bookId, title, reason: 'path_too_long' };
    }

    const ownFileIds = new Set(book.files.map((file) => file.id));
    const conflict = allocator.findConflict(basePlan, book.bookId, ownFileIds);

    const duplicateBookId = this.findHashDuplicate(book, input.hashOwners);
    if (duplicateBookId !== null) {
      allocator.reserve(basePlan);
      return {
        kind: 'collision',
        plan: basePlan,
        collision: {
          kind: 'hash_duplicate',
          existingBookId: duplicateBookId,
          suggestedPolicy: 'merge',
          keepBothPlan: this.allocateKeepBoth(buildPlan, allocator, book.bookId, ownFileIds) ?? basePlan,
        },
      };
    }

    if (!conflict) {
      allocator.reserve(basePlan);
      return { kind: 'ready', plan: basePlan };
    }

    const keepBothPlan = this.allocateKeepBoth(buildPlan, allocator, book.bookId, ownFileIds);
    if (keepBothPlan) allocator.reserve(keepBothPlan);

    return {
      kind: 'collision',
      plan: basePlan,
      collision: {
        kind: conflict.kind,
        existingBookId: conflict.existingBookId,
        suggestedPolicy: 'keep_both',
        keepBothPlan: keepBothPlan ?? basePlan,
      },
    };
  }

  private allocateKeepBoth(
    buildPlan: (attempt: number) => BookMovePlan | null,
    allocator: DestinationAllocator,
    bookId: number,
    ownFileIds: Set<number>,
  ): BookMovePlan | null {
    for (let attempt = 2; attempt <= MAX_KEEP_BOTH_ATTEMPTS; attempt++) {
      const candidate = buildPlan(attempt);
      if (!candidate) return null;
      if (!allocator.findConflict(candidate, bookId, ownFileIds)) return candidate;
    }
    return null;
  }

  private findHashDuplicate(book: MoveBookData, hashOwners: Map<string, number>): number | null {
    for (const file of book.files) {
      if (file.role !== CONTENT_ROLE || !file.fileHash) continue;
      const owner = hashOwners.get(file.fileHash);
      if (owner !== undefined && owner !== book.bookId) return owner;
    }
    return null;
  }

  private resolvePathForFile(file: MoveBookFile, book: MoveBookData, input: PlanInput, format: string): string | null {
    const originalStem = basename(file.absolutePath, extname(file.absolutePath));
    const tokens = buildTokens(book.metadata, book.authors, originalStem, format, input.target.libraryName);
    return resolveUploadPath(input.pattern!, tokens, format, { sanitizeForCrossPlatform: input.sanitizeForCrossPlatform });
  }

  private buildPlan(args: {
    book: MoveBookData;
    input: PlanInput;
    primaryFile: MoveBookFile;
    primaryFormat: string;
    basePrimaryTarget: string;
    attempt: number;
    title: string;
  }): BookMovePlan | null {
    const { book, input, primaryFile, primaryFormat, basePrimaryTarget, attempt, title } = args;
    const target = input.target;
    const targetIsPerFolder = target.organizationMode === 'book_per_folder';
    const sourceIsPerFolder = book.organizationMode === 'book_per_folder';
    const sourceHasOwnFolder = sourceIsPerFolder && book.folderPath !== primaryFile.absolutePath;

    const primaryExtension = extname(basePrimaryTarget);
    const baseFolder = dirname(basePrimaryTarget);

    // Suffix the folder for per-folder targets that own a directory, otherwise the
    // file itself, so "keep both" never merges two books into one folder.
    const bookOwnsTargetFolder = targetIsPerFolder && baseFolder !== target.folderPath;

    let primaryTarget: string;
    let targetBookFolder: string;

    if (attempt <= 0) {
      primaryTarget = basePrimaryTarget;
      targetBookFolder = baseFolder;
    } else if (bookOwnsTargetFolder) {
      targetBookFolder = withCollisionSuffix(baseFolder, attempt, '');
      primaryTarget = join(targetBookFolder, basename(basePrimaryTarget));
    } else {
      primaryTarget = withCollisionSuffix(basePrimaryTarget, attempt, primaryExtension);
      targetBookFolder = dirname(primaryTarget);
    }

    const files: PlannedFileMove[] = [];
    const seenTargets = new Set<string>();
    let internalCollision = false;

    for (const file of book.files) {
      let fileTarget: string;

      if (file.id === primaryFile.id) {
        fileTarget = primaryTarget;
      } else if (targetIsPerFolder) {
        // Only the primary file is renamed to the target library's pattern; every
        // other file keeps its name and position inside the book. Re-deriving names
        // for secondary files would collapse a multi-track audiobook's 01.mp3,
        // 02.mp3 into one name and lose the ordering the scanner sorts on.
        fileTarget = join(targetBookFolder, sourceHasOwnFolder ? relative(book.folderPath, file.absolutePath) : basename(file.absolutePath));
      } else {
        // Per-file targets are single-file by eligibility; this keeps the mapping total.
        fileTarget = join(targetBookFolder, basename(file.absolutePath));
      }

      if (fileTarget.length > MAX_PATH_LENGTH) return null;
      if (!isInsideRoot(target.folderPath, fileTarget)) return null;

      const key = fileTarget.toLowerCase();
      if (seenTargets.has(key)) internalCollision = true;
      seenTargets.add(key);

      files.push({
        fileId: file.id,
        from: file.absolutePath,
        to: fileTarget,
        role: file.role,
        format: file.format,
        fileHash: file.fileHash,
      });
    }

    if (internalCollision) {
      // Two files resolved to the same destination: fall back to preserving the
      // original in-book layout for everything except the primary file.
      files.length = 0;
      const fallbackSeen = new Set<string>();
      for (const file of book.files) {
        const fileTarget =
          file.id === primaryFile.id
            ? primaryTarget
            : join(targetBookFolder, sourceHasOwnFolder ? relative(book.folderPath, file.absolutePath) : basename(file.absolutePath));

        if (fileTarget.length > MAX_PATH_LENGTH) return null;
        if (!isInsideRoot(target.folderPath, fileTarget)) return null;
        if (fallbackSeen.has(fileTarget.toLowerCase())) return null;
        fallbackSeen.add(fileTarget.toLowerCase());

        files.push({
          fileId: file.id,
          from: file.absolutePath,
          to: fileTarget,
          role: file.role,
          format: file.format,
          fileHash: file.fileHash,
        });
      }
    }

    const targetFolderPathKey = targetIsPerFolder && bookOwnsTargetFolder ? targetBookFolder : primaryTarget;

    let layoutChange: BookMoveLayoutChange | null = null;
    if (!sourceIsPerFolder && targetIsPerFolder && bookOwnsTargetFolder) layoutChange = 'wrap_into_folder';
    else if (sourceHasOwnFolder && !targetIsPerFolder) layoutChange = 'dissolve_folder';

    return {
      bookId: book.bookId,
      title,
      sourceLibraryId: book.libraryId,
      sourceLibraryFolderPath: book.libraryFolderPath,
      sourceFolderPath: book.folderPath,
      sourceHasOwnFolder,
      currentPath: primaryFile.absolutePath,
      targetPath: primaryTarget,
      targetFolderPathKey,
      files,
      layoutChange,
      primaryFormat,
    };
  }
}

/**
 * Tracks which destination paths are taken, combining what the database already owns
 * with what earlier books in the same job have claimed. Comparison is
 * case-insensitive so two books cannot land on paths that differ only by case on a
 * case-insensitive filesystem.
 */
class DestinationAllocator {
  private readonly reservedFolders = new Set<string>();
  private readonly reservedFiles = new Set<string>();

  constructor(
    private readonly folderPathOwners: Map<string, number>,
    private readonly filePathOwners: Map<string, number>,
  ) {}

  findConflict(plan: BookMovePlan, bookId: number, ownFileIds: Set<number>): { kind: BookMoveCollisionKind; existingBookId: number | null } | null {
    const folderKey = plan.targetFolderPathKey.toLowerCase();
    if (this.reservedFolders.has(folderKey)) {
      return { kind: 'folder_path', existingBookId: null };
    }

    const folderOwner = this.folderPathOwners.get(plan.targetFolderPathKey);
    if (folderOwner !== undefined && folderOwner !== bookId) {
      return { kind: 'folder_path', existingBookId: folderOwner };
    }

    for (const file of plan.files) {
      const fileKey = file.to.toLowerCase();
      if (this.reservedFiles.has(fileKey)) {
        return { kind: 'file_path', existingBookId: null };
      }

      const owner = this.filePathOwners.get(file.to);
      if (owner !== undefined && owner !== bookId) {
        return { kind: 'file_path', existingBookId: owner };
      }
      // A path owned by this same book is only fine when the very same file row keeps it.
      if (owner === bookId && !ownFileIds.has(file.fileId)) {
        return { kind: 'file_path', existingBookId: owner };
      }
    }

    return null;
  }

  reserve(plan: BookMovePlan): void {
    this.reservedFolders.add(plan.targetFolderPathKey.toLowerCase());
    for (const file of plan.files) this.reservedFiles.add(file.to.toLowerCase());
  }
}
