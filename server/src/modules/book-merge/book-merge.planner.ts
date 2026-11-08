import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { constants as fsConstants } from 'fs';
import { access, readdir, stat, statfs } from 'fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'path';

import {
  BOOK_MERGE_FIELDS,
  BOOK_MERGE_MAX_BOOKS,
  BOOK_MERGE_USER_DATA_CATEGORIES,
  COVER_MEDIA,
  Permission,
  getCoverMedia,
  isAudioFormat,
  type BookMergeBlocker,
  type BookMergeBookSummary,
  type BookMergeField,
  type BookMergeFieldPreview,
  type BookMergeFilePlanEntry,
  type BookMergeLibrarySettingChange,
  type BookMergePreviewResponse,
  type BookMergeUserData,
  type BookMergeUserDataCount,
  type BookMergeVisibilityCandidate,
  type BookMergeWarning,
  type ContentFilterRules,
  type CoverMedium,
} from '@bookorbit/types';

import { buildNameExcludeMatcher } from '../../common/fs-walk.utils';
import { FileLockService, bookOperationLockKey } from '../../common/services/file-lock.service';
import { LibraryOperationGate, type LibraryOperationLease } from '../../common/services/library-operation-gate.service';
import type { RequestUser } from '../../common/types/request-user';
import { computeContentHash, isInsideRoot, withCollisionSuffix } from '../../common/utils/file-move.utils';
import { selectMovedPrimary } from '../../common/utils/primary-file-selection.utils';
import { BookConsolidationService } from '../book-consolidation/book-consolidation.service';
import { fieldValue, isBlankField, isFieldLocked, resolveFieldSources, type BookFacts } from '../book-consolidation/field-picks';
import { BookService } from '../book/book.service';
import { classifyFile } from '../scanner/lib/classify';
import { BookMergeRepository, type MergeBookRow, type MergeFileRow, type MergeLibraryRow } from './book-merge.repository';

const MAX_SUFFIX_ATTEMPTS = 50;
const MAX_OWNER_ROUNDS = 5;
const HASH_CONCURRENCY = 2;
const LEFTOVER_SCAN_LIMIT = 1000;
const HASH_CACHE_LIMIT = 500;
/** Book files a source library would re-import, reported per book before the list stops. */
const LEFTOVER_CONTENT_REPORT_LIMIT = 5;
/** Room kept free on a drive a merge copies onto: 5% of the drive, at most this much. */
const SPACE_MARGIN_MAX_BYTES = 1024 ** 3;
const SPACE_MARGIN_RATIO = 0.05;

export interface PlanRequest {
  targetBookId: number;
  sourceBookIds: number[];
  destinationBookId?: number;
  fieldOverrides?: Partial<Record<BookMergeField, number>>;
  includeTagIds?: number[];
  includeGenreIds?: number[];
  deleteIdenticalCopies?: boolean;
}

export interface PlanOptions {
  /** The gate the caller already holds for a longer run; its libraries do not count as busy. */
  lease?: LibraryOperationLease;
}

/** One file operation, journaled before it starts. JSON-safe: it is stored in the job's plan. */
export interface PlannedMove {
  fileId: number;
  bookId: number;
  from: string;
  to: string;
  /** `to` relative to the destination's library folder. */
  relPath: string;
  kind: 'move' | 'hide';
  expectedSize: number | null;
  expectedMtimeMs: number | null;
  crossDevice: boolean;
}

export interface MergeStep {
  sourceBookId: number;
  /** In execution order: hides first, then the kept book's moves, then the source's. */
  moves: PlannedMove[];
  /** The kept book's own file moves (only on the step whose source folder is the destination). */
  targetFileIds: number[];
  droppedSidecarFileIds: number[];
  /** Folders emptied by this step, removed post-commit when nothing is left in them. */
  vacatedFolders: string[];
  /** Library folders the step reads from or writes to: the bounds for suppression and folder cleanup. */
  roots: string[];
}

export interface MergeExecutionPlan {
  /** The library the merged book lives in afterwards. */
  libraryId: number;
  /** Every library the merge touches, the destination included. Absent from plans stored before merges spanned libraries. */
  libraryIds?: number[];
  /** Readers whose daily reading stats count a book that changes library; rebuilt after the merge. */
  dailyStatsUserIds?: number[];
  targetBookId: number;
  destinationBookId: number;
  destination: { libraryFolderId: number; libraryFolderPath: string; folderPath: string };
  /** The destination's source first, so the kept book takes its folder before anything else lands there. */
  steps: MergeStep[];
  fieldSources: Partial<Record<BookMergeField, number>>;
  excludeTagIds: number[];
  excludeGenreIds: number[];
  hiddenRequestIds: number[];
  identicalPairs: Array<{ loserFileId: number; survivorFileId: number }>;
  deleteIdenticalCopies: boolean;
  watched: boolean;
}

/** Every library a plan touches; a plan stored before merges spanned libraries touched its own only. */
export function libraryIdsOf(plan: Pick<MergeExecutionPlan, 'libraryId' | 'libraryIds'>): number[] {
  return [...new Set([plan.libraryId, ...(plan.libraryIds ?? [])])].sort((a, b) => a - b);
}

export interface PlanResult {
  preview: BookMergePreviewResponse;
  plan: MergeExecutionPlan | null;
}

interface Folder {
  /** Directory the book's files are relative to. */
  base: string;
  /** True when the book is a single file at its library folder's root. */
  rootLevel: boolean;
}

type BookContext = MergeBookRow & { facts: BookFacts; files: MergeFileRow[]; folder: Folder };

interface AccessLoss {
  readers: Set<number>;
  hiddenRequestIds: number[];
}

interface DiskInfo {
  size: number;
  mtimeMs: number;
  dev: number;
  nlink: number;
}

function isFilePerBook(book: Pick<MergeBookRow, 'organizationMode'>): boolean {
  return book.organizationMode === 'book_per_file';
}

/** True when the scanner would skip this path: a segment below the library folder matches an exclude pattern. */
function isExcludedPath(libraryFolderPath: string, absolutePath: string, excluded: (name: string) => boolean): boolean {
  return relative(libraryFolderPath, absolutePath)
    .split(sep)
    .some((segment) => segment !== '' && excluded(segment));
}

function passesFilter(rules: ContentFilterRules, tagIds: ReadonlySet<number>, genreIds: ReadonlySet<number>): boolean {
  const includeTags = rules.includeTagIds.length > 0;
  const includeGenres = rules.includeGenreIds.length > 0;
  if (includeTags || includeGenres) {
    const tagHit = includeTags && rules.includeTagIds.some((id) => tagIds.has(id));
    const genreHit = includeGenres && rules.includeGenreIds.some((id) => genreIds.has(id));
    if (!tagHit && !genreHit) return false;
  }
  if (rules.excludeTagIds.some((id) => tagIds.has(id))) return false;
  if (rules.excludeGenreIds.some((id) => genreIds.has(id))) return false;
  return true;
}

/** The cover slots a book's folder image would fill: one per medium of its content files. */
function coverMediaOf(files: MergeFileRow[]): CoverMedium[] {
  const media = getCoverMedia(files);
  return COVER_MEDIA.filter((medium) => (medium === 'ebook' ? media.hasEbook : media.hasAudio));
}

function canSeeOthers(user: RequestUser): boolean {
  return user.isSuperuser || user.permissions.includes(Permission.ManageUsers);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, raw: unknown) => (typeof raw === 'bigint' ? raw.toString() : raw));
}

