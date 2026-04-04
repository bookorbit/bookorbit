import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { constants as fsConstants } from 'fs';
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { isAudioFormat } from '@projectx/types';

import { DB } from '../../../db';
import * as schema from '../../../db/schema';
import { coverDirPath, generateThumbnail, imageExt } from '../../metadata/lib/cover';
import { parseBookloreConnectionConfig } from '../adapters/booklore/booklore-connection-config';
import { buildProfileHash, buildSourceSnapshotHash } from '../core/plan-hash';
import { MigrationPlannerService } from '../planner/planner.service';
import { applyPathMappings } from '../planner/matching.service';
import type { PlannedMigration, PlannerResult } from '../planner/planner.types';
import { MigrationRepository } from '../migration.repository';

type Db = NodePgDatabase<typeof schema>;

interface StageCounters {
  processed: number;
  imported: number;
  skipped: number;
  unresolved: number;
  failed: number;
}

type RunStateCheck = (force?: boolean) => Promise<void>;

class RunInterruptedError extends Error {
  constructor(
    readonly runId: number,
    readonly state: string,
  ) {
    super(`Migration run ${runId} is no longer running (state=${state})`);
  }
}

@Injectable()
export class MigrationExecutorService {
  private readonly logger = new Logger(MigrationExecutorService.name);
  private readonly running = new Set<number>();
  private readonly booksPath: string;

