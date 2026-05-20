import { Injectable } from '@nestjs/common';
import type { ReadStatus, ReadStatusSource } from '@bookorbit/types';

import type { SourceBook, SourceBookmark, SourceUserFileProgress } from '../adapters/source-adapter.types';
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

@Injectable()
export class UserStateImporter {
  constructor(
    private readonly repo: MigrationRepository,
    private readonly importRepo: MigrationImportRepository,
  ) {}

  async import(runId: number, planned: PlannerResult, ensureRunning: RunStateCheck): Promise<void> {
    const sourceToTargetUser = new Map(planned.plan.userMappings.map((m) => [m.sourceUserId, m.targetUserId]));
    const sourceToTargetBook = new Map(planned.execution.matchedBooks.map((m) => [m.sourceBookId, m.targetBookId]));
    const targetBookIds = uniqueNumbers([...sourceToTargetBook.values()]);

    const { primaryFilesByBookId, audiobookPrimaryFilesByBookId } = await this.importRepo.fetchTargetBookPrimaryFiles(targetBookIds);
    const targetFilesByBookId = await this.importRepo.fetchTargetBookFiles(targetBookIds);
    const sourceFileToTargetFile = buildSourceFileTargetMap(planned, targetFilesByBookId);

    await this.importUserBookStatuses(runId, planned, sourceToTargetUser, sourceToTargetBook, ensureRunning);
    await this.importReadingProgress(
      runId,
      planned,
      sourceToTargetUser,
      sourceToTargetBook,
      primaryFilesByBookId,
      sourceFileToTargetFile,
      ensureRunning,
    );
    await this.importAudiobookProgress(
      runId,
      planned,
      sourceToTargetUser,
      sourceToTargetBook,
      audiobookPrimaryFilesByBookId,
      sourceFileToTargetFile,
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

    const batch: Array<{
      userId: number;
      bookId: number;
      status: ReadStatus;
      source: ReadStatusSource;
      startedAt: Date | null;
      finishedAt: Date | null;
      updatedAt: Date;
    }> = [];

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
        updatedAt: toDate(row.updatedAt) ?? new Date(),
      });
      counters.imported += 1;
    }

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.clearUserBookStatuses([...userMap.values()], [...bookMap.values()]);
      await importRepo.batchUpsertUserBookStatuses(batch);
    });
    await this.repo.setRunMetric(runId, 'user_state', 'user_book_status', counters);
  }

  private async importReadingProgress(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    primaryFilesByBookId: Map<number, number>,
    sourceFileToTargetFile: Map<string, number>,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    if (!isDomainAvailable(planned, 'readingProgress')) {
      await this.repo.setRunMetric(runId, 'user_state', 'reading_progress', counters);
      return;
    }

    const batch: Array<{
      bookFileId: number;
      userId: number;
      percentage: number;
      cfi: string | null;
      pageNumber: number | null;
      positionSeconds: number | null;
      updatedAt: Date;
    }> = [];

    for (const row of planned.execution.sourceData.userFileProgress) {
      await ensureRunning();
      counters.processed += 1;

      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      const targetFileId = (row.sourceFileId ? sourceFileToTargetFile.get(row.sourceFileId) : null) ?? primaryFilesByBookId.get(targetBookId);
      if (!targetFileId) {
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

      batch.push({
        bookFileId: targetFileId,
        userId: targetUserId,
        percentage,
        cfi,
        pageNumber,
        positionSeconds,
        updatedAt: toDate(row.updatedAt) ?? new Date(),
      });
      counters.imported += 1;
    }

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.clearReadingProgress([...userMap.values()], [...primaryFilesByBookId.values(), ...sourceFileToTargetFile.values()]);
      await importRepo.batchUpsertReadingProgress(batch);
    });
    await this.repo.setRunMetric(runId, 'user_state', 'reading_progress', counters);
  }

  private async importAudiobookProgress(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    audiobookPrimaryFilesByBookId: Map<number, number>,
    sourceFileToTargetFile: Map<string, number>,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    if (!isDomainAvailable(planned, 'readingProgress')) {
      await this.repo.setRunMetric(runId, 'user_state', 'audiobook_progress', counters);
      return;
    }

    const sourceAudioRows = planned.execution.sourceData.userFileProgress.filter((row) => {
      const targetBookId = bookMap.get(row.sourceBookId);
      return targetBookId ? audiobookPrimaryFilesByBookId.has(targetBookId) : false;
    });

    const batch: Array<{
      userId: number;
      bookId: number;
      percentage: number;
      currentFileId: number;
      positionSeconds: number;
      updatedAt: Date;
    }> = [];

    for (const row of sourceAudioRows) {
      await ensureRunning();
      counters.processed += 1;

      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      const targetFileId =
        (row.sourceFileId ? sourceFileToTargetFile.get(row.sourceFileId) : null) ?? audiobookPrimaryFilesByBookId.get(targetBookId);
      if (!targetFileId) {
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
        currentFileId: targetFileId,
        positionSeconds,
        updatedAt: toDate(row.updatedAt) ?? new Date(),
      });
      counters.imported += 1;
    }

    await this.importRepo.withTransaction(async (importRepo) => {
      await importRepo.clearAudiobookProgress([...userMap.values()], [...audiobookPrimaryFilesByBookId.keys()]);
      await importRepo.batchUpsertAudiobookProgress(batch);
    });
    await this.repo.setRunMetric(runId, 'user_state', 'audiobook_progress', counters);
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

      const collectionBookBatch: Array<{ collectionId: number; bookId: number }> = [];

      for (const row of planned.execution.sourceData.shelfBooks) {
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

        collectionBookBatch.push({ collectionId, bookId: targetBookId });
        counters.imported += 1;
      }

      await importRepo.batchInsertCollectionBooks(collectionBookBatch);
    });
    await this.repo.setRunMetric(runId, 'user_state', 'collections', counters);
  }
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