/**
 * Validates a merge and plans it: which book every field comes from, where every file goes, what
 * moves for which readers, and what each restricted reader would see afterwards. Preview and execute
 * both run it, so a merge never starts on a plan the user did not see.
 */
@Injectable()
export class BookMergePlanner {
  private readonly hashCache = new Map<string, string>();

  constructor(
    private readonly repository: BookMergeRepository,
    private readonly bookService: BookService,
    private readonly consolidation: BookConsolidationService,
    private readonly libraryGate: LibraryOperationGate,
    private readonly fileLocks: FileLockService,
  ) {}

  async plan(request: PlanRequest, user: RequestUser, options: PlanOptions = {}): Promise<PlanResult> {
    const sourceIds = request.sourceBookIds;
    const allIds = [request.targetBookId, ...sourceIds];
    const blockers: BookMergeBlocker[] = [];
    const warnings: BookMergeWarning[] = [];

    if (allIds.length > BOOK_MERGE_MAX_BOOKS) throw new BadRequestException({ message: 'Too many books', errorCode: 'TOO_MANY_BOOKS' });
    if (new Set(allIds).size !== allIds.length) blockers.push({ code: 'SAME_BOOK' });

    // Access: 404 for anything the user cannot see (coded for a merged-away id), 403 for a viewer.
    for (const id of [...new Set(allIds)]) await this.bookService.verifyBookAccess(id, user, 'editor');

    this.validateOverrides(request, allIds);
    if (!canSeeOthers(user) && ((request.includeTagIds?.length ?? 0) > 0 || (request.includeGenreIds?.length ?? 0) > 0)) {
      throw new ForbiddenException('Only user managers can add tags or genres that change who can see a book.');
    }

    const uniqueIds = [...new Set(allIds)];
    const rows = await this.repository.loadBooks(uniqueIds);
    const files = await this.repository.loadFiles(uniqueIds);
    const facts = await this.repository.transaction(async (tx) => {
      const loaded: BookFacts[] = [];
      for (const id of uniqueIds) loaded.push(await this.consolidation.loadFacts(tx, id));
      return loaded;
    });
    const books: BookContext[] = uniqueIds.map((id) => {
      const row = rows.find((candidate) => candidate.id === id)!;
      const bookFiles = files.filter((file) => file.bookId === id);
      return { ...row, facts: facts.find((fact) => fact.bookId === id)!, files: bookFiles, folder: this.folderOf(row, bookFiles) };
    });
    const target = books[0];
    const sources = sourceIds.map((id) => books.find((book) => book.id === id)!).filter((book) => book.id !== target.id);
    const bookById = (id: number) => books.find((book) => book.id === id)!;
    const involvedLibraryIds = [...new Set(books.map((book) => book.libraryId))].sort((a, b) => a - b);
    const libraries = await this.repository.loadLibraries(involvedLibraryIds);
    const seeOthers = canSeeOthers(user);

    // Eligibility. Books may sit in different libraries; each library's own rules are checked below.
    if (target.status !== 'present') blockers.push({ code: 'TARGET_NOT_PRESENT', bookId: target.id });
    for (const source of sources) if (source.status === 'processing') blockers.push({ code: 'SOURCE_PROCESSING', bookId: source.id });
    if (books.filter((book) => book.facts.hasAudio).length > 1) blockers.push({ code: 'BOTH_HAVE_AUDIO' });
    for (const id of involvedLibraryIds) {
      if (this.libraryGate.isHeld(id) && !options.lease?.holds(id)) blockers.push({ code: 'LIBRARY_BUSY', libraryId: id });
    }
    const busy = await this.repository.findBusyBooks(uniqueIds);
    for (const book of books) {
      const busyReason = busy.get(book.id) ?? (this.fileLocks.isLocked(bookOperationLockKey(book.id)) ? 'file_operation' : null);
      if (busyReason) blockers.push({ code: 'BOOK_BUSY', bookId: book.id, busyReason });
    }
    for (const book of books) {
      if (!book.folder.rootLevel && book.files.some((file) => !isInsideRoot(book.folderPath, file.absolutePath))) {
        blockers.push({ code: 'LEGACY_VIRTUAL_FOLDER', bookId: book.id });
      }
    }

    // Destination: a book with a folder of its own, in a library that keeps books in folders.
    const destinationCandidates = books.filter((book) => !book.folder.rootLevel && !isFilePerBook(book)).map((book) => book.id);
    const lossByLibrary = new Map<number, Promise<AccessLoss>>();
    const lossFor = (libraryId: number): Promise<AccessLoss> => {
      let loss = lossByLibrary.get(libraryId);
      if (!loss) {
        loss = this.accessLoss(books, libraryId);
        lossByLibrary.set(libraryId, loss);
      }
      return loss;
    };
    let destination: BookContext | null;
    if (request.destinationBookId !== undefined) {
      if (!allIds.includes(request.destinationBookId)) throw new BadRequestException('The destination must be one of the merged books.');
      destination = destinationCandidates.includes(request.destinationBookId) ? bookById(request.destinationBookId) : null;
      if (!destination && isFilePerBook(bookById(request.destinationBookId)))
        blockers.push({ code: 'FILE_PER_BOOK_LIBRARY', bookId: request.destinationBookId });
    } else {
      // Where nobody else loses the book comes first; then the kept book's own folder, as within one library.
      let chosen = destinationCandidates[0];
      if (involvedLibraryIds.length > 1) {
        for (const id of destinationCandidates) {
          if ((await lossFor(bookById(id).libraryId)).readers.size === 0) {
            chosen = id;
            break;
          }
        }
      }
      destination = chosen !== undefined ? bookById(chosen) : null;
    }
    // A10: when every book is a single file at the top of its folder, the kept book gets a folder of its own.
    let newFolderPath: string | null = null;
    if (!destination && destinationCandidates.length === 0 && (request.destinationBookId ?? target.id) === target.id && !isFilePerBook(target)) {
      newFolderPath = await this.newFolderFor(target, target.libraryId);
      if (newFolderPath) destination = { ...target, folderPath: newFolderPath, folder: { base: newFolderPath, rootLevel: false } };
    }
    if (!destination && !blockers.some((blocker) => blocker.code === 'FILE_PER_BOOK_LIBRARY')) {
      blockers.push({ code: destinationCandidates.length === 0 && books.some(isFilePerBook) ? 'FILE_PER_BOOK_LIBRARY' : 'NO_DESTINATION_FOLDER' });
    }
    const libraryId = destination?.libraryId ?? target.libraryId;
    const crossLibrary = involvedLibraryIds.length > 1;
    const movingIds = books.filter((book) => book.libraryId !== libraryId).map((book) => book.id);

    // Readers who lose the book: a decision only someone who sees them may take.
    const loss: AccessLoss = crossLibrary ? await lossFor(libraryId) : { readers: new Set(), hiddenRequestIds: [] };
    if (loss.readers.size > 0) {
      if (seeOthers) warnings.push({ code: 'LIBRARY_ACCESS_NARROWS', libraryId, count: loss.readers.size });
      else blockers.push({ code: 'READERS_LOSE_ACCESS', libraryId });
    }
    const destinationAccessLoss = crossLibrary
      ? await Promise.all(
          destinationCandidates.map(async (id) => {
            const readers = (await lossFor(bookById(id).libraryId)).readers.size;
            return { bookId: id, libraryId: bookById(id).libraryId, losesAccess: readers > 0, count: seeOthers ? readers : null };
          }),
        )
      : [];
    if (destination && target.libraryId !== libraryId) warnings.push({ code: 'TARGET_CHANGES_LIBRARY', bookId: target.id, libraryId });

    // Fields.
    const orderedFacts = [target.facts, ...sources.map((source) => source.facts)];
    const fieldSources = resolveFieldSources(orderedFacts, request.fieldOverrides ?? {});
    const fields = this.fieldPreviews(orderedFacts, resolveFieldSources(orderedFacts));
    for (const source of sources) {
      if (fieldSources.get('isbn') !== source.id && !isBlankField('isbn', source.facts)) {
        const kept = fieldValue('isbn', books.find((book) => book.id === fieldSources.get('isbn'))!.facts);
        if (stableJson(kept) !== stableJson(fieldValue('isbn', source.facts))) warnings.push({ code: 'ISBN_DROPPED', bookId: source.id });
      }
    }

    // Files.
    const filePlan = destination
      ? await this.planFiles(target, sources, destination, libraryId, libraries, blockers, warnings)
      : { entries: [], steps: [], identicalPairs: [] as Array<{ loserFileId: number; survivorFileId: number }> };

    // Readers, visibility, services.
    const userData = await this.userData(
      sources.map((source) => source.id),
      user,
      warnings,
    );
    const visibility = await this.visibility(target, sources, libraryId, request, user, warnings);
    const koboEntitlements = await this.repository.countKoboEntitlements(sources.map((source) => source.id));
    if (koboEntitlements > 0) warnings.push({ code: 'KOBO_REDELIVERY', ...(seeOthers ? { count: koboEntitlements } : {}) });
    const remoteConflicts = await this.repository.countRemoteBookConflicts(
      target.id,
      sources.map((source) => source.id),
    );
    if (remoteConflicts > 0) warnings.push({ code: 'REMOTE_BOOKS_DIFFER', ...(seeOthers ? { count: remoteConflicts } : {}) });

    // What a library boundary changes for the merged book.
    let librarySettingChanges: BookMergeLibrarySettingChange[] = [];
    let dailyStatsUserIds: number[] = [];
    if (destination && movingIds.length > 0) {
      const koboLosers = await this.repository.countKoboUsersLosingAccess(movingIds, libraryId);
      if (koboLosers > 0) warnings.push({ code: 'KOBO_REMOVAL', libraryId, ...(seeOthers ? { count: koboLosers } : {}) });
      const hiddenFields = await this.repository.countHiddenCustomFields(movingIds, libraryId);
      if (hiddenFields > 0) warnings.push({ code: 'CUSTOM_FIELDS_HIDDEN', libraryId, count: hiddenFields });
      for (const left of await this.repository.countCompanionRequestsLeftBehind(movingIds, libraryId)) {
        warnings.push({ code: 'COMPANION_REQUEST_STAYS', libraryId: left.libraryId, ...(seeOthers ? { count: left.count } : {}) });
      }
      librarySettingChanges = this.librarySettingChanges(books, target, libraryId, libraries);
      dailyStatsUserIds = await this.repository.findSessionReaders(movingIds);
    }

    const activity = await this.repository.countActivity(uniqueIds, user.id);
    const uniqueBlockers = this.dedupeBlockers(blockers);
    const eligible = uniqueBlockers.length === 0;
    const previewToken = eligible
      ? await this.previewToken(books, destination?.id ?? null, libraryId, loss, { warnings, librarySettingChanges })
      : null;
    const canDelete = user.isSuperuser || user.permissions.includes(Permission.LibraryDeleteBooks);

    const preview: BookMergePreviewResponse = {
      eligible,
      blockers: uniqueBlockers,
      warnings,
      books: books.map((book) => this.summary(book, activity.get(book.id), seeOthers, libraries.get(book.libraryId)?.name)),
      targetBookId: target.id,
      destinationBookId: destination?.id ?? null,
      destinationCandidates,
      newFolderRelPath: newFolderPath ? relative(target.libraryFolderPath, newFolderPath) : null,
      fields,
      files: filePlan.entries,
      userData,
      visibility: {
        tags: visibility.tags,
        genres: visibility.genres,
        canOverride: seeOthers,
        resultTags: visibility.resultTags,
        resultGenres: visibility.resultGenres,
      },
      canRemoveIdenticalCopies: canDelete && filePlan.identicalPairs.length > 0,
      destinationLibraryId: destination ? libraryId : null,
      destinationAccessLoss,
      librarySettingChanges,
      previewToken,
    };

    if (!eligible || !destination) return { preview, plan: null };
    return {
      preview,
      plan: {
        libraryId,
        libraryIds: involvedLibraryIds,
        dailyStatsUserIds,
        targetBookId: target.id,
        destinationBookId: destination.id,
        destination: {
          libraryFolderId: destination.libraryFolderId,
          libraryFolderPath: destination.libraryFolderPath,
          folderPath: destination.folderPath,
        },
        steps: filePlan.steps,
        fieldSources: Object.fromEntries(fieldSources),
        excludeTagIds: visibility.excludeTagIds,
        excludeGenreIds: visibility.excludeGenreIds,
        hiddenRequestIds: [...new Set([...visibility.hiddenRequestIds, ...loss.hiddenRequestIds])].sort((a, b) => a - b),
        identicalPairs: filePlan.identicalPairs,
        deleteIdenticalCopies: request.deleteIdenticalCopies === true && canDelete,
        watched: involvedLibraryIds.some((id) => libraries.get(id)?.watch === true),
      },
    };
  }

