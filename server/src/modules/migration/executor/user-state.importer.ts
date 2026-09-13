import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { isAudioFormat, isComicFormat, type ReadStatus, type ReadStatusSource } from '@bookorbit/types';

import type {
  SourceBook,
  SourceBookFile,
  SourceBookmark,
  SourceReadingSession,
  SourceUserBookStatus,
  SourceUserFileProgress,
} from '../adapters/source-adapter.types';
import { MigrationRepository } from '../migration.repository';
import { MigrationImportRepository } from './migration-import.repository';
import type { PlannerResult } from '../planner/planner.types';
import {
  type RunStateCheck,
  buildSourceFileTargetMap,
  clampNonNegative,
  clampPercent,
  emptyCounters,
  normalizeReadStatus,
  progressMediaKind,
  sourceFileFormat,
  type ProgressMediaKind,
  type TargetBookFile,
  toDate,
  truncateNullableText,
  truncateText,
  uniqueNumbers,
} from './executor-utils';

function isDomainAvailable(planned: PlannerResult, domain: keyof NonNullable<PlannerResult['execution']['sourceData']['availableDomains']>): boolean {
  return planned.execution.sourceData.availableDomains?.[domain] ?? true;
}

function hasMeaningfulProgressSignal(row: SourceUserFileProgress, percentage: number, positionSeconds: number | null): boolean {
  const hasLocator = (row.cfi?.trim().length ?? 0) > 0 || (row.href?.trim().length ?? 0) > 0;
  const hasPageNumber = typeof row.pageNumber === 'number' && Number.isFinite(row.pageNumber) && row.pageNumber > 0;
  const hasPosition = positionSeconds != null && positionSeconds > 0;
  return percentage > 0 || hasLocator || hasPageNumber || hasPosition;
}

function hasRatingColumn(row: SourceUserBookStatus): boolean {
  return row.rating !== undefined;
}

function normalizeSourceRating(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const rating = Math.round(value);
  if (rating < 1) return null;
  if (rating <= 5) return rating;
  if (rating <= 10) return Math.ceil(rating / 2);
  return null;
}

type UserBookStatusMerge = {
  userId: number;
  bookId: number;
  status: ReadStatus;
  source: ReadStatusSource;
  startedAt: Date | null;
  finishedAt: Date | null;
  sourceUpdatedAt: Date | null;
};

type UserBookRatingUpsert = {
  userId: number;
  bookId: number;
  rating: number;
  updatedAt: Date;
};

type ReadingProgressUpsert = {
  bookFileId: number;
  userId: number;
  percentage: number;
  cfi: string | null;
  pageNumber: number | null;
  positionSeconds: number | null;
  updatedAt: Date;
  lastReadAt: Date;
};

type AudiobookProgressUpsert = {
  userId: number;
  bookId: number;
  percentage: number;
  currentFileId: number;
  positionSeconds: number;
  updatedAt: Date;
};

type ReadingSessionUpsert = {
  userId: number;
  bookId: number;
  bookFileId: number | null;
  sessionId: string;
  source: 'web';
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
  progressDelta: number | null;
  endProgress: number | null;
};

type ProgressFileContext = {
  primaryFilesByBookId: Map<number, number>;
  sourceFilesById: Map<string, SourceBookFile>;
  sourceFilesByBookId: Map<string, SourceBookFile[]>;
  sourceFileToTargetFile: Map<string, number>;
  targetFilesByBookId: Map<number, TargetBookFile[]>;
  targetFilesById: Map<number, TargetBookFile>;
};

type ResolvedProgressFile = {
  kind: ProgressMediaKind;
  targetFile: TargetBookFile;
};

@Injectable()
export class UserStateImporter {
  constructor(
    private readonly repo: MigrationRepository,
    private readonly importRepo: MigrationImportRepository,
  ) {}