  constructor(
    private readonly repo: MigrationRepository,
    private readonly planner: MigrationPlannerService,
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  start(runId: number): void {
    if (this.running.has(runId)) return;
    this.running.add(runId);

    void this.execute(runId).finally(() => {
      this.running.delete(runId);
    });
  }

  private async execute(runId: number): Promise<void> {
    const run = await this.repo.findRunById(runId);
    if (!run) return;
    if (run.state !== 'running') return;
    if (!run.planArtifactId) {
      await this.failRun(runId, 'Migration run is missing a dry-run plan artifact');
      return;
    }

    const artifact = await this.repo.findPlanArtifactById(run.planArtifactId);
    const profile = await this.repo.findProfileById(run.profileId);
    const source = await this.repo.findSourceById(run.sourceId);

    if (!artifact || !profile || !source) {
      await this.failRun(runId, 'Migration run references missing source/profile/plan artifact');
      return;
    }

    try {
      const artifactPlan = asRecord(artifact.plan);
      const planned = await this.planner.buildPlan({
        source,
        profile,
        scopeOverride: asRecord(artifactPlan.scope),
      });

      this.assertDeterministicPlan(artifact, profile, planned.plan);

      const sourceMediaRootPath = this.resolveSourceMediaRootPath(source.type, source.connectionConfig);

      await this.executeStage(runId, 'shared_overlays', async (ensureRunning) => this.importSharedOverlays(runId, planned, ensureRunning));
      await this.executeStage(runId, 'book_covers', async (ensureRunning) =>
        this.importBookCovers(runId, planned, sourceMediaRootPath, ensureRunning),
      );
      await this.executeStage(runId, 'user_state', async (ensureRunning) => this.importUserState(runId, planned, ensureRunning));
      await this.assertRunIsRunning(runId);

      await this.repo.updateRunState(runId, 'completed', {
        currentStage: 'completed',
        endedAt: new Date(),
        errorMessage: null,
      });
    } catch (error) {
      if (error instanceof RunInterruptedError) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[migration.execute] runId=${runId} error="${message}"`);
      await this.failRun(runId, message);
    }
  }

  private assertDeterministicPlan(
    artifact: typeof schema.migrationPlanArtifacts.$inferSelect,
    profile: typeof schema.migrationProfiles.$inferSelect,
    generatedPlan: PlannedMigration,
  ): void {
    const sourceSnapshotHash = buildSourceSnapshotHash(generatedPlan.snapshot);
    const profileHash = buildProfileHash(profile);

    if (artifact.sourceSnapshotHash !== sourceSnapshotHash || artifact.profileHash !== profileHash) {
      throw new Error('Source or profile changed since dry-run. Re-run dry-run before starting migration.');
    }
  }

  private async executeStage(runId: number, stage: string, handler: (ensureRunning: RunStateCheck) => Promise<void>): Promise<void> {
    await this.repo.updateRunState(runId, 'running', {
      currentStage: stage,
      errorMessage: null,
    });

    const ensureRunning = this.createRunStateChecker(runId);
    await ensureRunning(true);
    await handler(ensureRunning);
    await ensureRunning(true);
  }

  private createRunStateChecker(runId: number, checkEvery = 25): RunStateCheck {
    let sinceLastCheck = 0;
    return async (force = false) => {
      sinceLastCheck += 1;
      if (!force && sinceLastCheck % checkEvery !== 0) return;
      await this.assertRunIsRunning(runId);
    };
  }

  private async assertRunIsRunning(runId: number): Promise<void> {
    const run = await this.repo.findRunById(runId);
    const state = run?.state ?? 'missing';
    if (!run || state !== 'running') {
      throw new RunInterruptedError(runId, state);
    }
  }

  private async importSharedOverlays(runId: number, planned: PlannerResult, ensureRunning: RunStateCheck): Promise<void> {
    const sourceBooksById = new Map(planned.execution.sourceData.books.map((row) => [row.sourceBookId, row]));

    const counters: StageCounters = {
      processed: 0,
      imported: 0,
      skipped: 0,
      unresolved: 0,
      failed: 0,
    };

    for (const match of planned.execution.matchedBooks) {
      await ensureRunning();
      counters.processed += 1;

      const sourceBook = sourceBooksById.get(match.sourceBookId);
      if (!sourceBook) {
        counters.unresolved += 1;
        continue;
      }

      const values = buildMetadataPatch(sourceBook);

      await this.db
        .insert(schema.bookMetadata)
        .values({ bookId: match.targetBookId, ...values })
        .onConflictDoUpdate({
          target: schema.bookMetadata.bookId,
          set: values,
        });

      counters.imported += 1;
    }

    await this.repo.incrementRunMetric(runId, 'shared_overlays', 'book_metadata', counters);

    await this.importAuthors(runId, planned);
    await this.importNarrators(runId, planned);
    await this.importGenres(runId, planned);
    await this.importTags(runId, planned);
  }

  private async importAuthors(runId: number, planned: PlannerResult): Promise<void> {
    const sourceBooksById = new Map(planned.execution.sourceData.books.map((b) => [b.sourceBookId, b]));
    const counters = emptyCounters();

    for (const match of planned.execution.matchedBooks) {
      counters.processed += 1;
      const sourceBook = sourceBooksById.get(match.sourceBookId);
      if (!sourceBook) {
        counters.unresolved += 1;
        continue;
      }

      await this.db.delete(schema.bookAuthors).where(eq(schema.bookAuthors.bookId, match.targetBookId));

      const authors = getSourceContributors(sourceBook.authors, sourceBook.author);
      if (authors.length === 0) {
        counters.skipped += 1;
        continue;
      }

      for (const [index, contributor] of authors.entries()) {
        const [author] = await this.db
          .insert(schema.authors)
          .values(buildContributorValues(contributor))
          .onConflictDoUpdate({ target: schema.authors.name, set: buildContributorValues(contributor) })
          .returning({ id: schema.authors.id });
        if (!author) continue;

        await this.db
          .insert(schema.bookAuthors)
          .values({ bookId: match.targetBookId, authorId: author.id, displayOrder: index })
          .onConflictDoNothing();
      }

      counters.imported += authors.length;
    }

    await this.repo.incrementRunMetric(runId, 'shared_overlays', 'book_authors', counters);
  }

  private async importNarrators(runId: number, planned: PlannerResult): Promise<void> {
    const sourceBooksById = new Map(planned.execution.sourceData.books.map((b) => [b.sourceBookId, b]));
    const counters = emptyCounters();

    for (const match of planned.execution.matchedBooks) {
      counters.processed += 1;
      const sourceBook = sourceBooksById.get(match.sourceBookId);
      if (!sourceBook) {
        counters.unresolved += 1;
        continue;
      }

      await this.db.delete(schema.bookNarrators).where(eq(schema.bookNarrators.bookId, match.targetBookId));

      const narrators = getSourceContributors(sourceBook.narrators, null);
      if (narrators.length === 0) {
        counters.skipped += 1;
        continue;
      }

      for (const [index, contributor] of narrators.entries()) {
        const [narrator] = await this.db
          .insert(schema.narrators)
          .values({ name: contributor.name, sortName: contributor.sortName ?? contributor.name })
          .onConflictDoUpdate({
            target: schema.narrators.name,
            set: { name: contributor.name, sortName: contributor.sortName ?? contributor.name },
          })
          .returning({ id: schema.narrators.id });
        if (!narrator) continue;

        await this.db
          .insert(schema.bookNarrators)
          .values({ bookId: match.targetBookId, narratorId: narrator.id, displayOrder: index })
          .onConflictDoNothing();
      }

      counters.imported += narrators.length;
    }

    await this.repo.incrementRunMetric(runId, 'shared_overlays', 'book_narrators', counters);
  }

  private async importGenres(runId: number, planned: PlannerResult): Promise<void> {
    const sourceBooksById = new Map(planned.execution.sourceData.books.map((b) => [b.sourceBookId, b]));
    const counters = emptyCounters();

    for (const match of planned.execution.matchedBooks) {
      counters.processed += 1;
      const sourceBook = sourceBooksById.get(match.sourceBookId);
      if (!sourceBook) {
        counters.unresolved += 1;
        continue;
      }

      await this.db.delete(schema.bookGenres).where(eq(schema.bookGenres.bookId, match.targetBookId));

      if (sourceBook.genres.length === 0) {
        counters.skipped += 1;
        continue;
      }

      for (const name of sourceBook.genres) {
        const [genre] = await this.db
          .insert(schema.genres)
          .values({ name })
          .onConflictDoUpdate({ target: schema.genres.name, set: { name: sql`excluded.name` } })
          .returning({ id: schema.genres.id });
        if (genre) {
          await this.db.insert(schema.bookGenres).values({ bookId: match.targetBookId, genreId: genre.id }).onConflictDoNothing();
          counters.imported += 1;
        }
      }
    }

    await this.repo.incrementRunMetric(runId, 'shared_overlays', 'book_genres', counters);
  }

  private async importTags(runId: number, planned: PlannerResult): Promise<void> {
    const sourceBooksById = new Map(planned.execution.sourceData.books.map((b) => [b.sourceBookId, b]));
    const counters = emptyCounters();

    for (const match of planned.execution.matchedBooks) {
      counters.processed += 1;
      const sourceBook = sourceBooksById.get(match.sourceBookId);
      if (!sourceBook) {
        counters.unresolved += 1;
        continue;
      }

      await this.db.delete(schema.bookTags).where(eq(schema.bookTags.bookId, match.targetBookId));

      if (sourceBook.tags.length === 0) {
        counters.skipped += 1;
        continue;
      }

      for (const name of sourceBook.tags) {
        const [tag] = await this.db
          .insert(schema.tags)
          .values({ name })
          .onConflictDoUpdate({ target: schema.tags.name, set: { name: sql`excluded.name` } })
          .returning({ id: schema.tags.id });
        if (tag) {
          await this.db.insert(schema.bookTags).values({ bookId: match.targetBookId, tagId: tag.id }).onConflictDoNothing();
          counters.imported += 1;
        }
      }
    }

    await this.repo.incrementRunMetric(runId, 'shared_overlays', 'book_tags', counters);
  }

  private resolveSourceMediaRootPath(sourceType: string, connectionConfig: unknown): string | null {
    if (sourceType !== 'booklore') return null;
    const config = parseBookloreConnectionConfig(connectionConfig);
    return config.mediaRootPath ?? null;
  }

  private async importBookCovers(
    runId: number,
    planned: PlannerResult,
    sourceMediaRootPath: string | null,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    const matches = planned.execution.matchedBooks;

    if (!sourceMediaRootPath) {
      counters.processed = matches.length;
      counters.skipped = matches.length;
      await this.repo.incrementRunMetric(runId, 'shared_overlays', 'book_covers', counters);
      return;
    }

    for (const match of matches) {
      await ensureRunning();
      counters.processed += 1;

      const sourceImageDir = join(sourceMediaRootPath, 'images', match.sourceBookId);
      const sourceCoverPath = join(sourceImageDir, 'cover.jpg');
      const sourceThumbnailPath = join(sourceImageDir, 'thumbnail.jpg');
      const coverBytes = await this.readOptionalFile(sourceCoverPath);
      if (!coverBytes) {
        counters.unresolved += 1;
        continue;
      }

      try {
        const targetCoverDir = coverDirPath(this.booksPath, match.targetBookId);
        await mkdir(targetCoverDir, { recursive: true });
        await this.deleteFilesByPrefix(targetCoverDir, 'cover_custom.');

        const coverExt = imageExt(coverBytes);
        await writeFile(join(targetCoverDir, `cover_custom.${coverExt}`), coverBytes);

        const sourceThumbnailBytes = await this.readOptionalFile(sourceThumbnailPath);
        const thumbnailBytes = sourceThumbnailBytes ?? (await generateThumbnail(coverBytes));
        await writeFile(join(targetCoverDir, 'thumbnail.jpg'), thumbnailBytes);

        const now = new Date();
        await this.db
          .insert(schema.bookMetadata)
          .values({ bookId: match.targetBookId, coverSource: 'custom', updatedAt: now })
          .onConflictDoUpdate({
            target: schema.bookMetadata.bookId,
            set: { coverSource: 'custom', updatedAt: now },
          });

        counters.imported += 1;
      } catch (error) {
        counters.failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`[migration.cover] runId=${runId} sourceBookId=${match.sourceBookId} targetBookId=${match.targetBookId} error="${message}"`);
      }
    }

    await this.repo.incrementRunMetric(runId, 'shared_overlays', 'book_covers', counters);
  }

  private async importUserState(runId: number, planned: PlannerResult, ensureRunning: RunStateCheck): Promise<void> {
    const sourceToTargetUser = new Map(planned.plan.userMappings.map((mapping) => [mapping.sourceUserId, mapping.targetUserId]));
    const sourceToTargetBook = new Map(planned.execution.matchedBooks.map((mapping) => [mapping.sourceBookId, mapping.targetBookId]));

    const targetBookIds = [...new Set(planned.execution.matchedBooks.map((entry) => entry.targetBookId))];
    const primaryFilesByBookId = new Map<number, number>();
    const audiobookPrimaryFilesByBookId = new Map<number, number>();
    const targetFilesByBookId = new Map<number, Array<{ id: number; hash: string | null; absolutePath: string }>>();
    if (targetBookIds.length > 0) {
      const primaryRows = await this.db
        .select({
          bookId: schema.books.id,
          primaryFileId: schema.books.primaryFileId,
          primaryFileFormat: schema.bookFiles.format,
        })
        .from(schema.books)
        .leftJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
        .where(inArray(schema.books.id, targetBookIds));
      for (const row of primaryRows) {
        if (!row.primaryFileId) continue;
        primaryFilesByBookId.set(row.bookId, row.primaryFileId);
        if (row.primaryFileFormat && isAudioFormat(row.primaryFileFormat)) {
          audiobookPrimaryFilesByBookId.set(row.bookId, row.primaryFileId);
        }
      }

      const fileRows = await this.db
        .select({
          id: schema.bookFiles.id,
          bookId: schema.bookFiles.bookId,
          hash: schema.bookFiles.hash,
          absolutePath: schema.bookFiles.absolutePath,
          format: schema.bookFiles.format,
        })
        .from(schema.bookFiles)
        .where(inArray(schema.bookFiles.bookId, targetBookIds));
      for (const row of fileRows) {
        const files = targetFilesByBookId.get(row.bookId) ?? [];
        files.push({ id: row.id, hash: row.hash, absolutePath: row.absolutePath });
        targetFilesByBookId.set(row.bookId, files);
      }
    }
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
    await this.clearUserBookStatusesForMappedScope(userMap, bookMap);

    for (const row of planned.execution.sourceData.userBookStatuses) {
      await ensureRunning();
      counters.processed += 1;
      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      const status = normalizeReadStatus(row.status, row.percentage);
      const sourceUpdatedAt = toDate(row.updatedAt) ?? new Date();

      await this.db
        .insert(schema.userBookStatus)
        .values({
          userId: targetUserId,
          bookId: targetBookId,
          status,
          source: 'manual',
          startedAt: toDate(row.startedAt),
          finishedAt: toDate(row.finishedAt),
          updatedAt: sourceUpdatedAt,
        })
        .onConflictDoUpdate({
          target: [schema.userBookStatus.userId, schema.userBookStatus.bookId],
          set: {
            status,
            source: 'manual',
            startedAt: toDate(row.startedAt),
            finishedAt: toDate(row.finishedAt),
            updatedAt: sourceUpdatedAt,
          },
        });

      counters.imported += 1;
    }

    await this.repo.incrementRunMetric(runId, 'user_state', 'user_book_status', counters);
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
    await this.clearReadingProgressForMappedScope(userMap, primaryFilesByBookId, sourceFileToTargetFile);

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

      const sourceUpdatedAt = toDate(row.updatedAt) ?? new Date();

      await this.db
        .insert(schema.readingProgress)
        .values({
          bookFileId: targetFileId,
          userId: targetUserId,
          percentage: clampPercent(row.percentage),
          cfi: row.cfi,
          pageNumber: row.pageNumber,
          positionSeconds: row.positionSeconds,
          updatedAt: sourceUpdatedAt,
        })
        .onConflictDoUpdate({
          target: [schema.readingProgress.bookFileId, schema.readingProgress.userId],
          set: {
            percentage: clampPercent(row.percentage),
            cfi: row.cfi,
            pageNumber: row.pageNumber,
            positionSeconds: row.positionSeconds,
            updatedAt: sourceUpdatedAt,
          },
        });

      counters.imported += 1;
    }

    await this.repo.incrementRunMetric(runId, 'user_state', 'reading_progress', counters);
  }

  private async importBookmarks(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    await this.clearBookmarksForMappedScope(userMap, bookMap);

    for (const row of planned.execution.sourceData.bookmarks) {
      await ensureRunning();
      counters.processed += 1;

      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      await this.db.insert(schema.bookmarks).values({
        userId: targetUserId,
        bookId: targetBookId,
        title: row.title ?? 'Imported bookmark',
        cfi: row.cfi,
        positionSeconds: row.positionSeconds,
        createdAt: toDate(row.createdAt) ?? new Date(),
      });
      counters.imported += 1;
    }

    await this.repo.incrementRunMetric(runId, 'user_state', 'bookmarks', counters);
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
    const sourceAudioRows = planned.execution.sourceData.userFileProgress.filter((row) => {
      const targetBookId = bookMap.get(row.sourceBookId);
      return targetBookId ? audiobookPrimaryFilesByBookId.has(targetBookId) : false;
    });
    await this.clearAudiobookProgressForMappedScope(userMap, audiobookPrimaryFilesByBookId);

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

      const sourceUpdatedAt = toDate(row.updatedAt) ?? new Date();

      await this.db
        .insert(schema.audiobookProgress)
        .values({
          userId: targetUserId,
          bookId: targetBookId,
          percentage: clampPercent(row.percentage),
          currentFileId: targetFileId,
          positionSeconds: clampNonNegative(row.positionSeconds),
          updatedAt: sourceUpdatedAt,
        })
        .onConflictDoUpdate({
          target: [schema.audiobookProgress.userId, schema.audiobookProgress.bookId],
          set: {
            percentage: clampPercent(row.percentage),
            currentFileId: targetFileId,
            positionSeconds: clampNonNegative(row.positionSeconds),
            updatedAt: sourceUpdatedAt,
          },
        });

      counters.imported += 1;
    }

    await this.repo.incrementRunMetric(runId, 'user_state', 'audiobook_progress', counters);
  }

  private async importAnnotations(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    await this.clearAnnotationsForMappedScope(userMap, bookMap);

    for (const row of planned.execution.sourceData.annotations) {
      await ensureRunning();
      counters.processed += 1;

      const targetUserId = userMap.get(row.sourceUserId);
      const targetBookId = bookMap.get(row.sourceBookId);
      if (!targetUserId || !targetBookId) {
        counters.unresolved += 1;
        continue;
      }

      await this.db.insert(schema.annotations).values({
        userId: targetUserId,
        bookId: targetBookId,
        cfi: row.cfi,
        text: row.text,
        color: row.color ?? 'yellow',
        style: row.style ?? 'highlight',
        note: row.note,
        chapterTitle: row.chapterTitle,
        createdAt: toDate(row.createdAt) ?? new Date(),
        updatedAt: toDate(row.updatedAt) ?? new Date(),
      });
      counters.imported += 1;
    }

    await this.repo.incrementRunMetric(runId, 'user_state', 'annotations', counters);
  }

  private async clearUserBookStatusesForMappedScope(userMap: Map<string, number>, bookMap: Map<string, number>): Promise<void> {
    const targetUserIds = uniqueNumbers([...userMap.values()]);
    const targetBookIds = uniqueNumbers([...bookMap.values()]);
    if (targetUserIds.length === 0 || targetBookIds.length === 0) return;
    await this.db
      .delete(schema.userBookStatus)
      .where(and(inArray(schema.userBookStatus.userId, targetUserIds), inArray(schema.userBookStatus.bookId, targetBookIds)));
  }

  private async clearReadingProgressForMappedScope(
    userMap: Map<string, number>,
    primaryFilesByBookId: Map<number, number>,
    sourceFileToTargetFile: Map<string, number>,
  ): Promise<void> {
    const targetUserIds = uniqueNumbers([...userMap.values()]);
    const targetFileIds = uniqueNumbers([...primaryFilesByBookId.values(), ...sourceFileToTargetFile.values()]);
    if (targetUserIds.length === 0 || targetFileIds.length === 0) return;
    await this.db
      .delete(schema.readingProgress)
      .where(and(inArray(schema.readingProgress.userId, targetUserIds), inArray(schema.readingProgress.bookFileId, targetFileIds)));
  }

  private async clearAudiobookProgressForMappedScope(
    userMap: Map<string, number>,
    audiobookPrimaryFilesByBookId: Map<number, number>,
  ): Promise<void> {
    const targetUserIds = uniqueNumbers([...userMap.values()]);
    const targetBookIds = uniqueNumbers([...audiobookPrimaryFilesByBookId.keys()]);
    if (targetUserIds.length === 0 || targetBookIds.length === 0) return;
    await this.db
      .delete(schema.audiobookProgress)
      .where(and(inArray(schema.audiobookProgress.userId, targetUserIds), inArray(schema.audiobookProgress.bookId, targetBookIds)));
  }

  private async clearBookmarksForMappedScope(userMap: Map<string, number>, bookMap: Map<string, number>): Promise<void> {
    const targetUserIds = uniqueNumbers([...userMap.values()]);
    const targetBookIds = uniqueNumbers([...bookMap.values()]);
    if (targetUserIds.length === 0 || targetBookIds.length === 0) return;
    await this.db
      .delete(schema.bookmarks)
      .where(and(inArray(schema.bookmarks.userId, targetUserIds), inArray(schema.bookmarks.bookId, targetBookIds)));
  }

  private async clearAnnotationsForMappedScope(userMap: Map<string, number>, bookMap: Map<string, number>): Promise<void> {
    const targetUserIds = uniqueNumbers([...userMap.values()]);
    const targetBookIds = uniqueNumbers([...bookMap.values()]);
    if (targetUserIds.length === 0 || targetBookIds.length === 0) return;
    await this.db
      .delete(schema.annotations)
      .where(and(inArray(schema.annotations.userId, targetUserIds), inArray(schema.annotations.bookId, targetBookIds)));
  }

  private async importCollections(
    runId: number,
    planned: PlannerResult,
    userMap: Map<string, number>,
    bookMap: Map<string, number>,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    const shelvesById = new Map(planned.execution.sourceData.shelves.map((row) => [row.sourceShelfId, row]));

    const targetUserIds = [...new Set([...userMap.values()])];
    const existingCollections =
      targetUserIds.length > 0 ? await this.db.select().from(schema.collections).where(inArray(schema.collections.userId, targetUserIds)) : [];

    const collectionKeyToId = new Map(existingCollections.map((row) => [`${row.userId}:${row.name.toLowerCase()}`, row.id]));
    const preparedCollectionIds = new Set<number>();

    const ensureCollectionForShelf = async (shelf: { sourceUserId: string; name: string }): Promise<number | null> => {
      const targetUserId = userMap.get(shelf.sourceUserId);
      if (!targetUserId) return null;

      const key = `${targetUserId}:${shelf.name.toLowerCase()}`;
      let collectionId = collectionKeyToId.get(key);
      if (!collectionId) {
        const [inserted] = await this.db
          .insert(schema.collections)
          .values({ userId: targetUserId, name: shelf.name, syncToKobo: false, displayOrder: 0 })
          .returning();
        collectionId = inserted.id;
        collectionKeyToId.set(key, collectionId);
      }

      if (!preparedCollectionIds.has(collectionId)) {
        await this.db.delete(schema.collectionBooks).where(eq(schema.collectionBooks.collectionId, collectionId));
        preparedCollectionIds.add(collectionId);
      }

      return collectionId;
    };

    for (const shelf of planned.execution.sourceData.shelves) {
      await ensureRunning();
      await ensureCollectionForShelf(shelf);
    }

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

      const collectionId = await ensureCollectionForShelf(shelf);
      if (!collectionId) {
        counters.unresolved += 1;
        continue;
      }

      const inserted = await this.db
        .insert(schema.collectionBooks)
        .values({ collectionId, bookId: targetBookId })
        .onConflictDoNothing()
        .returning({ collectionId: schema.collectionBooks.collectionId });
      if (inserted.length > 0) {
        counters.imported += 1;
      } else {
        counters.skipped += 1;
      }
    }

    await this.repo.incrementRunMetric(runId, 'user_state', 'collections', counters);
  }

  private async readOptionalFile(path: string): Promise<Buffer | null> {
    try {
      return await readFile(path);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  private async deleteFilesByPrefix(path: string, prefix: string): Promise<void> {
    const files = await this.readDirIfExists(path);
    for (const fileName of files) {
      if (!fileName.startsWith(prefix)) continue;
      await this.removeFileIfPresent(join(path, fileName));
    }
  }

  private async readDirIfExists(path: string): Promise<string[]> {
    try {
      await access(path, fsConstants.R_OK);
      return await readdir(path);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return [];
      throw error;
    }
  }

  private async removeFileIfPresent(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return;
      throw error;
    }
  }

  private async failRun(runId: number, message: string): Promise<void> {
    await this.repo.updateRunState(runId, 'failed', {
      currentStage: 'failed',
      endedAt: new Date(),
      errorMessage: message,
    });
  }
}

function emptyCounters(): StageCounters {
  return {
    processed: 0,
    imported: 0,
    skipped: 0,
    unresolved: 0,
    failed: 0,
  };
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value)))];
}

function buildSourceFileTargetMap(
  planned: PlannerResult,
  targetFilesByBookId: Map<number, Array<{ id: number; hash: string | null; absolutePath: string }>>,
): Map<string, number> {
  const sourceBooksById = new Map(planned.execution.sourceData.books.map((book) => [book.sourceBookId, book]));
  const out = new Map<string, number>();

  for (const match of planned.execution.matchedBooks) {
    const sourceBook = sourceBooksById.get(match.sourceBookId);
    const sourceFiles = sourceBook?.files ?? [];
    const targetFiles = targetFilesByBookId.get(match.targetBookId) ?? [];
    if (sourceFiles.length === 0 || targetFiles.length === 0) continue;

    for (const sourceFile of sourceFiles) {
      if (out.has(sourceFile.sourceFileId)) continue;

      if (sourceFile.fileHash) {
        const byHash = targetFiles.filter((targetFile) => targetFile.hash === sourceFile.fileHash);
        if (byHash.length === 1) {
          out.set(sourceFile.sourceFileId, byHash[0].id);
          continue;
        }
      }

      const mappedPath = applyPathMappings(sourceFile.filePath, planned.plan.pathMappings);
      if (mappedPath) {
        const byPath = targetFiles.filter((targetFile) => targetFile.absolutePath === mappedPath);
        if (byPath.length === 1) {
          out.set(sourceFile.sourceFileId, byPath[0].id);
        }
      }
    }
  }

  return out;
}

function buildMetadataPatch(sourceBook: {
  title: string | null;
  subtitle: string | null;
  isbn10: string | null;
  isbn13: string | null;
  description: string | null;
  publisher: string | null;
  publishedYear: number | null;
  language: string | null;
  pageCount?: number | null;
  seriesName?: string | null;
  seriesIndex?: number | null;
  rating?: number | null;
  googleBooksId?: string | null;
  goodreadsId?: string | null;
  amazonId?: string | null;
  hardcoverId?: string | null;
  audibleId?: string | null;
  comicvineId?: string | null;
  durationSeconds?: number | null;
  abridged?: boolean | null;
  presentFields?: string[];
}): Partial<typeof schema.bookMetadata.$inferInsert> {
  const field = <T>(name: string, value: T | undefined): T | undefined =>
    !sourceBook.presentFields || sourceBook.presentFields.includes(name) ? value : undefined;

  return pruneUndefined({
    title: field('title', sourceBook.title),
    subtitle: field('subtitle', sourceBook.subtitle),
    isbn10: field('isbn10', sourceBook.isbn10),
    isbn13: field('isbn13', sourceBook.isbn13),
    description: field('description', sourceBook.description),
    publisher: field('publisher', sourceBook.publisher),
    publishedYear: field('publishedYear', sourceBook.publishedYear),
    language: field('language', sourceBook.language),
    pageCount: field('pageCount', sourceBook.pageCount),
    seriesName: field('seriesName', sourceBook.seriesName),
    seriesIndex: field('seriesIndex', sourceBook.seriesIndex),
    rating: field('rating', sourceBook.rating),
    googleBooksId: field('googleBooksId', sourceBook.googleBooksId),
    goodreadsId: field('goodreadsId', sourceBook.goodreadsId),
    amazonId: field('amazonId', sourceBook.amazonId),
    hardcoverId: field('hardcoverId', sourceBook.hardcoverId),
    audibleId: field('audibleId', sourceBook.audibleId),
    comicvineId: field('comicvineId', sourceBook.comicvineId),
    durationSeconds: field('durationSeconds', sourceBook.durationSeconds),
    abridged: field('abridged', sourceBook.abridged === undefined ? undefined : (sourceBook.abridged ?? false)),
  });
}

function buildContributorValues(contributor: {
  name: string;
  sortName?: string | null;
  description?: string | null;
}): typeof schema.authors.$inferInsert {
  return pruneUndefined({
    name: contributor.name,
    sortName: contributor.sortName ?? contributor.name,
    description: contributor.description ?? undefined,
  });
}

function getSourceContributors(
  contributors: Array<{ name: string; sortName?: string | null; description?: string | null; displayOrder?: number | null }> | undefined,
  legacyValue: string | null,
): Array<{ name: string; sortName: string | null; description: string | null }> {
  const structured =
    contributors
      ?.filter((contributor) => contributor.name.trim().length > 0)
      .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((contributor) => ({
        name: contributor.name.trim(),
        sortName: contributor.sortName ?? null,
        description: contributor.description ?? null,
      })) ?? [];
  if (structured.length > 0) return dedupeContributors(structured);
  return parseAuthorNames(legacyValue).map((name) => ({ name, sortName: name, description: null }));
}

function dedupeContributors<T extends { name: string }>(contributors: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const contributor of contributors) {
    const key = contributor.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(contributor);
  }
  return out;
}

function parseAuthorNames(value: string | null): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  const parsed = parseJsonStringArray(trimmed);
  const rawNames = parsed ?? trimmed.split(/\s*(?:;|\||\s+&\s+|\s+and\s+)\s*/i);

  const seen = new Set<string>();
  const names: string[] = [];
  for (const rawName of rawNames) {
    const name = rawName.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function parseJsonStringArray(value: string): string[] | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return null;
    const strings = parsed.filter((item): item is string => typeof item === 'string');
    return strings.length > 0 ? strings : null;
  } catch {
    return null;
  }
}

function pruneUndefined<T extends Record<string, unknown>>(input: T): T {
  const out = {} as T;
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === code);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function clampPercent(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function clampNonNegative(value: number | null): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function normalizeReadStatus(
  rawStatus: string | null,
  percentage: number | null,
): 'unread' | 'reading' | 'read' | 'abandoned' | 'on_hold' | 'want_to_read' | 'rereading' | 'skimmed' {
  const normalized = rawStatus?.trim().toLowerCase();

  if (normalized === 'read' || normalized === 'completed') return 'read';
  if (normalized === 'reading' || normalized === 'in_progress') return 'reading';
  if (normalized === 'on_hold' || normalized === 'paused') return 'on_hold';
  if (normalized === 'abandoned' || normalized === 'dropped') return 'abandoned';
  if (normalized === 'want_to_read' || normalized === 'wishlist') return 'want_to_read';
  if (normalized === 'rereading') return 'rereading';
  if (normalized === 'skimmed') return 'skimmed';

  if (percentage != null) {
    if (percentage >= 98) return 'read';
    if (percentage > 0) return 'reading';
  }

  return 'unread';
}