  /**
   * Who loses sight of the book when it lives in `libraryId`: readers with data on a book now in a
   * library they can open, who cannot open that one. Requests whose people cannot see it afterwards
   * stay on the merged-away book, as for content filters.
   */
  private async accessLoss(books: BookContext[], libraryId: number): Promise<AccessLoss> {
    const moving = books.filter((book) => book.libraryId !== libraryId).map((book) => book.id);
    if (moving.length === 0) return { readers: new Set(), hiddenRequestIds: [] };
    const readers = await this.repository.findReadersLosingAccess(moving, libraryId);
    const requests = await this.repository.findRequestsOnBooks(moving);
    const blind = await this.repository.findUsersWithoutLibraryAccess([...new Set(requests.flatMap((link) => link.userIds))], libraryId);
    const hiddenRequestIds: number[] = [];
    for (const link of requests) {
      const losing = link.userIds.filter((userId) => blind.has(userId));
      if (losing.length === 0) continue;
      hiddenRequestIds.push(link.id);
      for (const userId of losing) readers.add(userId);
    }
    return { readers, hiddenRequestIds };
  }

  /** The destination library's settings that apply to the merged book differently than a moving book's old library's did. */
  private librarySettingChanges(
    books: BookContext[],
    target: BookContext,
    libraryId: number,
    libraries: Map<number, MergeLibraryRow>,
  ): BookMergeLibrarySettingChange[] {
    const destination = libraries.get(libraryId)!;
    const changes: BookMergeLibrarySettingChange[] = [];
    const contentFiles = books.flatMap((book) => book.files.filter((file) => file.role === 'content'));
    const currentPrimary = target.files.find((file) => file.id === target.primaryFileId) ?? null;
    const winner = selectMovedPrimary(contentFiles, target.primaryFileId, {
      formatPriority: destination.formatPriority,
      allowedFormats: destination.allowedFormats,
    });
    if (winner?.format && winner.format !== currentPrimary?.format) {
      changes.push({ setting: 'primaryFormat', fromLibraryId: target.libraryId, toLibraryId: libraryId, format: winner.format });
    }
    const leaving = [...new Set(books.filter((book) => book.libraryId !== libraryId).map((book) => book.libraryId))];
    for (const fromLibraryId of leaving) {
      const from = libraries.get(fromLibraryId);
      if (!from) continue;
      if (destination.fileWriteEnabled && !from.fileWriteEnabled) changes.push({ setting: 'fileWrite', fromLibraryId, toLibraryId: libraryId });
      if ((destination.fileNamingPattern ?? '') !== (from.fileNamingPattern ?? '')) {
        changes.push({ setting: 'namingPattern', fromLibraryId, toLibraryId: libraryId });
      }
    }
    return changes;
  }

