import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BOOK_MERGE_FIELDS, type BookMergeField } from '@bookorbit/types';

import type { BookMergeSnapshot } from '../../db/schema';
import { BookConsolidationRepository, type ConsolidationTx, type FileRowUpdate } from './book-consolidation.repository';
import {
  AUDIO_EDITION_COLUMNS,
  BOOK_MERGE_FIELD_SPECS,
  FILL_ONLY_COLUMNS,
  audioOwnerOf,
  isBlankColumn,
  resolveFieldSources,
  type BookFacts,
} from './field-picks';
import { planReadingHistoryMerge } from './reading-history-merge';

export type { ConsolidationTx, FileRowUpdate } from './book-consolidation.repository';

/** `user_book_notes.note` limit enforced by the notes DTO. */
const NOTE_MAX_LENGTH = 10_000;
const READER_BATCH_SIZE = 500;

const AUDIO_COLUMN_LOCKS: Record<(typeof AUDIO_EDITION_COLUMNS)[number], string | null> = {
  durationSeconds: 'durationSeconds',
  abridged: 'abridged',
  chapters: 'chapters',
  chaptersSource: 'chapters',
  chaptersUpdatedAt: 'chapters',
  chaptersUpdatedBy: 'chapters',
  manifestLegacyRecorded: null,
};

export interface ConsolidateInput {
  targetBookId: number;
  sourceBookId: number;
  /**
   * The kept book's folder after the merge. Null keeps its own. A `libraryId` other than the kept
   * book's moves it to that library first, and the two books may then sit in different libraries:
   * only a caller holding every involved library's gate passes one.
   */
  destination: { libraryFolderId: number; folderPath: string; libraryId?: number } | null;
  /** The kept book's own file rows that moved (only when the destination is the source's folder). */
  targetFileUpdates?: FileRowUpdate[];
  /** The source's file rows that moved into the destination. Rows not listed keep their paths. */
  sourceFileUpdates?: FileRowUpdate[];
  /** The source's sidecar rows (covers, metadata files) that stayed behind or were hidden. */
  droppedSidecarFileIds?: number[];
  /** Which book each field comes from, decided over the whole request. Omitted: the defaults for this pair. */
  fieldSources?: ReadonlyMap<BookMergeField, number>;
  excludeTagIds?: number[];
  excludeGenreIds?: number[];
  /** Requests whose requester could not see the kept book: left to the delete, which nulls them. */
  hiddenRequestIds?: number[];
  mergedByUserId: number | null;
  jobId?: number | null;
  /** False for paths that merge a stray duplicate row rather than a book a client may have stored. */
  recordAlias?: boolean;
}

export interface AbsorbDuplicateInput {
  /** The book taking the duplicate's place: it keeps its id and moves into the duplicate's root. */
  targetBookId: number;
  duplicateBookId: number;
  /** The kept book's files and the paths they are about to take, some of them the duplicate's. */
  incomingFiles: Array<{ fileId: number; absolutePath: string }>;
  mergedByUserId: number | null;
}

export interface ConsolidateResult {
  snapshot: BookMergeSnapshot;
  /** Users whose reading history, status or progress changed on the kept book. */
  affectedUserIds: number[];
  ratingChangedUserIds: number[];
  koboEntitlementMovedUserIds: number[];
  sourceHadKoboEntitlements: boolean;
}

export interface RetireFileInput {
  bookId: number;
  loserFileId: number;
  survivorFileId: number;
}

/**
 * Moves everything a merged-away book owns onto the kept one, inside the caller's transaction:
 * 02-merge-rules.md in the order of its section 8. Book merges, rename-into-folder merges and the
 * scanner's duplicate repair all go through here, so no path can drop a reader's data.
 */
@Injectable()
export class BookConsolidationService {
  constructor(private readonly repository: BookConsolidationRepository) {}