  async import(runId: number, planned: PlannerResult, ensureRunning: RunStateCheck): Promise<void> {
    const sourceToTargetUser = new Map(
      planned.plan.userMappings
        .filter((mapping) => mapping.targetUserId !== null)
        .map((mapping) => [mapping.sourceUserId, mapping.targetUserId as number]),
    );
    const sourceToTargetBook = new Map(planned.execution.matchedBooks.map((m) => [m.sourceBookId, m.targetBookId]));
    const targetBookIds = uniqueNumbers([...sourceToTargetBook.values()]);

    const { primaryFilesByBookId } = await this.importRepo.fetchTargetBookPrimaryFiles(targetBookIds);
    const targetFilesByBookId = await this.importRepo.fetchTargetBookFiles(targetBookIds);
    const sourceFileToTargetFile = buildSourceFileTargetMap(planned, targetFilesByBookId);
    const sourceFilesByBookId = new Map(planned.execution.sourceData.books.map((book) => [book.sourceBookId, book.files ?? []] as const));
    const sourceFilesById = new Map([...sourceFilesByBookId.values()].flatMap((files) => files.map((file) => [file.sourceFileId, file] as const)));
    const targetFilesById = new Map([...targetFilesByBookId.values()].flatMap((files) => files.map((file) => [file.id, file] as const)));
    const progressFiles: ProgressFileContext = {
      primaryFilesByBookId,
      sourceFilesById,
      sourceFilesByBookId,
      sourceFileToTargetFile,
      targetFilesByBookId,
      targetFilesById,
    };

    await this.importUserBookStatuses(runId, planned, sourceToTargetUser, sourceToTargetBook, ensureRunning);
    await this.importUserBookRatings(runId, planned, sourceToTargetUser, sourceToTargetBook, ensureRunning);
    await this.importReadingProgress(runId, planned, sourceToTargetUser, sourceToTargetBook, progressFiles, ensureRunning);
    await this.importAudiobookProgress(runId, planned, sourceToTargetUser, sourceToTargetBook, progressFiles, ensureRunning);
    await this.importReadingSessions(
      runId,
      planned,
      sourceToTargetUser,
      sourceToTargetBook,
      primaryFilesByBookId,
      targetFilesByBookId,
      ensureRunning,
    );
    await this.importBookmarks(runId, planned, sourceToTargetUser, sourceToTargetBook, ensureRunning);
    await this.importAnnotations(runId, planned, sourceToTargetUser, sourceToTargetBook, ensureRunning);
    await this.importCollections(runId, planned, sourceToTargetUser, sourceToTargetBook, ensureRunning);
  }