  private validateOverrides(request: PlanRequest, allIds: number[]): void {
    for (const [field, bookId] of Object.entries(request.fieldOverrides ?? {})) {
      if (!(BOOK_MERGE_FIELDS as readonly string[]).includes(field)) throw new BadRequestException(`Unknown field ${field}`);
      if (!allIds.includes(bookId as number)) throw new BadRequestException(`Book ${String(bookId)} is not part of this merge`);
    }
  }

  /** A free folder beside the kept book's file, named after the file, suffixed when the name is taken on disk or in the library. */
  private async newFolderFor(target: BookContext, libraryId: number): Promise<string | null> {
    const file =
      target.files.find((candidate) => candidate.id === target.primaryFileId) ?? target.files.find((candidate) => candidate.role === 'content');
    if (!file) return null;
    const parent = dirname(file.absolutePath);
    const stem = basename(file.absolutePath, extname(file.absolutePath)).trim();
    if (!stem || stem.startsWith('.') || /[. ]$/.test(stem)) return null;
    let taken: Set<string>;
    try {
      taken = new Set((await readdir(parent, { withFileTypes: true })).map((entry) => entry.name.toLowerCase()));
    } catch {
      return null;
    }
    for (let attempt = 1; attempt <= MAX_SUFFIX_ATTEMPTS; attempt++) {
      const candidate = attempt === 1 ? join(parent, stem) : withCollisionSuffix(join(parent, stem), attempt, '');
      if (!isInsideRoot(target.libraryFolderPath, candidate)) return null;
      if (taken.has(basename(candidate).toLowerCase())) continue;
      if (await this.repository.isFolderInUse(libraryId, candidate)) continue;
      return candidate;
    }
    return null;
  }

  private folderOf(book: MergeBookRow, files: MergeFileRow[]): Folder {
    const rootLevel = files.some((file) => file.absolutePath === book.folderPath) || book.folderPath === book.libraryFolderPath;
    return { base: rootLevel ? dirname(book.folderPath) : book.folderPath, rootLevel };
  }

  private fieldPreviews(orderedFacts: BookFacts[], defaults: Map<BookMergeField, number>): BookMergeFieldPreview[] {
    const [target] = orderedFacts;
    return BOOK_MERGE_FIELDS.map((field) => {
      const candidates = orderedFacts.map((facts) => ({
        bookId: facts.bookId,
        value: fieldValue(field, facts),
        locked: isFieldLocked(field, facts),
      }));
      const distinct = new Set(orderedFacts.filter((facts) => !isBlankField(field, facts)).map((facts) => stableJson(fieldValue(field, facts))));
      return {
        field,
        candidates,
        defaultBookId: defaults.get(field) ?? target.bookId,
        differs: distinct.size > 1,
        lockedOnTarget: isFieldLocked(field, target),
      };
    });
  }

  // ── File plan (01-architecture.md section 4) ────────────────────────────────────────────────