  async consolidate(tx: ConsolidationTx, input: ConsolidateInput): Promise<ConsolidateResult> {
    const { targetBookId: k, sourceBookId: s } = input;
    if (k === s) throw new ConflictException('A book cannot be merged into itself.');

    const locked = await this.repository.lockBooks(tx, [k, s]);
    const target = locked.find((row) => row.id === k);
    const source = locked.find((row) => row.id === s);
    if (!target || !source) throw new NotFoundException('Book not found');
    if (target.libraryId !== source.libraryId && input.destination?.libraryId === undefined) {
      throw new ConflictException('Books in different libraries cannot be merged.');
    }

    const [targetFacts, sourceFacts] = await Promise.all([this.repository.loadFacts(tx, k), this.repository.loadFacts(tx, s)]);
    const snapshot = await this.repository.readSnapshot(tx, source, sourceFacts);

    // Files. The composite key forces this order: the kept book's root first, then file rows. The
    // dropped sidecar rows go before any path update: the kept book's own metadata file takes the
    // path of the source's hidden one (B28), and the path index is global.
    const destination = input.destination ?? { libraryFolderId: target.libraryFolderId, folderPath: target.folderPath };
    const libraryId = destination.libraryId ?? target.libraryId;
    if (libraryId !== target.libraryId) {
      await this.repository.moveBookToLibrary(tx, k, libraryId, destination.libraryFolderId);
    } else if (destination.libraryFolderId !== target.libraryFolderId) {
      await this.repository.moveBookToRoot(tx, k, destination.libraryFolderId);
    }
    await this.repository.deleteSidecarRows(tx, input.droppedSidecarFileIds ?? []);
    await this.repository.updateFileRows(tx, k, destination.libraryFolderId, input.targetFileUpdates ?? []);
    await this.repository.updateFileRows(tx, k, destination.libraryFolderId, input.sourceFileUpdates ?? []);
    await this.repository.reparentRemainingFiles(tx, s, k, destination.libraryFolderId);

    // Book-level data.
    const fieldSources = input.fieldSources ?? resolveFieldSources([targetFacts, sourceFacts]);
    const audioOwner = audioOwnerOf([targetFacts, sourceFacts]);
    const sourceOwnsAudio = audioOwner === s;
    await this.applyMetadata(tx, targetFacts, sourceFacts, fieldSources, sourceOwnsAudio);
    if (fieldSources.get('authors') === s) await this.repository.replaceAuthors(tx, k, s);
    if (fieldSources.get('narrators') === s) await this.repository.replaceNarrators(tx, k, s);
    if (fieldSources.get('series') === s) await this.repository.replaceSeries(tx, k, s);
    if (!targetFacts.lockedFields.has('genres')) await this.repository.uniteGenres(tx, k, s, input.excludeGenreIds ?? []);
    if (!targetFacts.lockedFields.has('tags')) await this.repository.uniteTags(tx, k, s, input.excludeTagIds ?? []);
    await this.repository.fillBookLevelRows(tx, k, s, { communityRatingLocked: targetFacts.lockedFields.has('communityRating') });
    if (sourceOwnsAudio) await this.repository.adoptAudioHistory(tx, k, s);

    // Per-user data. Remote read ids of a different remote book are released while the attempts
    // still sit on the source, so the history merge never copies one onto the kept book.
    await this.repository.releaseConflictingRemoteReadIds(tx, k, s);
    const affectedUserIds = await this.mergeReadingHistory(tx, k, s);
    await this.repository.moveReaderRows(tx, k, s);
    await this.repository.mergeNotes(tx, k, s, NOTE_MAX_LENGTH);
    const ratingChangedUserIds = await this.repository.reconcileRatings(tx, k, s);
    await this.repository.reconcileAudiobookProgress(tx, k, s, sourceOwnsAudio);

    // Devices and services.
    const sourceHadKoboEntitlements = await this.repository.hasKoboEntitlements(tx, s);
    const koboEntitlementMovedUserIds = await this.repository.moveKoboEntitlements(tx, k, s);
    await this.repository.reconcileReadingServices(tx, k, s);

    // System rows, links, unkeyed references, alias.
    await this.repository.moveSystemRows(tx, k, s, input.hiddenRequestIds ?? []);
    await this.repository.reconcileLinks(tx, k, s);
    await this.repository.rewriteUnkeyedReferences(tx, k, s);
    if (input.recordAlias !== false) {
      await this.repository.recordAlias(tx, {
        sourceBookId: s,
        targetBookId: k,
        // Where the merged-away book lived: what a split needs to put it back.
        libraryId: source.libraryId,
        mergedByUserId: input.mergedByUserId,
        jobId: input.jobId ?? null,
        snapshot,
      });
    }

    await this.repository.deleteBook(tx, s);
    if (source.libraryId !== libraryId || target.libraryId !== libraryId) {
      await this.repository.bumpKoreaderRevisions(tx, [source.libraryId, target.libraryId, libraryId]);
    }

    const addedAt = source.addedAt && (!target.addedAt || source.addedAt.getTime() < target.addedAt.getTime()) ? source.addedAt : null;
    await this.repository.finishTarget(tx, {
      targetBookId: k,
      folderPath: destination.folderPath !== target.folderPath ? destination.folderPath : null,
      addedAt,
      libraryId,
    });

    return { snapshot, affectedUserIds, ratingChangedUserIds, koboEntitlementMovedUserIds, sourceHadKoboEntitlements };
  }

  /**
   * For the paths that replace a duplicate with a book taking its place (a book move's "merge"
   * policy, the scanner's repair of a book moved outside BookOrbit). Returns false, changing
   * nothing, when no reader has data on the duplicate: the caller then deletes it as before. Else
   * the duplicate is consolidated into the kept book, the duplicate's rows at the incoming paths
   * are retired onto the incoming files (freeing those paths), and true is returned; the caller
   * still writes its own file paths.
   */
  async absorbDuplicate(tx: ConsolidationTx, input: AbsorbDuplicateInput): Promise<boolean> {
    const { targetBookId: k, duplicateBookId: d } = input;
    if (k === d) return false;
    const locked = await this.repository.lockBooks(tx, [k, d]);
    const target = locked.find((row) => row.id === k);
    const duplicate = locked.find((row) => row.id === d);
    if (!target || !duplicate) return false;
    if (!(await this.repository.carriesUserData(tx, d))) return false;

    if (target.libraryId !== duplicate.libraryId || target.libraryFolderId !== duplicate.libraryFolderId) {
      await this.repository.moveBookToLibrary(tx, k, duplicate.libraryId, duplicate.libraryFolderId);
    }
    await this.consolidate(tx, {
      targetBookId: k,
      sourceBookId: d,
      destination: { libraryFolderId: duplicate.libraryFolderId, folderPath: duplicate.folderPath },
      mergedByUserId: input.mergedByUserId,
    });

    const incomingByPath = new Map(input.incomingFiles.map((file) => [file.absolutePath, file.fileId]));
    const taken = await this.repository.findFilesAtPaths(tx, k, [...incomingByPath.keys()]);
    for (const row of taken) {
      const survivorFileId = incomingByPath.get(row.absolutePath);
      if (survivorFileId === undefined || survivorFileId === row.id) continue;
      await this.retireFile(tx, { bookId: k, loserFileId: row.id, survivorFileId });
    }
    return true;
  }

