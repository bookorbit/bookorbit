import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { mkdir, readdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import {
  COVER_EXTRACTED_FILE_PREFIX,
  bookCoverDirPath,
  bookThumbnailPath,
  isCustomBookCoverFileName,
  isExtractedBookCoverFileName,
} from '../../common/book-cover-storage';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import {
  chooseCanonicalMetadataTextRow,
  normalizeMetadataText,
  normalizeMetadataTextKey,
  normalizeMetadataTextKeySql,
} from '../../common/utils/metadata-text-normalize.utils';
import { normalizePublishedDate, publishedYearFromDateKey } from '../../common/utils/published-date.utils';
import { SeriesIdentityService } from '../../common/services/series-identity.service';
import { SeriesMembershipService } from '../../common/services/series-membership.service';
import { refreshPrimaryAuthorSortNamesForAuthors, refreshPrimaryAuthorSortNamesForBooks } from '../../db/book-author-sort-key';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { BookMetadataLockService } from '../book-metadata-lock/book-metadata-lock.service';
import { ComicMetadataRepository } from './comic-metadata.repository';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { NarratorService } from '../narrator/narrator.service';
import { authors, bookAuthors, bookGenres, bookMetadata, books, bookTags, genres, tags } from '../../db/schema';
import { type ComicMetadataFields, isAudioFormat } from '@bookorbit/types';
import { parseAudioDuration } from './extractors/audio.extractor';
import type { ParsedBookData } from './extractors/format-extractor.interface';
import { generateThumbnail, imageExt } from './lib/cover';
import { METADATA_AUDIO_FORMATS, MetadataExtractionService } from './metadata-extraction.service';
import { MetadataEventsService, METADATA_AUTHORS_REPLACED } from './metadata-events.service';

type Db = NodePgDatabase<typeof schema>;
type RelationMutationExecutor = Pick<Db, 'delete' | 'execute' | 'insert' | 'select' | 'update'>;

interface RelationMutationOptions {
  executor?: RelationMutationExecutor;
  emitEvent?: boolean;
}

const MAX_RELATION_NAME_LENGTH = 200;
const EXTRACTED_COVER_SOURCE = 'extracted';
const MIN_PUBLISHED_YEAR = 1000;
const MAX_PUBLISHED_YEAR = 2200;
const NORMALIZED_AUTHOR_NAME_SQL = normalizeMetadataTextKeySql(authors.name);

function normalizePublishedYear(year: number | null | undefined): number | null | undefined {
  if (year === undefined) return undefined;
  if (year === null) return null;
  if (!Number.isInteger(year)) return null;
  if (year < MIN_PUBLISHED_YEAR || year > MAX_PUBLISHED_YEAR) return null;
  return year;
}

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);
  private readonly appDataPath: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
    private readonly extractionService: MetadataExtractionService,
    private readonly scoreService: MetadataScoreService,
    private readonly narratorService: NarratorService,
    private readonly comicMetadataRepository: ComicMetadataRepository,
    private readonly bookMetadataLockService: BookMetadataLockService,
    @Optional() private readonly embedder: BookEmbedderService,
    @Optional() private readonly metadataEvents?: MetadataEventsService,
    @Optional() private readonly seriesIdentity?: SeriesIdentityService,
    @Optional() private readonly seriesMemberships?: SeriesMembershipService,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async extractAndSave(bookId: number, absolutePath: string, format: string): Promise<void> {
    await this.extractAndSaveIfAvailable(bookId, absolutePath, format);
  }

  async extractAndSaveIfAvailable(bookId: number, absolutePath: string, format: string): Promise<boolean> {
    const event = 'metadata.extract_and_save';
    const startedAt = Date.now();
    this.logger.debug(`[${event}] [start] bookId=${bookId} format=${format} - metadata extraction started`);

    try {
      if (!this.extractionService.supports(format)) {
        this.logger.debug(
          `[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} extractorFound=false - metadata extraction skipped`,
        );
        return false;
      }

      const data = await this.extractionService.extract(absolutePath, format);
      if (!data) {
        this.logger.debug(
          `[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} parsed=false - metadata extraction skipped`,
        );
        return false;
      }

      await Promise.all([this.persistMetadata(bookId, data, format), data.cover ? this.persistCover(bookId, data.cover, true) : Promise.resolve()]);

      this.scoreService.calculateAndSave(bookId).catch((error: Error) => {
        this.logger.warn(
          `[metadata.score_calculation] [fail] bookId=${bookId} errorClass=${error.name} error="${sanitizeLogValue(error.message)}" - metadata score calculation failed`,
        );
      });

      this.logger.debug(
        `[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} coverExtracted=${data.cover != null} - metadata extraction completed`,
      );
      return true;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata extraction failed`,
      );
      throw error;
    }
  }

  // Called when ebook is the winner but audio files are also present.
  // Saves audio-specific fields that no ebook format can provide, plus audio provider IDs.
  // Cover is intentionally excluded - the winner ebook owns cover.
  async extractAudioChaptersAndNarrators(bookId: number, absolutePath: string, format: string): Promise<void> {
    if (!this.extractionService.supports(format)) return;
    const data = await this.extractionService.extract(absolutePath, format);
    if (!data) return;

    const { dto: filtered } = await this.bookMetadataLockService.filterAutomatedBookUpdate(bookId, {
      audibleId: data.audibleId,
      librofmId: data.librofmId,
      audioMetadata: {
        narrators: data.narrators,
        chapters: data.chapters && data.chapters.length > 0 ? data.chapters : null,
      },
    });

    const updates: Promise<unknown>[] = [];

    if (filtered.audibleId !== undefined) {
      updates.push(this.db.update(bookMetadata).set({ audibleId: filtered.audibleId, updatedAt: new Date() }).where(eq(bookMetadata.bookId, bookId)));
    }

    if (filtered.librofmId !== undefined) {
      updates.push(this.db.update(bookMetadata).set({ librofmId: filtered.librofmId, updatedAt: new Date() }).where(eq(bookMetadata.bookId, bookId)));
    }

    if (filtered.audioMetadata?.chapters !== undefined) {
      updates.push(
        this.db.update(bookMetadata).set({ chapters: filtered.audioMetadata.chapters, updatedAt: new Date() }).where(eq(bookMetadata.bookId, bookId)),
      );
    }

    if (filtered.audioMetadata?.narrators !== undefined) {
      updates.push(this.narratorService.replaceForBook(bookId, filtered.audioMetadata.narrators));
    }

    await Promise.all(updates);
  }

  async downloadAndSaveCover(url: string, bookId: number): Promise<boolean> {
    const event = 'metadata.cover_download';
    const startedAt = Date.now();
    this.logger.debug(`[${event}] [start] bookId=${bookId} - cover download started`);

    try {
      if (await this.bookMetadataLockService.isFieldLocked(bookId, 'cover')) {
        this.logger.debug(`[${event}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} saved=false locked=true - cover download skipped`);
        return false;
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        this.logger.debug(
          `[${event}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} saved=false status=${res.status} - cover download skipped`,
        );
        return false;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0) {
        this.logger.debug(`[${event}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} saved=false empty=true - cover download skipped`);
        return false;
      }

      await this.persistCover(bookId, buffer, true);
      this.logger.debug(`[${event}] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} saved=true - cover download completed`);
      return true;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - cover download failed`,
      );
      return false;
    }
  }

  async saveExtractedCoverBytes(bookId: number, bytes: Buffer): Promise<void> {
    await this.persistCover(bookId, bytes, true);
  }

  async refreshCoverForBook(bookId: number, absolutePath: string, format: string): Promise<boolean> {
    const event = 'metadata.cover_refresh';
    const startedAt = Date.now();
    if (!this.extractionService.supports(format)) {
      this.logger.debug(
        `[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} refreshed=false extractorFound=false - cover refresh skipped`,
      );
      return false;
    }

    try {
      if (await this.bookMetadataLockService.isFieldLocked(bookId, 'cover')) {
        this.logger.debug(
          `[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} refreshed=false locked=true - cover refresh skipped`,
        );
        return false;
      }
      const data = await this.extractionService.extract(absolutePath, format);
      if (!data?.cover) {
        this.logger.debug(
          `[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} refreshed=false coverFound=false - cover refresh skipped`,
        );
        return false;
      }
      await this.persistCover(bookId, data.cover, false);
      this.logger.debug(
        `[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} refreshed=true - cover refresh completed`,
      );
      return true;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - cover refresh failed`,
      );
      return false;
    }
  }

  // ── Audio helpers ────────────────────────────────────────────────────────────

  async extractAudioFileDuration(bookId: number, absolutePath: string): Promise<void> {
    const durationSeconds = await parseAudioDuration(absolutePath);
    if (durationSeconds === null) return;
    await this.db
      .update(schema.bookFiles)
      .set({ durationSeconds })
      .where(and(eq(schema.bookFiles.bookId, bookId), eq(schema.bookFiles.absolutePath, absolutePath)));
  }

  async aggregateAudioDuration(bookId: number): Promise<void> {
    if (await this.bookMetadataLockService.isFieldLocked(bookId, 'durationSeconds')) return;
    const [primary] = await this.db
      .select({ format: schema.bookFiles.format })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
      .where(and(eq(schema.books.id, bookId), inArray(schema.bookFiles.format, [...METADATA_AUDIO_FORMATS])));
    if (!primary?.format) return;

    const rows = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${schema.bookFiles.durationSeconds}), 0)` })
      .from(schema.bookFiles)
      .where(and(eq(schema.bookFiles.bookId, bookId), eq(schema.bookFiles.role, 'content'), eq(schema.bookFiles.format, primary.format)));

    const total = Number(rows[0]?.total ?? 0);
    if (total > 0) {
      await this.db.update(bookMetadata).set({ durationSeconds: total }).where(eq(bookMetadata.bookId, bookId));
    }
  }

  async extractAndAggregateAudioDuration(bookId: number, absolutePath: string): Promise<void> {
    await this.extractAudioFileDuration(bookId, absolutePath);
    await this.aggregateAudioDuration(bookId);
  }

  // ── Authors ──────────────────────────────────────────────────────────────────

  async replaceAuthors(
    bookId: number,
    parsedAuthors: { name: string; sortName: string | null }[],
    options: RelationMutationOptions = {},
  ): Promise<number[]> {
    const normalized = parsedAuthors
      .map((author) => ({
        name: normalizeMetadataText(author.name),
        sortName: normalizeMetadataText(author.sortName),
      }))
      .filter((author): author is { name: string; sortName: string | null } => author.name !== null);

    const seen = new Set<string>();
    const unique = normalized.filter((author) => {
      const key = normalizeMetadataTextKey(author.name);
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const linkedAuthorIds = options.executor
      ? await this.replaceAuthorsInExecutor(options.executor, bookId, unique)
      : await this.db.transaction(async (tx) => this.replaceAuthorsInExecutor(tx, bookId, unique));

    const emitEvent = options.emitEvent ?? true;
    if (emitEvent && linkedAuthorIds.length > 0) {
      this.emitAuthorsReplaced(bookId, linkedAuthorIds);
    }

    return linkedAuthorIds;
  }

  emitAuthorsReplaced(bookId: number, authorIds: number[]): void {
    if (authorIds.length === 0) return;
    this.metadataEvents?.emit(METADATA_AUTHORS_REPLACED, { bookId, authorIds });
  }

  // ── Genres ───────────────────────────────────────────────────────────────────

  async replaceNarrators(bookId: number, narratorNames: { name: string; sortName: string | null }[]) {
    await this.narratorService.replaceForBook(bookId, narratorNames);
  }

  async upsertComicMetadata(bookId: number, fields: ComicMetadataFields) {
    await this.comicMetadataRepository.upsert(bookId, fields);
  }

  async replaceGenres(bookId: number, parsedGenres: string[], options: RelationMutationOptions = {}) {
    const uniqueGenres = this.normalizeUniqueRelationNames(parsedGenres);

    if (options.executor) {
      await this.replaceGenresInExecutor(options.executor, bookId, uniqueGenres);
      return;
    }

    await this.db.transaction(async (tx) => {
      await this.replaceGenresInExecutor(tx, bookId, uniqueGenres);
    });
  }

  // ── Tags ─────────────────────────────────────────────────────────────────────

  async replaceTags(bookId: number, userTags: string[], options: RelationMutationOptions = {}) {
    const uniqueTags = this.normalizeUniqueRelationNames(userTags);

    if (options.executor) {
      await this.replaceTagsInExecutor(options.executor, bookId, uniqueTags);
      return;
    }

    await this.db.transaction(async (tx) => {
      await this.replaceTagsInExecutor(tx, bookId, uniqueTags);
    });
  }

  private async replaceAuthorsInExecutor(
    executor: RelationMutationExecutor,
    bookId: number,
    uniqueAuthors: { name: string; sortName: string | null }[],
  ): Promise<number[]> {
    await executor.delete(bookAuthors).where(eq(bookAuthors.bookId, bookId));

    if (uniqueAuthors.length === 0) {
      await refreshPrimaryAuthorSortNamesForBooks(executor, [bookId]);
      return [];
    }

    const authorByNameKey = new Map<string, { id: number }>();
    await this.addExistingAuthorsByNormalizedName(
      executor,
      authorByNameKey,
      uniqueAuthors.map((author) => author.name),
    );

    const missingAuthors = uniqueAuthors.filter((author) => {
      const key = normalizeMetadataTextKey(author.name);
      return key ? !authorByNameKey.has(key) : false;
    });

    if (missingAuthors.length > 0) {
      const insertedAuthors = await executor
        .insert(authors)
        .values(missingAuthors.map((author) => ({ name: author.name, sortName: author.sortName })))
        .onConflictDoNothing()
        .returning({ id: authors.id, name: authors.name });
      for (const row of insertedAuthors) {
        const key = normalizeMetadataTextKey(row.name);
        if (key) authorByNameKey.set(key, { id: row.id });
      }
    }

    await this.addExistingAuthorsByNormalizedName(
      executor,
      authorByNameKey,
      uniqueAuthors.filter((author) => !authorByNameKey.has(normalizeMetadataTextKey(author.name) ?? '')).map((author) => author.name),
    );

    const links = uniqueAuthors.flatMap((author, index) => {
      const key = normalizeMetadataTextKey(author.name);
      const match = key ? authorByNameKey.get(key) : undefined;
      if (!match) return [];
      return [{ bookId, authorId: match.id, displayOrder: index }];
    });

    if (links.length > 0) {
      await executor.insert(bookAuthors).values(links).onConflictDoNothing();
    }

    await refreshPrimaryAuthorSortNamesForBooks(executor, [bookId]);

    return links.map((link) => link.authorId);
  }

  private async addExistingAuthorsByNormalizedName(
    executor: RelationMutationExecutor,
    authorByNameKey: Map<string, { id: number }>,
    names: string[],
  ): Promise<void> {
    const keys = [...new Set(names.map((name) => normalizeMetadataTextKey(name)).filter((key): key is string => key !== null))].filter(
      (key) => !authorByNameKey.has(key),
    );
    if (keys.length === 0) return;

    const existingAuthors = await executor
      .select({ id: authors.id, name: authors.name, normalizedName: NORMALIZED_AUTHOR_NAME_SQL })
      .from(authors)
      .where(inArray(NORMALIZED_AUTHOR_NAME_SQL, keys));

    const desiredNameByKey = new Map<string, string>();
    for (const name of names) {
      const key = normalizeMetadataTextKey(name);
      const displayName = normalizeMetadataText(name);
      if (key && displayName && !desiredNameByKey.has(key)) {
        desiredNameByKey.set(key, displayName);
      }
    }

    const rowsByKey = new Map<string, typeof existingAuthors>();
    for (const row of existingAuthors) {
      const key = normalizeMetadataTextKey(row.normalizedName) ?? normalizeMetadataTextKey(row.name);
      if (!key || authorByNameKey.has(key)) continue;
      const rows = rowsByKey.get(key) ?? [];
      rows.push(row);
      rowsByKey.set(key, rows);
    }

    const canonicalizedAuthorIds: number[] = [];
    for (const [key, rows] of rowsByKey) {
      const desiredName = desiredNameByKey.get(key);
      const match = chooseCanonicalMetadataTextRow(rows, { desiredName });
      if (!match) continue;

      const canonicalName = normalizeMetadataText(match.name);
      if (canonicalName && match.name !== canonicalName && !rows.some((row) => row.id !== match.id && row.name === canonicalName)) {
        await executor.update(authors).set({ name: canonicalName }).where(eq(authors.id, match.id));
        canonicalizedAuthorIds.push(match.id);
      }
      authorByNameKey.set(key, { id: match.id });
    }

    if (canonicalizedAuthorIds.length > 0) {
      await refreshPrimaryAuthorSortNamesForAuthors(executor, canonicalizedAuthorIds);
    }
  }

  private async replaceGenresInExecutor(executor: RelationMutationExecutor, bookId: number, uniqueGenres: string[]): Promise<void> {
    await executor.delete(bookGenres).where(eq(bookGenres.bookId, bookId));
    if (uniqueGenres.length === 0) return;

    const genreByName = new Map<string, { id: number }>();
    const insertedGenres = await executor
      .insert(genres)
      .values(uniqueGenres.map((name) => ({ name })))
      .onConflictDoNothing()
      .returning({ id: genres.id, name: genres.name });
    for (const row of insertedGenres) {
      genreByName.set(row.name, { id: row.id });
    }

    const unresolvedNames = uniqueGenres.filter((name) => !genreByName.has(name));
    if (unresolvedNames.length > 0) {
      const existingGenres = await executor.select({ id: genres.id, name: genres.name }).from(genres).where(inArray(genres.name, unresolvedNames));
      for (const row of existingGenres) {
        genreByName.set(row.name, { id: row.id });
      }
    }

    const links = uniqueGenres.flatMap((name) => {
      const match = genreByName.get(name);
      if (!match) return [];
      return [{ bookId, genreId: match.id }];
    });

    if (links.length > 0) {
      await executor.insert(bookGenres).values(links).onConflictDoNothing();
    }
  }

  private async replaceTagsInExecutor(executor: RelationMutationExecutor, bookId: number, uniqueTags: string[]): Promise<void> {
    await executor.delete(bookTags).where(eq(bookTags.bookId, bookId));
    if (uniqueTags.length === 0) return;

    const tagByName = new Map<string, { id: number }>();
    const insertedTags = await executor
      .insert(tags)
      .values(uniqueTags.map((name) => ({ name })))
      .onConflictDoNothing()
      .returning({ id: tags.id, name: tags.name });
    for (const row of insertedTags) {
      tagByName.set(row.name, { id: row.id });
    }

    const unresolvedNames = uniqueTags.filter((name) => !tagByName.has(name));
    if (unresolvedNames.length > 0) {
      const existingTags = await executor.select({ id: tags.id, name: tags.name }).from(tags).where(inArray(tags.name, unresolvedNames));
      for (const row of existingTags) {
        tagByName.set(row.name, { id: row.id });
      }
    }

    const links = uniqueTags.flatMap((name) => {
      const match = tagByName.get(name);
      if (!match) return [];
      return [{ bookId, tagId: match.id }];
    });

    if (links.length > 0) {
      await executor.insert(bookTags).values(links).onConflictDoNothing();
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private async persistMetadata(bookId: number, data: ParsedBookData, format: string): Promise<void> {
    if (isAudioFormat(format)) {
      await this.persistAudioMetadata(bookId, data);
    } else {
      await this.persistBookMetadata(bookId, data, format);
    }
    this.embedder?.embedBook(bookId).catch((error: Error) => {
      this.logger.warn(
        `[metadata.embedding] [fail] bookId=${bookId} errorClass=${error.name} error="${sanitizeLogValue(error.message)}" - book embedding failed`,
      );
    });
  }

  private async persistAudioMetadata(bookId: number, data: ParsedBookData): Promise<void> {
    const { dto: filtered } = await this.bookMetadataLockService.filterAutomatedBookUpdate(bookId, {
      title: data.title,
      subtitle: data.subtitle,
      description: data.description,
      publisher: normalizeMetadataText(data.publisher),
      publishedDate: data.publishedDate,
      publishedYear: data.publishedYear,
      language: data.language,
      seriesName: normalizeMetadataText(data.seriesName),
      seriesIndex: data.seriesIndex,
      authors: data.authors.map((author) => author.name),
      genres: data.genres,
      audibleId: data.audibleId,
      librofmId: data.librofmId,
      audioMetadata: {
        durationSeconds: data.durationSeconds ?? null,
        chapters: data.chapters && data.chapters.length > 0 ? data.chapters : null,
        narrators: data.narrators,
      },
    });

    const scalarFields: Partial<typeof schema.bookMetadata.$inferInsert> = {};
    if (filtered.title !== undefined) scalarFields.title = filtered.title;
    if (filtered.subtitle !== undefined) scalarFields.subtitle = filtered.subtitle;
    if (filtered.description !== undefined) scalarFields.description = filtered.description;
    if (filtered.publisher !== undefined) scalarFields.publisher = normalizeMetadataText(filtered.publisher);
    const publishedDate = normalizePublishedDate(filtered.publishedDate);
    if (publishedDate !== undefined) {
      scalarFields.publishedDate = publishedDate;
      if (publishedDate !== null) scalarFields.publishedYear = publishedYearFromDateKey(publishedDate);
    }
    if (filtered.publishedYear !== undefined && publishedDate === undefined) {
      scalarFields.publishedDate = null;
      scalarFields.publishedYear = normalizePublishedYear(filtered.publishedYear);
    } else if (filtered.publishedYear !== undefined && publishedDate === null) {
      scalarFields.publishedYear = normalizePublishedYear(filtered.publishedYear);
    }
    if (filtered.language !== undefined) scalarFields.language = filtered.language;
    if (filtered.seriesName !== undefined) scalarFields.seriesName = normalizeMetadataText(filtered.seriesName);
    if (filtered.seriesIndex !== undefined) scalarFields.seriesIndex = filtered.seriesIndex;
    if (filtered.audibleId !== undefined) scalarFields.audibleId = filtered.audibleId;
    if (filtered.librofmId !== undefined) scalarFields.librofmId = filtered.librofmId;
    if (filtered.audioMetadata?.durationSeconds !== undefined) scalarFields.durationSeconds = filtered.audioMetadata.durationSeconds;
    if (filtered.audioMetadata?.chapters !== undefined) scalarFields.chapters = filtered.audioMetadata.chapters;
    if (Object.keys(scalarFields).length > 0) {
      const shouldSyncSeries =
        Object.prototype.hasOwnProperty.call(scalarFields, 'seriesName') || Object.prototype.hasOwnProperty.call(scalarFields, 'seriesIndex');
      scalarFields.updatedAt = new Date();
      const patch = (await this.seriesIdentity?.resolveMetadataPatch(scalarFields)) ?? scalarFields;
      await this.db.update(bookMetadata).set(patch).where(eq(bookMetadata.bookId, bookId));
      if (shouldSyncSeries) {
        await this.seriesMemberships?.syncPrimaryFromMetadata(bookId);
      }
    }

    if (filtered.authors !== undefined) {
      await this.replaceAuthors(bookId, data.authors);
    }
    if (filtered.genres !== undefined) {
      await this.replaceGenres(bookId, filtered.genres);
    }

    if (filtered.audioMetadata?.narrators !== undefined) {
      await this.narratorService.replaceForBook(bookId, filtered.audioMetadata.narrators);
    }

    this.logger.debug(`[metadata.persist_audio] [end] bookId=${bookId} title="${sanitizeLogValue(data.title ?? '')}" - audio metadata persisted`);
  }

  private async persistBookMetadata(bookId: number, data: ParsedBookData, format: string): Promise<void> {
    const { dto: filtered } = await this.bookMetadataLockService.filterAutomatedBookUpdate(bookId, {
      title: data.title,
      subtitle: data.subtitle,
      description: data.description,
      isbn10: data.isbn10 ? data.isbn10.replace(/[^0-9Xx]/g, '') : data.isbn10,
      isbn13: data.isbn13 ? data.isbn13.replace(/[^0-9]/g, '') : data.isbn13,
      publisher: normalizeMetadataText(data.publisher),
      publishedDate: data.publishedDate,
      publishedYear: data.publishedYear,
      language: data.language,
      seriesName: normalizeMetadataText(data.seriesName),
      seriesIndex: data.seriesIndex,
      authors: data.authors.map((author) => author.name),
      genres: data.genres,
      tags: data.tags,
      rating: normalizeImportedRating(data.rating),
      pageCount: data.pageCount,
      googleBooksId: data.googleBooksId,
      goodreadsId: data.goodreadsId,
      amazonId: data.amazonId,
      hardcoverId: data.hardcoverId,
      hardcoverEditionId: data.hardcoverEditionId,
      openLibraryId: data.openLibraryId,
      ranobedbId: data.ranobedbId,
      koboId: data.koboId,
      lubimyczytacId: data.lubimyczytacId,
      aladinId: data.aladinId,
      itunesId: data.itunesId,
      comicMetadata: data.comicMetadata ?? undefined,
    });

    const scalarFields: Partial<typeof schema.bookMetadata.$inferInsert> = {};
    if (filtered.title !== undefined) scalarFields.title = filtered.title;
    if (filtered.subtitle !== undefined) scalarFields.subtitle = filtered.subtitle;
    if (filtered.description !== undefined) scalarFields.description = filtered.description;
    if (filtered.isbn10 !== undefined) scalarFields.isbn10 = filtered.isbn10;
    if (filtered.isbn13 !== undefined) scalarFields.isbn13 = filtered.isbn13;
    if (filtered.publisher !== undefined) scalarFields.publisher = normalizeMetadataText(filtered.publisher);
    const publishedDate = normalizePublishedDate(filtered.publishedDate);
    if (publishedDate !== undefined) {
      scalarFields.publishedDate = publishedDate;
      if (publishedDate !== null) scalarFields.publishedYear = publishedYearFromDateKey(publishedDate);
    }
    if (filtered.publishedYear !== undefined && publishedDate === undefined) {
      scalarFields.publishedDate = null;
      scalarFields.publishedYear = normalizePublishedYear(filtered.publishedYear);
    } else if (filtered.publishedYear !== undefined && publishedDate === null) {
      scalarFields.publishedYear = normalizePublishedYear(filtered.publishedYear);
    }
    if (filtered.language !== undefined) scalarFields.language = filtered.language;
    if (filtered.seriesName !== undefined) scalarFields.seriesName = normalizeMetadataText(filtered.seriesName);
    if (filtered.seriesIndex !== undefined) scalarFields.seriesIndex = filtered.seriesIndex;
    if (filtered.rating !== undefined) scalarFields.rating = filtered.rating;
    if (filtered.pageCount !== undefined) scalarFields.pageCount = filtered.pageCount;
    if (filtered.googleBooksId !== undefined) scalarFields.googleBooksId = filtered.googleBooksId;
    if (filtered.goodreadsId !== undefined) scalarFields.goodreadsId = filtered.goodreadsId;
    if (filtered.amazonId !== undefined) scalarFields.amazonId = filtered.amazonId;
    if (filtered.hardcoverId !== undefined) scalarFields.hardcoverId = filtered.hardcoverId;
    if (filtered.hardcoverEditionId !== undefined) scalarFields.hardcoverEditionId = filtered.hardcoverEditionId;
    if (filtered.openLibraryId !== undefined) scalarFields.openLibraryId = filtered.openLibraryId;
    if (filtered.ranobedbId !== undefined) scalarFields.ranobedbId = filtered.ranobedbId;
    if (filtered.koboId !== undefined) scalarFields.koboId = filtered.koboId;
    if (filtered.lubimyczytacId !== undefined) scalarFields.lubimyczytacId = filtered.lubimyczytacId;
    if (filtered.aladinId !== undefined) scalarFields.aladinId = filtered.aladinId;
    if (filtered.itunesId !== undefined) scalarFields.itunesId = filtered.itunesId;
    if (Object.keys(scalarFields).length > 0) {
      const shouldSyncSeries =
        Object.prototype.hasOwnProperty.call(scalarFields, 'seriesName') || Object.prototype.hasOwnProperty.call(scalarFields, 'seriesIndex');
      scalarFields.updatedAt = new Date();
      const patch = (await this.seriesIdentity?.resolveMetadataPatch(scalarFields)) ?? scalarFields;
      await this.db.update(bookMetadata).set(patch).where(eq(bookMetadata.bookId, bookId));
      if (shouldSyncSeries) {
        await this.seriesMemberships?.syncPrimaryFromMetadata(bookId);
      }
    }

    if (filtered.authors !== undefined) {
      await this.replaceAuthors(bookId, data.authors);
    }
    if (filtered.genres !== undefined) {
      await this.replaceGenres(bookId, filtered.genres);
    }
    if (filtered.tags !== undefined) {
      await this.replaceTags(bookId, filtered.tags);
    }

    if (filtered.comicMetadata) {
      await this.comicMetadataRepository.upsert(bookId, filtered.comicMetadata);
    }

    this.logger.debug(
      `[metadata.persist_book] [end] bookId=${bookId} format=${format} title="${sanitizeLogValue(data.title ?? '')}" - book metadata persisted`,
    );
  }

  // ── Cover ────────────────────────────────────────────────────────────────────

  /**
   * Saves cover bytes to disk and updates the cover source in the DB.
   * When overwrite is false, the cover source is only set if it is currently null
   * (first-writer-wins, used during initial scan of non-primary files).
   * When overwrite is true, the cover source is always updated
   * (used for audio primary files and manually uploaded covers).
   */
  private async persistCover(bookId: number, bytes: Buffer, overwrite: boolean): Promise<void> {
    if (await this.bookMetadataLockService.isFieldLocked(bookId, 'cover')) return;
    const ext = imageExt(bytes);
    const dir = bookCoverDirPath(this.appDataPath, bookId);
    await mkdir(dir, { recursive: true });

    const files = await readdir(dir).catch(() => [] as string[]);
    const [currentCover] = await this.db
      .select({ coverSource: bookMetadata.coverSource })
      .from(bookMetadata)
      .where(eq(bookMetadata.bookId, bookId))
      .limit(1);
    const preserveCustom = !overwrite && currentCover?.coverSource === 'custom';

    const staleCoverFiles = files.filter(
      (fileName) => isExtractedBookCoverFileName(fileName) || (!preserveCustom && isCustomBookCoverFileName(fileName)),
    );
    await Promise.all(staleCoverFiles.map((fileName) => rm(join(dir, fileName), { force: true })));

    await writeFile(join(dir, `${COVER_EXTRACTED_FILE_PREFIX}${ext}`), bytes);

    if (!preserveCustom) {
      const thumbnail = await generateThumbnail(bytes);
      await writeFile(bookThumbnailPath(this.appDataPath, bookId), thumbnail);
    }

    const now = new Date();

    if (overwrite) {
      await this.db.update(bookMetadata).set({ coverSource: EXTRACTED_COVER_SOURCE, updatedAt: now }).where(eq(bookMetadata.bookId, bookId));
    } else {
      await this.db
        .update(bookMetadata)
        .set({ coverSource: EXTRACTED_COVER_SOURCE })
        .where(and(eq(bookMetadata.bookId, bookId), isNull(bookMetadata.coverSource)));
    }

    if (!preserveCustom) {
      await this.db.update(books).set({ updatedAt: now }).where(eq(books.id, bookId));
    }
  }

  private normalizeUniqueRelationNames(values: string[]): string[] {
    return [...new Set(values.map((value) => value.trim().substring(0, MAX_RELATION_NAME_LENGTH)).filter(Boolean))];
  }
}

function normalizeImportedRating(value: number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  const normalized = Math.round(value);
  return normalized >= 1 && normalized <= 10 ? normalized : null;
}