  private async planFiles(
    target: BookContext,
    sources: BookContext[],
    destination: BookContext,
    libraryId: number,
    libraries: Map<number, MergeLibraryRow>,
    blockers: BookMergeBlocker[],
    warnings: BookMergeWarning[],
  ) {
    const destFolder = destination.folderPath;
    const destRoot = destination.libraryFolderPath;
    const targetCoverMediums = new Set(await this.repository.findCoverMediums(target.id));
    // B7/B8: a source's cover image only moves when it could fill a slot the kept book lacks.
    const keptHasCoverFor = (book: BookContext): boolean => {
      const served = coverMediaOf(book.files);
      return served.length === 0 ? targetCoverMediums.size > 0 : served.every((medium) => targetCoverMediums.has(medium));
    };
    const dirListings = new Map<string, Map<string, boolean>>();
    const listDir = async (directory: string): Promise<Map<string, boolean>> => {
      const cached = dirListings.get(directory);
      if (cached) return cached;
      const entries = new Map<string, boolean>();
      try {
        for (const entry of await readdir(directory, { withFileTypes: true })) entries.set(entry.name.toLowerCase(), entry.isDirectory());
      } catch {
        // A folder that does not exist yet has nothing in it.
      }
      dirListings.set(directory, entries);
      return entries;
    };

    const onDisk = new Map<number, DiskInfo | null>();
    for (const book of [target, ...sources]) {
      for (const file of book.files) {
        try {
          const info = await stat(file.absolutePath);
          onDisk.set(file.id, { size: info.size, mtimeMs: info.mtimeMs, dev: info.dev, nlink: info.nlink });
        } catch {
          onDisk.set(file.id, null);
        }
      }
    }
    const destDev =
      (
        await stat(destFolder)
          .catch(() => stat(dirname(destFolder)))
          .catch(() => null)
      )?.dev ?? null;
    // The kept book is a root-level file wrapped into a new folder: its files move like a source's.
    const wrapping = destination.id === target.id && destination.folderPath !== target.folderPath;

    const entries: BookMergeFilePlanEntry[] = [];
    const steps = new Map<number, MergeStep>();
    const stepFor = (sourceId: number): MergeStep => {
      let step = steps.get(sourceId);
      if (!step) {
        step = { sourceBookId: sourceId, moves: [], targetFileIds: [], droppedSidecarFileIds: [], vacatedFolders: [], roots: [destRoot] };
        steps.set(sourceId, step);
      }
      return step;
    };
    const destinationStepId = destination.id === target.id ? null : destination.id;
    const firstStepId = destinationStepId ?? sources[0]?.id;
    const claimed = new Set<string>();
    // Paths the hides empty before anything moves in (B28): the kept book's own metadata file takes them.
    const freed = new Set<string>();
    const pending: Array<{ book: BookContext; file: MergeFileRow; rel: string; suffixable: boolean; entry: BookMergeFilePlanEntry }> = [];

    const relTo = (absolute: string) => relative(destRoot, absolute);
    const pushEntry = (
      book: BookContext,
      file: MergeFileRow,
      toRelPath: string,
      action: BookMergeFilePlanEntry['action'],
      reason: BookMergeFilePlanEntry['reason'],
    ) => {
      const entry: BookMergeFilePlanEntry = {
        fileId: file.id,
        bookId: book.id,
        role: file.role,
        format: file.format,
        fromRelPath: file.relPath ?? basename(file.absolutePath),
        toRelPath,
        action,
        reason,
        renamed: false,
        identical: false,
        crossDevice: false,
        sizeBytes: file.sizeBytes,
        fromLibraryId: book.libraryId,
        toLibraryId: action === 'move' ? libraryId : book.libraryId,
      };
      entries.push(entry);
      return entry;
    };

    // The destination's own files are already in place; its metadata files are hidden so they
    // never win OPF selection for the kept book.
    if (destinationStepId !== null) {
      const step = stepFor(destinationStepId);
      for (const file of destination.files) {
        if (file.role === 'metadata' && onDisk.get(file.id)) {
          freed.add(file.absolutePath.toLowerCase());
          const hidden = join(dirname(file.absolutePath), `.merged-${destination.id}-${basename(file.absolutePath)}`);
          step.moves.push(this.move(file, destination.id, hidden, relTo(hidden), 'hide', onDisk.get(file.id)!, false));
          step.droppedSidecarFileIds.push(file.id);
          pushEntry(destination, file, relTo(hidden), 'hide', 'metadata_hidden');
          warnings.push({ code: 'SIDECARS_LEFT_BEHIND', bookId: destination.id, count: 1 });
        } else {
          claimed.add(file.absolutePath.toLowerCase());
          pushEntry(destination, file, file.relPath ?? relTo(file.absolutePath), 'stay', 'already_in_destination');
        }
      }
    } else if (!wrapping) {
      for (const file of target.files) {
        claimed.add(file.absolutePath.toLowerCase());
        pushEntry(target, file, file.relPath ?? relTo(file.absolutePath), 'stay', 'already_in_destination');
      }
    }

    // Everything that moves, the kept book's own files first when the destination is a source's folder.
    const movers = [...(destination.id === target.id && !wrapping ? [] : [target]), ...sources.filter((source) => source.id !== destination.id)];
    for (const book of movers) {
      const isTarget = book.id === target.id;
      const step = stepFor(isTarget ? firstStepId! : book.id);
      // A file-per-book library's book shares its folder with other books: only its own files leave.
      const fileLevel = book.folder.rootLevel || isFilePerBook(book);
      if (!fileLevel) step.vacatedFolders.push(book.folderPath);
      if (!step.roots.includes(book.libraryFolderPath)) step.roots.push(book.libraryFolderPath);
      for (const file of book.files) {
        const rel = fileLevel ? basename(file.absolutePath) : relative(book.folder.base, file.absolutePath);
        const disk = onDisk.get(file.id);
        if (!disk) {
          pushEntry(book, file, file.relPath ?? rel, 'stay', 'missing');
          continue;
        }
        if (file.role === 'metadata' && !isTarget) {
          step.droppedSidecarFileIds.push(file.id);
          pushEntry(book, file, file.relPath ?? rel, 'stay', 'metadata_kept_in_place');
          continue;
        }
        if (file.role === 'cover' && !isTarget && keptHasCoverFor(book)) {
          step.droppedSidecarFileIds.push(file.id);
          pushEntry(book, file, file.relPath ?? rel, 'stay', 'cover_kept_in_place');
          continue;
        }
        const suffixable = file.role === 'content' || file.role === 'supplement';
        const entry = pushEntry(book, file, rel, 'move', file.role === 'cover' ? 'cover' : file.role === 'supplement' ? 'supplement' : 'content');
        pending.push({ book, file, rel, suffixable, entry });
      }
    }

    // Collisions, case-insensitive against disk, the planned set and every file row.
    const owners = new Map<string, number>();
    // A freed path's row is the hidden file's, retired in the same step.
    const ownedByOther = (key: string) => owners.has(key) && !(freed.has(key) && owners.get(key) === destination.id);
    const checked = new Set<string>();
    const resolved = new Map<number, string | null>();
    for (let round = 0; round < MAX_OWNER_ROUNDS; round++) {
      resolved.clear();
      const roundClaims = new Set(claimed);
      const unchecked = new Set<string>();
      for (const item of pending) {
        const wanted = join(destFolder, item.rel);
        let chosen: string | null = null;
        for (let attempt = 1; attempt <= (item.suffixable ? MAX_SUFFIX_ATTEMPTS : 1); attempt++) {
          const candidate = attempt === 1 ? wanted : withCollisionSuffix(wanted, attempt, extname(wanted));
          const key = candidate.toLowerCase();
          if (!checked.has(key)) unchecked.add(candidate);
          if (roundClaims.has(key) || ownedByOther(key)) continue;
          if (!freed.has(key) && (await listDir(dirname(candidate))).has(basename(candidate).toLowerCase())) continue;
          chosen = candidate;
          break;
        }
        resolved.set(item.file.id, chosen);
        if (chosen) roundClaims.add(chosen.toLowerCase());
      }
      const fresh = [...unchecked].filter((path) => !checked.has(path.toLowerCase()));
      if (fresh.length === 0) break;
      const found = await this.repository.findPathOwners(libraryId, fresh);
      for (const path of fresh) checked.add(path.toLowerCase());
      for (const [path, bookId] of found) owners.set(path, bookId);
      if (found.size === 0) break;
    }
    // Owners found in the last round never got a round of their own: a path one of them holds is a conflict.
    for (const [fileId, chosen] of resolved) {
      if (chosen && ownedByOther(chosen.toLowerCase())) resolved.set(fileId, null);
    }

    const anchorsRenamed = new Map<number, Set<string>>();
    for (const item of pending) {
      const to = resolved.get(item.file.id) ?? null;
      const step = stepFor(item.book.id === target.id ? firstStepId! : item.book.id);
      const disk = onDisk.get(item.file.id)!;
      if (!to) {
        if (item.suffixable) {
          blockers.push({ code: 'PATH_CONFLICT', bookId: item.book.id, relPath: relTo(join(destFolder, item.rel)) });
        } else {
          item.entry.action = 'stay';
          item.entry.reason = item.file.role === 'cover' ? 'cover_kept_in_place' : 'metadata_kept_in_place';
          item.entry.toLibraryId = item.book.libraryId;
          step.droppedSidecarFileIds.push(item.file.id);
        }
        continue;
      }
      const renamed = to !== join(destFolder, item.rel);
      const crossDevice = destDev !== null && disk.dev !== destDev;
      item.entry.toRelPath = relTo(to);
      item.entry.renamed = renamed;
      item.entry.crossDevice = crossDevice;
      if (renamed && item.file.role === 'content' && !item.rel.includes(sep)) {
        const stems = anchorsRenamed.get(item.book.id) ?? new Set<string>();
        stems.add(basename(item.rel, extname(item.rel)).toLowerCase());
        anchorsRenamed.set(item.book.id, stems);
      }
      // A content file landing at the top of the destination next to a folder named like its stem
      // would be folded into that folder's book by the scanner.
      if (item.file.role === 'content' && dirname(to) === destFolder) {
        const stem = basename(to, extname(to)).toLowerCase();
        if ((await listDir(destFolder)).get(stem) === true) blockers.push({ code: 'NESTED_BOOK_CONFLICT', bookId: item.book.id, relPath: relTo(to) });
      }
      step.moves.push(this.move(item.file, item.book.id, to, relTo(to), 'move', disk, crossDevice));
      if (item.book.id === target.id) step.targetFileIds.push(item.file.id);
      if (item.book.libraryId !== libraryId) this.checkDestinationRules(item.book, item.file, to, destination, libraries.get(libraryId)!, blockers);
    }
    // A stem-named subfolder only stays one book with its anchor file if the anchor keeps its name.
    for (const item of pending) {
      const stems = anchorsRenamed.get(item.book.id);
      if (!stems || !item.rel.includes(sep)) continue;
      if (stems.has(item.rel.split(sep)[0].toLowerCase())) blockers.push({ code: 'NESTED_BOOK_CONFLICT', bookId: item.book.id, relPath: item.rel });
    }

    // Hides first (they free the destination of the source's OPF), then the kept book's files, then the source's.
    const rank = (move: PlannedMove) => (move.kind === 'hide' ? 0 : move.bookId === target.id ? 1 : 2);
    for (const step of steps.values()) step.moves.sort((a, b) => rank(a) - rank(b));

    // Writability of every folder written to or emptied, each named inside its own library.
    // A new folder does not exist yet; its parent is where it gets created.
    const booksById = new Map([target, ...sources].map((book) => [book.id, book]));
    const folders = new Map<string, { root: string; libraryId: number }>([
      [wrapping ? dirname(destFolder) : destFolder, { root: destRoot, libraryId }],
    ]);
    for (const step of steps.values()) {
      for (const move of step.moves) {
        const owner = booksById.get(move.bookId);
        const folder = dirname(move.from);
        if (owner && !folders.has(folder)) folders.set(folder, { root: owner.libraryFolderPath, libraryId: owner.libraryId });
      }
    }
    for (const [folder, { root, libraryId: folderLibraryId }] of folders) {
      try {
        await access(folder, fsConstants.W_OK);
      } catch {
        blockers.push({ code: 'FOLDER_NOT_WRITABLE', libraryId: folderLibraryId, relPath: relative(root, folder) || '.' });
      }
    }

    const identicalPairs = await this.findIdenticalCopies([target, ...sources], onDisk, entries);
    this.fileWarnings(entries, identicalPairs.length, destination, target, warnings);
    await this.leftoverWarning(steps, warnings);
    const crossDeviceMoves = [...steps.values()].flatMap((step) => step.moves.filter((move) => move.kind === 'move' && move.crossDevice));
    const hardlinked = crossDeviceMoves.filter((move) => (onDisk.get(move.fileId)?.nlink ?? 1) > 1).length;
    if (hardlinked > 0) warnings.push({ code: 'HARDLINKED_FILES', count: hardlinked });
    await this.checkSpace(
      wrapping ? dirname(destFolder) : destFolder,
      destRoot,
      crossDeviceMoves.reduce((bytes, move) => bytes + (move.expectedSize ?? 0), 0),
      blockers,
    );
    const moved = new Set([...steps.values()].flatMap((step) => step.moves.map((move) => move.from)));
    for (const book of movers) {
      if (book.libraryId === libraryId || book.folder.rootLevel || isFilePerBook(book)) continue;
      await this.checkLeftoverContent(
        book,
        moved,
        new Set([target, ...sources].map((merged) => merged.id)),
        libraries.get(book.libraryId)!,
        blockers,
      );
    }

    const orderedSteps = [...steps.values()].sort((a, b) =>
      a.sourceBookId === destinationStepId
        ? -1
        : b.sourceBookId === destinationStepId
          ? 1
          : sources.findIndex((s) => s.id === a.sourceBookId) - sources.findIndex((s) => s.id === b.sourceBookId),
    );
    for (const source of sources) if (!steps.has(source.id)) orderedSteps.push(stepFor(source.id));
    return { entries, steps: orderedSteps, identicalPairs };
  }