  loadFacts(tx: ConsolidationTx, bookId: number): Promise<BookFacts> {
    return this.repository.loadFacts(tx, bookId);
  }

  /** Retires an identical copy: every row keyed by it moves to the copy that stays, then its row goes. */
  async retireFile(tx: ConsolidationTx, input: RetireFileInput): Promise<void> {
    if (input.loserFileId === input.survivorFileId) throw new ConflictException('A file cannot replace itself.');
    const rows = await this.repository.lockFiles(tx, [input.loserFileId, input.survivorFileId]);
    const loser = rows.find((row) => row.id === input.loserFileId);
    const survivor = rows.find((row) => row.id === input.survivorFileId);
    if (!loser || !survivor || loser.bookId !== input.bookId || survivor.bookId !== input.bookId) {
      throw new NotFoundException('File not found');
    }
    await this.repository.retireFileRow(tx, input.loserFileId, input.survivorFileId);
  }

  private async applyMetadata(
    tx: ConsolidationTx,
    target: BookFacts,
    source: BookFacts,
    fieldSources: ReadonlyMap<BookMergeField, number>,
    sourceOwnsAudio: boolean,
  ): Promise<void> {
    const values: Record<string, unknown> = {};
    const locks = new Set(target.lockedFields);
    const from = source.metadata ?? {};

    for (const field of BOOK_MERGE_FIELDS) {
      if (fieldSources.get(field) !== source.bookId) continue;
      const spec = BOOK_MERGE_FIELD_SPECS[field];
      for (const column of spec.columns) values[column] = from[column] ?? null;
      for (const lock of spec.locks) if (source.lockedFields.has(lock)) locks.add(lock);
    }
    if (sourceOwnsAudio) {
      for (const column of AUDIO_EDITION_COLUMNS) {
        const lock = AUDIO_COLUMN_LOCKS[column];
        if (lock && target.lockedFields.has(lock)) continue;
        if (from[column] === null || from[column] === undefined) continue;
        values[column] = from[column];
        if (lock && source.lockedFields.has(lock)) locks.add(lock);
      }
    }
    for (const column of FILL_ONLY_COLUMNS) {
      if (target.lockedFields.has(column)) continue;
      if (isBlankColumn(column, target.metadata?.[column]) && !isBlankColumn(column, from[column])) values[column] = from[column];
    }

    const locksChanged = locks.size !== target.lockedFields.size;
    await this.repository.writeMetadata(tx, target.bookId, values, locksChanged || !target.metadata ? [...locks] : null);
  }

  private async mergeReadingHistory(tx: ConsolidationTx, k: number, s: number): Promise<number[]> {
    const affected: number[] = [];
    let after = 0;
    for (;;) {
      const userIds = await this.repository.sourceReaderPage(tx, s, after, READER_BATCH_SIZE);
      if (userIds.length === 0) break;
      after = userIds[userIds.length - 1];
      affected.push(...userIds);

      const [attempts, statuses] = await Promise.all([
        this.repository.loadAttempts(tx, userIds, [k, s]),
        this.repository.loadStatuses(tx, userIds, [k, s]),
      ]);
      for (const userId of userIds) {
        const mine = attempts.filter((row) => row.userId === userId);
        const plan = planReadingHistoryMerge({
          target: mine.filter((row) => row.side === 'target'),
          source: mine.filter((row) => row.side === 'source'),
          targetStatus: statuses.find((row) => row.userId === userId && row.bookId === k) ?? null,
          sourceStatus: statuses.find((row) => row.userId === userId && row.bookId === s) ?? null,
        });
        await this.repository.clearAttemptExternalIds(tx, plan.clearExternalIds);
        for (const update of plan.updates) await this.repository.updateAttempt(tx, update);
        await this.repository.softDeleteAttempts(tx, plan.softDelete);
        for (const move of plan.sessionMoves) await this.repository.moveSessionsBetweenAttempts(tx, move.from, move.to);
        if (plan.status) {
          const { status, source, startedAt, finishedAt } = plan.status;
          await this.repository.writeStatus(tx, userId, k, { status, source, startedAt, finishedAt });
        }
      }
    }
    await this.repository.moveAttempts(tx, s, k);
    return affected;
  }
}