  private async importUserBookStatuses(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    if (!isDomainAvailable(planned, 'userBookStatuses')) {
      await this.repo.setRunMetric(runId, 'user_state', 'user_book_status', counters);
      return;
    }

    const batch: UserBookStatusMerge[] = [];

    for (const row of planned.execution.sourceData.userBookStatuses) {
      await ensureRunning();
      counters.processed += 1;
      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      batch.push({
        userId: targetUserId,
        bookId: targetBookId,
        status: normalizeReadStatus(row.status, row.percentage),
        source: 'manual',
        startedAt: toDate(row.startedAt),
        finishedAt: toDate(row.finishedAt),
        sourceUpdatedAt: toDate(row.updatedAt),
      });
      counters.imported += 1;
    }
    const dedupedBatch = dedupeByKey(batch, (item) => `${item.userId}:${item.bookId}`, preferUserBookStatusEvidence);

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.batchMergeUserBookStatuses(dedupedBatch);
    });
    await this.repo.setRunMetric(runId, 'user_state', 'user_book_status', counters);
  }

  private async importUserBookRatings(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    if (!isDomainAvailable(planned, 'userBookStatuses')) {
      await this.repo.setRunMetric(runId, 'user_state', 'user_book_rating', counters);
      return;
    }

    const rows = planned.execution.sourceData.userBookStatuses.filter(hasRatingColumn);
    if (rows.length === 0) {
      await this.repo.setRunMetric(runId, 'user_state', 'user_book_rating', counters);
      return;
    }

    const batch: UserBookRatingUpsert[] = [];

    for (const row of rows) {
      await ensureRunning();
      counters.processed += 1;
      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      const rating = normalizeSourceRating(row.rating);
      if (rating == null) {
        counters.skipped += 1;
        continue;
      }

      batch.push({
        userId: targetUserId,
        bookId: targetBookId,
        rating,
        updatedAt: toDate(row.updatedAt) ?? new Date(),
      });
      counters.imported += 1;
    }

    const dedupedBatch = dedupeByKey(batch, (item) => `${item.userId}:${item.bookId}`, preferLatestByUpdatedAt);

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.clearUserBookRatings([...userMap.values()], [...bookMap.values()]);
      await importRepo.batchUpsertUserBookRatings(dedupedBatch);
    });
    await this.repo.setRunMetric(runId, 'user_state', 'user_book_rating', counters);
  }

  private async importReadingProgress(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    progressFiles: ProgressFileContext,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    if (!isDomainAvailable(planned, 'readingProgress')) {
      await this.repo.setRunMetric(runId, 'user_state', 'reading_progress', counters);
      return;
    }

    const batch: ReadingProgressUpsert[] = [];

    for (const row of planned.execution.sourceData.userFileProgress) {
      if (classifyProgressRow(row, bookMap, progressFiles) === 'audio') continue;
      await ensureRunning();
      counters.processed += 1;

      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      const resolvedFile = resolveProgressFile(row, targetBookId, progressFiles);
      if (!resolvedFile || resolvedFile.kind === 'audio') {
        counters.unresolved += 1;
        continue;
      }

      const percentage = clampPercent(row.percentage);
      const positionSeconds = row.positionSeconds == null ? null : clampNonNegative(row.positionSeconds);
      if (!hasMeaningfulProgressSignal(row, percentage, positionSeconds)) {
        counters.skipped += 1;
        continue;
      }

      const pageNumber =
        typeof row.pageNumber === 'number' && Number.isFinite(row.pageNumber) && row.pageNumber >= 0 ? Math.trunc(row.pageNumber) : null;
      const cfi = row.cfi?.trim() ? row.cfi : null;

      const sourceUpdatedAt = toDate(row.updatedAt) ?? new Date();
      batch.push({
        bookFileId: resolvedFile.targetFile.id,
        userId: targetUserId,
        percentage,
        cfi,
        pageNumber,
        positionSeconds,
        updatedAt: sourceUpdatedAt,
        lastReadAt: sourceUpdatedAt,
      });
      counters.imported += 1;
    }
    const dedupedBatch = dedupeByKey(batch, (item) => `${item.bookFileId}:${item.userId}`, preferReadingProgressRow);
    const progressScope = buildProgressScope(planned, bookMap, progressFiles);
    const fileIdsToClear = [...progressScope.entries()].flatMap(([bookId, kinds]) =>
      (progressFiles.targetFilesByBookId.get(bookId) ?? [])
        .filter((file) => {
          const kind = progressMediaKind(file.format);
          return kind != null && kinds.has(kind);
        })
        .map((file) => file.id),
    );

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.clearReadingProgress([...userMap.values()], fileIdsToClear);
      await importRepo.batchUpsertReadingProgress(dedupedBatch);
    });
    await this.repo.setRunMetric(runId, 'user_state', 'reading_progress', counters);
  }

  private async importAudiobookProgress(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    progressFiles: ProgressFileContext,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    if (!isDomainAvailable(planned, 'readingProgress')) {
      await this.repo.setRunMetric(runId, 'user_state', 'audiobook_progress', counters);
      return;
    }

    const sourceAudioRows = planned.execution.sourceData.userFileProgress.filter(
      (row) => classifyProgressRow(row, bookMap, progressFiles) === 'audio',
    );

    const batch: AudiobookProgressUpsert[] = [];

    for (const row of sourceAudioRows) {
      await ensureRunning();
      counters.processed += 1;

      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      const resolvedFile = resolveProgressFile(row, targetBookId, progressFiles);
      if (!resolvedFile || resolvedFile.kind !== 'audio') {
        counters.unresolved += 1;
        continue;
      }

      const percentage = clampPercent(row.percentage);
      const positionSeconds = clampNonNegative(row.positionSeconds) ?? 0;
      if (!hasMeaningfulProgressSignal(row, percentage, positionSeconds)) {
        counters.skipped += 1;
        continue;
      }

      batch.push({
        userId: targetUserId,
        bookId: targetBookId,
        percentage,
        currentFileId: resolvedFile.targetFile.id,
        positionSeconds,
        updatedAt: toDate(row.updatedAt) ?? new Date(),
      });
      counters.imported += 1;
    }

    const dedupedBatch = dedupeByKey(batch, (item) => `${item.userId}:${item.bookId}`, preferLatestByUpdatedAt);
    const progressScope = buildProgressScope(planned, bookMap, progressFiles);
    const audioBookIds = [...progressScope.entries()].filter(([, kinds]) => kinds.has('audio')).map(([bookId]) => bookId);

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.clearAudiobookProgress([...userMap.values()], audioBookIds);
      await importRepo.batchUpsertAudiobookProgress(dedupedBatch);
    });
    await this.repo.setRunMetric(runId, 'user_state', 'audiobook_progress', counters);
  }

  private async importReadingSessions(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    primaryFilesByBookId: Map<number, number>,
    targetFilesByBookId: Map<number, Array<{ id: number; hash: string | null; absolutePath: string; format: string | null }>>,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    const rows = planned.execution.sourceData.readingSessions;
    if (!isDomainAvailable(planned, 'readingSessions') || !Array.isArray(rows)) {
      await this.repo.setRunMetric(runId, 'user_state', 'reading_sessions', counters);
      return;
    }

    const sourceType = planned.plan.snapshot?.sourceType ?? 'booklore';
    const sessionIdPrefix = `${sourceType}:rs:`;
    const batch: ReadingSessionUpsert[] = [];

    for (const row of rows) {
      await ensureRunning();
      counters.processed += 1;

      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      const prepared = prepareReadingSessionRow(row, sourceType, targetUserId, targetBookId);
      if (!prepared) {
        counters.skipped += 1;
        continue;
      }

      batch.push({
        ...prepared,
        bookFileId: resolveReadingSessionBookFileId(row.bookType, targetBookId, targetFilesByBookId, primaryFilesByBookId),
      });
      counters.imported += 1;
    }

    const dedupedBatch = dedupeByKey(batch, (item) => `${item.userId}:${item.sessionId}`, preferReadingSessionRow);

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.syncImportedReadingSessions({
        items: dedupedBatch,
        userIds: [...userMap.values()],
        bookIds: [...bookMap.values()],
        sessionIdPrefix,
      });
    });
    await this.repo.setRunMetric(runId, 'user_state', 'reading_sessions', counters);
  }

  private async importBookmarks(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    if (!isDomainAvailable(planned, 'bookmarks')) {
      await this.repo.setRunMetric(runId, 'user_state', 'bookmarks', counters);
      return;
    }

    const sourceBooksById = new Map(planned.execution.sourceData.books.map((book) => [book.sourceBookId, book]));

    const batch: Array<{
      userId: number;
      bookId: number;
      title: string;
      cfi: string | null;
      positionSeconds: number | null;
      createdAt: Date;
    }> = [];

    for (const row of planned.execution.sourceData.bookmarks) {
      await ensureRunning();
      counters.processed += 1;

      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      batch.push({
        userId: targetUserId,
        bookId: targetBookId,
        title: truncateText(row.title ?? 'Imported bookmark', 500),
        cfi: truncateNullableText(row.cfi, 2000) ?? null,
        positionSeconds: resolveBookmarkPositionSeconds(row, sourceBooksById.get(row.sourceBookId)),
        createdAt: toDate(row.createdAt) ?? new Date(),
      });
      counters.imported += 1;
    }

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.clearBookmarks([...userMap.values()], [...bookMap.values()]);
      await importRepo.batchInsertBookmarks(batch);
    });
    await this.repo.setRunMetric(runId, 'user_state', 'bookmarks', counters);
  }

  private async importAnnotations(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    if (!isDomainAvailable(planned, 'annotations')) {
      await this.repo.setRunMetric(runId, 'user_state', 'annotations', counters);
      return;
    }

    const batch: Array<{
      userId: number;
      bookId: number;
      cfi: string;
      text: string;
      color: string;
      style: string;
      note: string | null;
      chapterTitle: string | null;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    for (const row of planned.execution.sourceData.annotations) {
      await ensureRunning();
      counters.processed += 1;

      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      batch.push({
        userId: targetUserId,
        bookId: targetBookId,
        cfi: truncateText(row.cfi ?? '', 2000),
        text: row.text ?? '',
        color: truncateText(row.color ?? 'yellow', 20),
        style: truncateText(row.style ?? 'highlight', 20),
        note: row.note,
        chapterTitle: truncateNullableText(row.chapterTitle, 500) ?? null,
        createdAt: toDate(row.createdAt) ?? new Date(),
        updatedAt: toDate(row.updatedAt) ?? new Date(),
      });
      counters.imported += 1;
    }

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.clearAnnotations([...userMap.values()], [...bookMap.values()]);
      await importRepo.batchInsertAnnotations(batch);
    });
    await this.repo.setRunMetric(runId, 'user_state', 'annotations', counters);
  }

  private async importCollections(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    if (!isDomainAvailable(planned, 'shelves')) {
      await this.repo.setRunMetric(runId, 'user_state', 'collections', counters);
      return;
    }

    const shelvesById = new Map(planned.execution.sourceData.shelves.map((row) => [row.sourceShelfId, row]));

    await this.importRepo.withTransaction(async (importRepo) => {
      const targetUserIds = uniqueNumbers([...userMap.values()]);
      const existingCollections = await importRepo.fetchExistingCollections(targetUserIds);
      const importedCollectionKeyToId = new Map<string, number>(
        existingCollections
          .map((row) => {
            const sourceShelfId = parseImportedCollectionSourceShelfId(row.description);
            return sourceShelfId ? ([`${row.userId}:${sourceShelfId}`, row.id] as readonly [string, number]) : null;
          })
          .filter((row): row is readonly [string, number] => row !== null),
      );
      const usedCollectionNamesByUser = new Map<number, Set<string>>();
      for (const row of existingCollections) {
        const names = usedCollectionNamesByUser.get(row.userId) ?? new Set<string>();
        names.add(row.name.toLowerCase());
        usedCollectionNamesByUser.set(row.userId, names);
      }
      const preparedCollectionIds = new Set<number>();

      const ensureCollection = async (shelf: { sourceShelfId: string; sourceUserId: string; name: string }): Promise<number | null> => {
        const targetUserId = userMap.get(shelf.sourceUserId);
        if (!targetUserId) return null;

        const key = `${targetUserId}:${shelf.sourceShelfId}`;
        let collectionId = importedCollectionKeyToId.get(key);
        if (!collectionId) {
          const usedNames = usedCollectionNamesByUser.get(targetUserId) ?? new Set<string>();
          const name = nextImportedCollectionName(shelf.name, usedNames);
          usedCollectionNamesByUser.set(targetUserId, usedNames);
          const inserted = await importRepo.insertCollection({
            userId: targetUserId,
            name,
            description: buildImportedCollectionDescription(shelf.sourceShelfId),
            syncToKobo: false,
            displayOrder: 0,
          });
          collectionId = inserted.id;
          importedCollectionKeyToId.set(key, collectionId);
        }

        if (!preparedCollectionIds.has(collectionId)) {
          await importRepo.clearCollectionBooks(collectionId);
          preparedCollectionIds.add(collectionId);
        }

        return collectionId;
      };

      for (const shelf of planned.execution.sourceData.shelves) {
        await ensureRunning();
        await ensureCollection(shelf);
      }

      const collectionBookBatch: Array<{
        collectionId: number;
        bookId: number;
        sourcePosition: number | null;
        sourceOrder: number;
      }> = [];

      for (const [sourceOrder, row] of planned.execution.sourceData.shelfBooks.entries()) {
        await ensureRunning();
        counters.processed += 1;
        const shelf = shelvesById.get(row.sourceShelfId);
        if (!shelf) {
          counters.unresolved += 1;
          continue;
        }
        if (row.sourceUserId !== shelf.sourceUserId) {
          counters.unresolved += 1;
          continue;
        }

        const targetBookId = bookMap.get(row.sourceBookId);
        if (!targetBookId) {
          counters.unresolved += 1;
          continue;
        }

        const collectionId = await ensureCollection(shelf);
        if (!collectionId) {
          counters.unresolved += 1;
          continue;
        }

        collectionBookBatch.push({
          collectionId,
          bookId: targetBookId,
          sourcePosition: normalizeShelfPosition(row.position),
          sourceOrder,
        });
        counters.imported += 1;
      }

      collectionBookBatch.sort(compareCollectionBookOrder);
      await importRepo.batchInsertCollectionBooks(collectionBookBatch.map(({ collectionId, bookId }) => ({ collectionId, bookId })));
    });
    await this.repo.setRunMetric(runId, 'user_state', 'collections', counters);
  }
}