  /** A file entering another library must be one that library's scanner keeps: an allowed format, a path it does not exclude. */
  private checkDestinationRules(
    book: BookContext,
    file: MergeFileRow,
    to: string,
    destination: BookContext,
    library: MergeLibraryRow,
    blockers: BookMergeBlocker[],
  ): void {
    const allowed = library.allowedFormats.map((format) => format.toLowerCase());
    if (file.role === 'content' && allowed.length > 0 && (!file.format || !allowed.includes(file.format.toLowerCase()))) {
      blockers.push({ code: 'FORMAT_NOT_ALLOWED', bookId: book.id, libraryId: library.id, format: file.format ?? '' });
    }
    if (isExcludedPath(destination.libraryFolderPath, to, buildNameExcludeMatcher(library.excludePatterns))) {
      blockers.push({ code: 'PATH_EXCLUDED', bookId: book.id, libraryId: library.id, relPath: relative(destination.libraryFolderPath, to) });
    }
  }

  /** Files copied onto another drive need room there, with a margin left for everything else on it. */
  private async checkSpace(folder: string, root: string, bytes: number, blockers: BookMergeBlocker[]): Promise<void> {
    if (bytes <= 0) return;
    const info = await statfs(folder, { bigint: true })
      .catch(() => statfs(root, { bigint: true }))
      .catch(() => null);
    if (!info) return;
    const available = Number(info.bavail * info.bsize);
    const margin = Math.min(Number(info.blocks * info.bsize) * SPACE_MARGIN_RATIO, SPACE_MARGIN_MAX_BYTES);
    if (available - margin < bytes) blockers.push({ code: 'INSUFFICIENT_SPACE', bytes });
  }

  /**
   * A book file left in a folder the merge empties, in a library the merged book leaves, would come
   * back as a new book on that library's next scan. Files another book owns are that book's.
   */
  private async checkLeftoverContent(
    book: BookContext,
    moved: Set<string>,
    mergedIds: Set<number>,
    library: MergeLibraryRow,
    blockers: BookMergeBlocker[],
  ): Promise<void> {
    const excluded = buildNameExcludeMatcher(library.excludePatterns);
    const allowed = library.allowedFormats.map((format) => format.toLowerCase());
    const found: string[] = [];
    let seen = 0;
    const walk = async (directory: string): Promise<void> => {
      let dirEntries;
      try {
        dirEntries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of dirEntries) {
        if (seen >= LEFTOVER_SCAN_LIMIT) return;
        if (excluded(entry.name)) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        seen++;
        if (moved.has(path)) continue;
        const { role, format } = classifyFile(path);
        if (role !== 'content' || (allowed.length > 0 && (!format || !allowed.includes(format)))) continue;
        found.push(path);
      }
    };
    await walk(book.folderPath);
    if (found.length === 0) return;
    const owners = await this.repository.findPathOwners(book.libraryId, found);
    let reported = 0;
    for (const path of found) {
      const owner = owners.get(path.toLowerCase());
      if (owner !== undefined && !mergedIds.has(owner)) continue;
      blockers.push({ code: 'LEFTOVER_CONTENT', bookId: book.id, libraryId: book.libraryId, relPath: relative(book.libraryFolderPath, path) });
      if (++reported >= LEFTOVER_CONTENT_REPORT_LIMIT) return;
    }
  }

  private move(
    file: MergeFileRow,
    bookId: number,
    to: string,
    relPath: string,
    kind: PlannedMove['kind'],
    disk: { size: number; mtimeMs: number },
    crossDevice: boolean,
  ): PlannedMove {
    return {
      fileId: file.id,
      bookId,
      from: file.absolutePath,
      to,
      relPath,
      kind,
      expectedSize: disk.size,
      expectedMtimeMs: Math.trunc(disk.mtimeMs),
      crossDevice,
    };
  }

  /** Equal sampled hash and size make a candidate; only a full content hash makes it identical. */
  private async findIdenticalCopies(
    books: BookContext[],
    onDisk: Map<number, { size: number } | null>,
    entries: BookMergeFilePlanEntry[],
  ): Promise<Array<{ loserFileId: number; survivorFileId: number }>> {
    const contentFiles = books.flatMap((book) => book.files.filter((file) => file.role === 'content' && file.fileHash && onDisk.get(file.id)));
    const groups = new Map<string, MergeFileRow[]>();
    for (const file of contentFiles) {
      const key = `${file.fileHash}:${onDisk.get(file.id)!.size}`;
      groups.set(key, [...(groups.get(key) ?? []), file]);
    }
    const candidates = [...groups.values()].filter((group) => new Set(group.map((file) => file.bookId)).size > 1);
    const pairs: Array<{ loserFileId: number; survivorFileId: number }> = [];
    const queue = candidates.flat();
    const hashes = new Map<number, string>();
    await Promise.all(
      Array.from({ length: Math.min(HASH_CONCURRENCY, queue.length) }, async () => {
        for (let file = queue.shift(); file; file = queue.shift()) hashes.set(file.id, await this.fullHash(file));
      }),
    );
    const order = new Map(books.map((book, index) => [book.id, index]));
    for (const group of candidates) {
      const byHash = new Map<string, MergeFileRow[]>();
      for (const file of group) {
        const hash = hashes.get(file.id);
        if (hash) byHash.set(hash, [...(byHash.get(hash) ?? []), file]);
      }
      for (const same of byHash.values()) {
        if (new Set(same.map((file) => file.bookId)).size < 2) continue;
        const [survivor, ...losers] = [...same].sort((a, b) => order.get(a.bookId)! - order.get(b.bookId)! || a.id - b.id);
        for (const loser of losers) {
          if (loser.bookId === survivor.bookId) continue;
          pairs.push({ loserFileId: loser.id, survivorFileId: survivor.id });
          const entry = entries.find((candidate) => candidate.fileId === loser.id);
          if (entry) entry.identical = true;
        }
      }
    }
    return pairs;
  }

  private async fullHash(file: MergeFileRow): Promise<string> {
    const info = await stat(file.absolutePath);
    const key = `${file.absolutePath}:${info.size}:${info.mtimeMs}`;
    const cached = this.hashCache.get(key);
    if (cached) return cached;
    const hash = await computeContentHash(file.absolutePath);
    if (this.hashCache.size >= HASH_CACHE_LIMIT) this.hashCache.delete(this.hashCache.keys().next().value!);
    this.hashCache.set(key, hash);
    return hash;
  }

  private fileWarnings(
    entries: BookMergeFilePlanEntry[],
    identicalCount: number,
    destination: BookContext,
    target: BookContext,
    warnings: BookMergeWarning[],
  ): void {
    const crossBytes = entries
      .filter((entry) => entry.action === 'move' && entry.crossDevice)
      .reduce((sum, entry) => sum + (entry.sizeBytes ?? 0), 0);
    if (crossBytes > 0) warnings.push({ code: 'CROSS_DEVICE_COPY', bytes: crossBytes });
    if (identicalCount > 0) warnings.push({ code: 'IDENTICAL_COPIES', count: identicalCount });
    const renamed = entries.filter((entry) => entry.renamed).length;
    if (renamed > 0) warnings.push({ code: 'RENAMED_ON_COLLISION', count: renamed });
    if (destination.id !== target.id && entries.some((entry) => entry.bookId === target.id && entry.action === 'move')) {
      warnings.push({ code: 'DESTINATION_MOVES_TARGET', bookId: destination.id });
    }
    const leftSidecars = entries.filter((entry) => entry.reason === 'metadata_kept_in_place' || entry.reason === 'cover_kept_in_place').length;
    const existing = warnings.find((warning) => warning.code === 'SIDECARS_LEFT_BEHIND');
    if (leftSidecars > 0) {
      if (existing) existing.count = (existing.count ?? 0) + leftSidecars;
      else warnings.push({ code: 'SIDECARS_LEFT_BEHIND', count: leftSidecars });
    }
  }

  /** Files in a folder being emptied that the merge does not move, counted up to a bound. */
  private async leftoverWarning(steps: Map<number, MergeStep>, warnings: BookMergeWarning[]): Promise<void> {
    const moved = new Set<string>();
    for (const step of steps.values()) for (const move of step.moves) moved.add(move.from);
    let count = 0;
    const walk = async (directory: string): Promise<void> => {
      if (count >= LEFTOVER_SCAN_LIMIT) return;
      let dirEntries;
      try {
        dirEntries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of dirEntries) {
        if (count >= LEFTOVER_SCAN_LIMIT) return;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (!moved.has(path)) count++;
      }
    };
    for (const step of steps.values()) for (const folder of step.vacatedFolders) await walk(folder);
    if (count > 0) warnings.push({ code: 'LEFTOVER_FILES', count });
  }

  // ── Readers ─────────────────────────────────────────────────────────────────────────────────

  private async userData(sourceIds: number[], user: RequestUser, warnings: BookMergeWarning[]): Promise<BookMergeUserData> {
    const rows = await this.repository.countUserData(sourceIds, user.id);
    const build = (mine: boolean): BookMergeUserDataCount[] =>
      BOOK_MERGE_USER_DATA_CATEGORIES.map((category) => {
        const row = rows.find((candidate) => candidate.category === category && candidate.mine === mine);
        return { category, rows: row?.rows ?? 0, users: row?.users ?? 0 };
      }).filter((count) => count.rows > 0);
    const others = build(false);
    const otherReaders = Math.max(0, ...rows.filter((row) => !row.mine).map((row) => row.users));
    if (others.length > 0) warnings.push({ code: 'OTHER_READERS_AFFECTED', ...(canSeeOthers(user) ? { count: otherReaders } : {}) });
    return { own: build(true), others: canSeeOthers(user) ? others : null, otherReadersAffected: others.length > 0 };
  }