function normalizeShelfPosition(value: number | null | undefined): number | null {
  if (value == null || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function compareCollectionBookOrder(
  left: { collectionId: number; sourcePosition: number | null; sourceOrder: number },
  right: { collectionId: number; sourcePosition: number | null; sourceOrder: number },
): number {
  if (left.collectionId !== right.collectionId) return left.collectionId - right.collectionId;
  if (left.sourcePosition == null && right.sourcePosition != null) return 1;
  if (left.sourcePosition != null && right.sourcePosition == null) return -1;
  if (left.sourcePosition != null && right.sourcePosition != null && left.sourcePosition !== right.sourcePosition) {
    return left.sourcePosition - right.sourcePosition;
  }
  return left.sourceOrder - right.sourceOrder;
}

function classifyProgressRow(row: SourceUserFileProgress, bookMap: Map<string, number>, progressFiles: ProgressFileContext): 'audio' | 'reading' {
  return inferProgressKind(row, bookMap.get(row.sourceBookId), progressFiles) === 'audio' ? 'audio' : 'reading';
}

function inferProgressKind(
  row: SourceUserFileProgress,
  targetBookId: number | undefined,
  progressFiles: ProgressFileContext,
): ProgressMediaKind | null {
  if (row.sourceFileId) {
    const sourceFile = progressFiles.sourceFilesById.get(row.sourceFileId);
    const sourceKind = sourceFile ? progressMediaKind(sourceFileFormat(sourceFile)) : null;
    if (sourceKind) return sourceKind;

    const mappedTargetFileId = progressFiles.sourceFileToTargetFile.get(row.sourceFileId);
    const mappedTargetKind = mappedTargetFileId ? progressMediaKind(progressFiles.targetFilesById.get(mappedTargetFileId)?.format) : null;
    if (mappedTargetKind) return mappedTargetKind;
  }

  const sourceKinds = new Set(
    (progressFiles.sourceFilesByBookId.get(row.sourceBookId) ?? [])
      .map((file) => progressMediaKind(sourceFileFormat(file)))
      .filter((kind): kind is ProgressMediaKind => kind != null),
  );
  if (sourceKinds.size === 1) return [...sourceKinds][0];

  const hasReadingLocator = Boolean(row.cfi?.trim() || row.href?.trim()) || (row.pageNumber != null && row.pageNumber > 0);
  if (!hasReadingLocator && row.positionSeconds != null && Number.isFinite(row.positionSeconds) && row.positionSeconds > 0) {
    return 'audio';
  }
  if (row.cfi?.trim() || row.href?.trim()) return 'epub';

  if (targetBookId) {
    const primaryFileId = progressFiles.primaryFilesByBookId.get(targetBookId);
    const primaryKind = primaryFileId ? progressMediaKind(progressFiles.targetFilesById.get(primaryFileId)?.format) : null;
    if (primaryKind) return primaryKind;
  }

  return null;
}

function resolveProgressFile(row: SourceUserFileProgress, targetBookId: number, progressFiles: ProgressFileContext): ResolvedProgressFile | null {
  const sourceFile = row.sourceFileId ? progressFiles.sourceFilesById.get(row.sourceFileId) : undefined;
  const sourceKind = sourceFile ? progressMediaKind(sourceFileFormat(sourceFile)) : null;

  if (row.sourceFileId) {
    // A row that names a specific source file must land on the file that file was mapped to.
    // Falling back to the book's primary file would move a later audio track's local offset
    // onto the wrong file.
    const targetFileId = progressFiles.sourceFileToTargetFile.get(row.sourceFileId);
    const targetFile = targetFileId ? progressFiles.targetFilesById.get(targetFileId) : undefined;
    if (!targetFile) return null;
    const targetKind = progressMediaKind(targetFile.format);
    if (targetKind && sourceKind && targetKind !== sourceKind) return null;
    // `book_files.format` is nullable, so trust the source kind rather than discarding a file
    // that was matched by hash or by absolute path.
    const kind = targetKind ?? sourceKind ?? inferProgressKind(row, targetBookId, progressFiles);
    return kind ? { kind, targetFile } : null;
  }

  const inferredKind = inferProgressKind(row, targetBookId, progressFiles);
  const targetFiles = progressFiles.targetFilesByBookId.get(targetBookId) ?? [];
  const compatibleFiles = inferredKind ? targetFiles.filter((file) => progressMediaKind(file.format) === inferredKind) : [];
  const primaryFileId = progressFiles.primaryFilesByBookId.get(targetBookId);
  const primaryFile = primaryFileId ? progressFiles.targetFilesById.get(primaryFileId) : undefined;

  let targetFile: TargetBookFile | undefined;
  if (inferredKind === 'audio') {
    targetFile = compatibleFiles[0];
  } else if (inferredKind) {
    targetFile =
      primaryFile && progressMediaKind(primaryFile.format) === inferredKind
        ? primaryFile
        : compatibleFiles.length === 1
          ? compatibleFiles[0]
          : undefined;
  } else {
    targetFile = primaryFile;
  }

  const targetKind = progressMediaKind(targetFile?.format);
  if (!targetFile || !targetKind || (inferredKind && inferredKind !== targetKind)) return null;
  return { kind: inferredKind ?? targetKind, targetFile };
}

function buildProgressScope(
  planned: PlannerResult,
  bookMap: Map<string, number>,
  progressFiles: ProgressFileContext,
): Map<number, Set<ProgressMediaKind>> {
  const result = new Map<number, Set<ProgressMediaKind>>();
  const add = (bookId: number, kind: ProgressMediaKind | null) => {
    if (!kind) return;
    const kinds = result.get(bookId) ?? new Set<ProgressMediaKind>();
    kinds.add(kind);
    result.set(bookId, kinds);
  };

  for (const [sourceBookId, targetBookId] of bookMap) {
    const sourceFiles = progressFiles.sourceFilesByBookId.get(sourceBookId) ?? [];
    for (const sourceFile of sourceFiles) {
      const sourceKind = progressMediaKind(sourceFileFormat(sourceFile));
      if (sourceKind) {
        add(targetBookId, sourceKind);
        continue;
      }
      const targetFileId = progressFiles.sourceFileToTargetFile.get(sourceFile.sourceFileId);
      add(targetBookId, targetFileId ? progressMediaKind(progressFiles.targetFilesById.get(targetFileId)?.format) : null);
    }

    if (!result.has(targetBookId)) {
      const primaryFileId = progressFiles.primaryFilesByBookId.get(targetBookId);
      add(targetBookId, primaryFileId ? progressMediaKind(progressFiles.targetFilesById.get(primaryFileId)?.format) : null);
    }
  }

  for (const row of planned.execution.sourceData.userFileProgress) {
    const targetBookId = bookMap.get(row.sourceBookId);
    if (targetBookId) add(targetBookId, inferProgressKind(row, targetBookId, progressFiles));
  }

  return result;
}

const IMPORTED_COLLECTION_DESCRIPTION_PREFIX = 'Imported from Booklore migration shelf: ';

function buildImportedCollectionDescription(sourceShelfId: string): string {
  return `${IMPORTED_COLLECTION_DESCRIPTION_PREFIX}${sourceShelfId}`;
}

function parseImportedCollectionSourceShelfId(description: string | null): string | null {
  if (!description?.startsWith(IMPORTED_COLLECTION_DESCRIPTION_PREFIX)) return null;
  const sourceShelfId = description.slice(IMPORTED_COLLECTION_DESCRIPTION_PREFIX.length).trim();
  return sourceShelfId.length > 0 ? sourceShelfId : null;
}

function nextImportedCollectionName(baseName: string, usedNames: Set<string>): string {
  const base = baseName.trim() || 'Imported Shelf';
  if (!usedNames.has(base.toLowerCase())) {
    usedNames.add(base.toLowerCase());
    return base;
  }

  const importedBase = `${base} (Booklore)`;
  if (!usedNames.has(importedBase.toLowerCase())) {
    usedNames.add(importedBase.toLowerCase());
    return importedBase;
  }

  for (let i = 2; i < 10_000; i += 1) {
    const candidate = `${base} (Booklore ${i})`;
    if (!usedNames.has(candidate.toLowerCase())) {
      usedNames.add(candidate.toLowerCase());
      return candidate;
    }
  }

  const fallback = `${base} (Booklore ${Date.now()})`;
  usedNames.add(fallback.toLowerCase());
  return fallback;
}

function dedupeByKey<T>(items: T[], toKey: (item: T) => string, pickPreferred: (current: T, candidate: T) => T): T[] {
  const byKey = new Map<string, T>();
  for (const item of items) {
    const key = toKey(item);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    byKey.set(key, pickPreferred(existing, item));
  }
  return [...byKey.values()];
}

function preferLatestByUpdatedAt<T extends { updatedAt: Date }>(current: T, candidate: T): T {
  const currentTs = current.updatedAt.getTime();
  const candidateTs = candidate.updatedAt.getTime();
  if (candidateTs > currentTs) return candidate;
  if (candidateTs < currentTs) return current;
  return candidate;
}

function preferUserBookStatusEvidence(current: UserBookStatusMerge, candidate: UserBookStatusMerge): UserBookStatusMerge {
  if (current.sourceUpdatedAt === null) return candidate;
  if (candidate.sourceUpdatedAt === null) return current;
  if (candidate.sourceUpdatedAt > current.sourceUpdatedAt) return candidate;
  if (candidate.sourceUpdatedAt < current.sourceUpdatedAt) return current;
  return candidate;
}

function preferReadingProgressRow(current: ReadingProgressUpsert, candidate: ReadingProgressUpsert): ReadingProgressUpsert {
  const currentTs = current.updatedAt.getTime();
  const candidateTs = candidate.updatedAt.getTime();
  if (candidateTs > currentTs) return candidate;
  if (candidateTs < currentTs) return current;

  const currentScore = readingProgressSignalScore(current);
  const candidateScore = readingProgressSignalScore(candidate);
  if (candidateScore > currentScore) return candidate;
  if (candidateScore < currentScore) return current;
  return candidate;
}

function readingProgressSignalScore(row: ReadingProgressUpsert): number {
  let score = 0;
  if ((row.cfi?.trim().length ?? 0) > 0) score += 8;
  if (typeof row.pageNumber === 'number' && Number.isFinite(row.pageNumber) && row.pageNumber > 0) score += 2;
  if (typeof row.positionSeconds === 'number' && Number.isFinite(row.positionSeconds) && row.positionSeconds > 0) score += 2;
  if (row.percentage > 0) score += 1;
  return score;
}

function prepareReadingSessionRow(
  row: SourceReadingSession,
  sourceType: string,
  userId: number,
  bookId: number,
): Omit<ReadingSessionUpsert, 'bookFileId'> | null {
  const startedAt = toDate(row.startedAt);
  const endedAt = toDate(row.endedAt);
  if (!startedAt || !endedAt) return null;
  if (endedAt.getTime() < startedAt.getTime()) return null;

  const wallClockSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
  if (wallClockSeconds <= 0) return null;

  const sourceDuration =
    typeof row.durationSeconds === 'number' && Number.isFinite(row.durationSeconds) ? Math.max(0, Math.trunc(row.durationSeconds)) : wallClockSeconds;
  const durationSeconds = Math.min(sourceDuration, wallClockSeconds);
  if (durationSeconds < 10) return null;

  return {
    userId,
    bookId,
    sessionId: buildImportedReadingSessionId(sourceType, row.sourceSessionId),
    source: 'web',
    startedAt,
    endedAt,
    durationSeconds,
    progressDelta: clampProgressDelta(row.progressDelta),
    endProgress: sanitizeNullablePercent(row.endProgress),
  };
}

function buildImportedReadingSessionId(sourceType: string, sourceSessionId: string): string {
  const prefix = `${sourceType}:rs:`;
  const raw = sourceSessionId.trim();
  const candidate = `${prefix}${raw}`;
  if (candidate.length <= 64) return candidate;
  const digest = createHash('sha256').update(sourceType).update('\0').update(raw).digest('base64url');
  return `${prefix}${digest.slice(0, 64 - prefix.length)}`;
}

function sanitizeNullablePercent(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(clampPercent(value) * 100) / 100;
}

function clampProgressDelta(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(Math.max(-100, Math.min(100, value)) * 100) / 100;
}

function preferReadingSessionRow(current: ReadingSessionUpsert, candidate: ReadingSessionUpsert): ReadingSessionUpsert {
  const currentTs = current.endedAt.getTime();
  const candidateTs = candidate.endedAt.getTime();
  if (candidateTs > currentTs) return candidate;
  if (candidateTs < currentTs) return current;
  return candidate;
}

function resolveReadingSessionBookFileId(
  bookType: string | null,
  bookId: number,
  targetFilesByBookId: Map<number, Array<{ id: number; format: string | null }>>,
  primaryFilesByBookId: Map<number, number>,
): number | null {
  const files = targetFilesByBookId.get(bookId) ?? [];
  if (files.length === 0) return null;

  const primaryFileId = primaryFilesByBookId.get(bookId) ?? null;
  if (!bookType?.trim()) {
    if (files.length === 1) return files[0].id;
    return primaryFileId;
  }

  const matches = files.filter((file) => isTargetFileForSourceBookType(file.format, bookType));
  if (matches.length === 1) return matches[0].id;
  if (primaryFileId && matches.some((file) => file.id === primaryFileId)) return primaryFileId;
  return null;
}

function isTargetFileForSourceBookType(format: string | null, bookType: string): boolean {
  if (!format) return false;
  const normalizedFormat = format.toLowerCase();
  const normalizedType = bookType.trim().toUpperCase();

  if (normalizedType === 'AUDIOBOOK') return isAudioFormat(normalizedFormat);
  if (normalizedType === 'CBX') return isComicFormat(normalizedFormat);

  return normalizedFormat === normalizedType.toLowerCase();
}

function resolveBookmarkPositionSeconds(row: SourceBookmark, sourceBook: SourceBook | undefined): number | null {
  if (row.positionSeconds == null || !Number.isFinite(row.positionSeconds)) return null;
  const positionSeconds = Math.max(0, row.positionSeconds);
  if (row.sourceFileId || row.trackIndex == null || !sourceBook?.files?.length) return positionSeconds;

  const trackIndex = resolveTrackIndex(row.trackIndex, sourceBook.files.length);
  if (trackIndex == null || trackIndex === 0) return positionSeconds;

  let offsetSeconds = 0;
  for (const file of sourceBook.files.slice(0, trackIndex)) {
    if (file.durationSeconds == null) return positionSeconds;
    offsetSeconds += file.durationSeconds;
  }

  return offsetSeconds + positionSeconds;
}

function resolveTrackIndex(trackIndex: number, fileCount: number): number | null {
  if (!Number.isFinite(trackIndex)) return null;
  const rounded = Math.trunc(trackIndex);
  if (rounded >= 0 && rounded < fileCount) return rounded;
  const oneBased = rounded - 1;
  if (oneBased >= 0 && oneBased < fileCount) return oneBased;
  return null;
}