  /** 01-architecture.md 3.6: a merge never quietly shows the kept book to a filtered reader, or hides it. */
  private async visibility(
    target: BookContext,
    sources: BookContext[],
    libraryId: number,
    request: PlanRequest,
    user: RequestUser,
    warnings: BookMergeWarning[],
  ) {
    const ids = [target.id, ...sources.map((source) => source.id)];
    const { tags, genres } = await this.repository.loadTagsAndGenres(ids);
    const readers = await this.repository.findRestrictedReaders(libraryId);
    const tagsOf = (bookId: number) => new Set(tags.filter((row) => row.bookId === bookId).map((row) => row.id));
    const genresOf = (bookId: number) => new Set(genres.filter((row) => row.bookId === bookId).map((row) => row.id));
    const targetTags = tagsOf(target.id);
    const targetGenres = genresOf(target.id);

    const evaluate = (kind: 'tag' | 'genre', locked: boolean, rows: Array<{ bookId: number; id: number; name: string }>, current: Set<number>) => {
      const candidates: BookMergeVisibilityCandidate[] = [];
      if (locked) return candidates;
      const seen = new Set<number>();
      for (const row of rows) {
        if (row.bookId === target.id || current.has(row.id) || seen.has(row.id)) continue;
        seen.add(row.id);
        let widens = false;
        let narrows = false;
        for (const reader of readers) {
          const nextTags = kind === 'tag' ? new Set([...targetTags, row.id]) : targetTags;
          const nextGenres = kind === 'genre' ? new Set([...targetGenres, row.id]) : targetGenres;
          const before = passesFilter(reader.rules, targetTags, targetGenres);
          const after = passesFilter(reader.rules, nextTags, nextGenres);
          if (!before && after) widens = true;
          if (before && !after) narrows = true;
        }
        if (widens || narrows) candidates.push({ id: row.id, name: row.name, effect: widens ? 'widens' : 'narrows' });
      }
      return candidates;
    };
    const tagCandidates = evaluate('tag', target.facts.lockedFields.has('tags'), tags, targetTags);
    const genreCandidates = evaluate('genre', target.facts.lockedFields.has('genres'), genres, targetGenres);
    const includeTags = new Set(canSeeOthers(user) ? (request.includeTagIds ?? []) : []);
    const includeGenres = new Set(canSeeOthers(user) ? (request.includeGenreIds ?? []) : []);
    const excludeTagIds = tagCandidates.filter((candidate) => !includeTags.has(candidate.id)).map((candidate) => candidate.id);
    const excludeGenreIds = genreCandidates.filter((candidate) => !includeGenres.has(candidate.id)).map((candidate) => candidate.id);

    const widenTags = tagCandidates.filter((candidate) => candidate.effect === 'widens').map((candidate) => candidate.id);
    const widenGenres = genreCandidates.filter((candidate) => candidate.effect === 'widens').map((candidate) => candidate.id);
    if (widenTags.length > 0 || widenGenres.length > 0) warnings.push({ code: 'VISIBILITY_WIDENS', tagIds: widenTags, genreIds: widenGenres });

    // The kept book as it will be: its tags plus every united one not left out.
    const finalTags = new Set(targetTags);
    const finalGenres = new Set(targetGenres);
    if (!target.facts.lockedFields.has('tags')) for (const row of tags) if (!excludeTagIds.includes(row.id)) finalTags.add(row.id);
    if (!target.facts.lockedFields.has('genres')) for (const row of genres) if (!excludeGenreIds.includes(row.id)) finalGenres.add(row.id);
    const restricted = new Map(readers.map((reader) => [reader.userId, reader.rules]));
    const cannotSeeFinal = (userId: number) => {
      const rules = restricted.get(userId);
      return rules !== undefined && !passesFilter(rules, finalTags, finalGenres);
    };

    const sourceIds = sources.map((source) => source.id);
    const narrowedReaders = new Set<number>();
    const blindReaders = readers.filter(
      (reader) => cannotSeeFinal(reader.userId) && sources.some((source) => passesFilter(reader.rules, tagsOf(source.id), genresOf(source.id))),
    );
    for (const userId of await this.repository.findReadersWithData(
      sourceIds,
      blindReaders.map((reader) => reader.userId),
    ))
      narrowedReaders.add(userId);
    const hiddenRequestIds: number[] = [];
    for (const link of await this.repository.findRequestsOnBooks(sourceIds)) {
      const blind = link.userIds.filter(cannotSeeFinal);
      if (blind.length === 0) continue;
      hiddenRequestIds.push(link.id);
      for (const userId of blind) narrowedReaders.add(userId);
    }
    const narrowTags = tagCandidates.filter((candidate) => candidate.effect === 'narrows').map((candidate) => candidate.id);
    const narrowGenres = genreCandidates.filter((candidate) => candidate.effect === 'narrows').map((candidate) => candidate.id);
    if (narrowedReaders.size > 0 || narrowTags.length > 0 || narrowGenres.length > 0) {
      warnings.push({
        code: 'VISIBILITY_NARROWS',
        tagIds: narrowTags,
        genreIds: narrowGenres,
        ...(canSeeOthers(user) ? { count: narrowedReaders.size } : {}),
      });
    }
    const namesOf = (rows: Array<{ id: number; name: string }>, ids: Set<number>) =>
      [...new Map(rows.filter((row) => ids.has(row.id)).map((row) => [row.id, row.name])).values()].sort((a, b) => a.localeCompare(b));
    return {
      tags: tagCandidates,
      genres: genreCandidates,
      excludeTagIds,
      excludeGenreIds,
      hiddenRequestIds,
      resultTags: namesOf(tags, finalTags),
      resultGenres: namesOf(genres, finalGenres),
    };
  }

  // ── Output ──────────────────────────────────────────────────────────────────────────────────

  private summary(
    book: BookContext,
    activity: { highlights: number; shelves: number; hasProgress: boolean; readers: number } | undefined,
    seeOthers: boolean,
    libraryName: string | undefined,
  ): BookMergeBookSummary {
    const contentFiles = book.files.filter((file) => file.role === 'content');
    return {
      id: book.id,
      title: book.title ?? basename(book.folderPath),
      authors: book.facts.authors,
      libraryId: book.libraryId,
      status: book.status,
      formats: [...new Set(contentFiles.map((file) => file.format).filter((format): format is string => !!format))],
      fileCount: contentFiles.length,
      hasAudio: contentFiles.some((file) => file.format !== null && isAudioFormat(file.format)),
      folderRelPath: book.folder.rootLevel ? null : relative(book.libraryFolderPath, book.folderPath),
      canBeDestination: !book.folder.rootLevel,
      addedAt: book.addedAt ? book.addedAt.toISOString() : null,
      libraryFolderId: book.libraryFolderId,
      libraryFolderName: basename(book.libraryFolderPath),
      ...(libraryName !== undefined ? { libraryName } : {}),
      activity: activity
        ? {
            highlights: activity.highlights,
            shelves: activity.shelves,
            hasProgress: activity.hasProgress,
            readers: seeOthers ? activity.readers : null,
          }
        : { highlights: 0, shelves: 0, hasProgress: false, readers: seeOthers ? 0 : null },
    };
  }

  private dedupeBlockers(blockers: BookMergeBlocker[]): BookMergeBlocker[] {
    const seen = new Set<string>();
    return blockers.filter((blocker) => {
      const key = stableJson(blocker);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /** A hash of everything the reviewer saw. Execute recomputes it and refuses a stale one. */
  private async previewToken(
    books: BookContext[],
    destinationBookId: number | null,
    destinationLibraryId: number,
    loss: AccessLoss,
    notices: { warnings: BookMergeWarning[]; librarySettingChanges: BookMergeLibrarySettingChange[] },
  ): Promise<string> {
    const { tags, genres } = await this.repository.loadTagsAndGenres(books.map((book) => book.id));
    const payload = {
      destinationBookId,
      destinationLibraryId,
      // Who loses access was confirmed against this list: a grant or a new reader since makes it stale.
      accessLoss: [...loss.readers].sort((a, b) => a - b),
      // What the review told the user. A library setting or device change that only alters a warning
      // (a Kobo count, the primary format, hidden custom fields) still makes the preview stale.
      warnings: notices.warnings.map((warning) => stableJson(warning)).sort(),
      librarySettingChanges: notices.librarySettingChanges.map((change) => stableJson(change)).sort(),
      books: [...books]
        .sort((a, b) => a.id - b.id)
        .map((book) => ({
          id: book.id,
          updatedAt: book.updatedAt.toISOString(),
          metadataUpdatedAt: book.metadataUpdatedAt?.toISOString() ?? null,
          status: book.status,
          folderPath: book.folderPath,
          files: book.files.map((file) => [file.id, file.absolutePath, file.sizeBytes, file.mtime?.toISOString() ?? null]),
          tags: tags
            .filter((row) => row.bookId === book.id)
            .map((row) => row.id)
            .sort((a, b) => a - b),
          genres: genres
            .filter((row) => row.bookId === book.id)
            .map((row) => row.id)
            .sort((a, b) => a - b),
        })),
    };
    return createHash('sha256').update(stableJson(payload)).digest('hex').slice(0, 32);
  }
}
