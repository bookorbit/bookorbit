import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import sharp from 'sharp';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { isKnownPlaceholderCover } from '../../common/utils/placeholder-cover.utils';
import {
  chooseCanonicalMetadataTextRow,
  normalizeMetadataText,
  normalizeMetadataTextKey,
  normalizeMetadataTextKeySql,
} from '../../common/utils/metadata-text-normalize.utils';
import { normalizePublishedDate, publishedYearFromDateKey } from '../../common/utils/published-date.utils';
import { boundProviderId } from '../../common/utils/provider-id.utils';
import { SeriesIdentityService } from '../../common/services/series-identity.service';
import { SeriesExpectedCountService } from '../../common/services/series-expected-count.service';
import { SeriesMembershipService } from '../../common/services/series-membership.service';
import { refreshPrimaryAuthorSortNamesForAuthors, refreshPrimaryAuthorSortNamesForBooks } from '../../db/book-author-sort-key';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { BookMetadataLockService } from '../book-metadata-lock/book-metadata-lock.service';
import { ComicMetadataRepository } from './comic-metadata.repository';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { NarratorService } from '../narrator/narrator.service';
import { authors, bookAuthors, bookGenres, bookMetadata, bookTags, genres, tags } from '../../db/schema';
import {
  type AudiobookChapter,
  type ComicMetadataFields,
  type CoverMedium,
  coverShapeFromSize,
  isAudioFormat,
  MIN_COVER_SHORT_SIDE_PX,
} from '@bookorbit/types';
import { chaptersReachLastFile, mergeAudioChapters, type AudioChapterSource } from './extractors/audio-chapter-merge';
import { parseAudioDuration, probeAudioChapters } from './extractors/audio.extractor';
import type { ParsedBookData } from './extractors/format-extractor.interface';
import { METADATA_AUDIO_FORMATS, MetadataExtractionService } from './metadata-extraction.service';
import { MetadataEventsService, METADATA_AUTHORS_REPLACED } from './metadata-events.service';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import type { BookCoverOrigin } from '../book-cover-store/book-cover-store.repository';

type Db = NodePgDatabase<typeof schema>;
type RelationMutationExecutor = Pick<Db, 'delete' | 'execute' | 'insert' | 'select' | 'update'>;

interface RelationMutationOptions {
  executor?: RelationMutationExecutor;
  emitEvent?: boolean;
}

const MAX_RELATION_NAME_LENGTH = 200;
const MIN_PUBLISHED_YEAR = 1000;
const MAX_PUBLISHED_YEAR = 2200;
const MAX_COVER_DOWNLOADS = 3;
const MAX_COVER_DOWNLOAD_BYTES = 20 * 1024 * 1024;
const COVER_DOWNLOAD_TIMEOUT_MS = 15_000;

/** A fetched cover and how the provider's stated shape fits the slot it is meant for. */
export type CoverDownloadChoice = { url: string; fit?: 'match' | 'unknown' | 'mismatch' };
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

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly extractionService: MetadataExtractionService,
    private readonly scoreService: MetadataScoreService,
    private readonly narratorService: NarratorService,
    private readonly comicMetadataRepository: ComicMetadataRepository,
    private readonly bookMetadataLockService: BookMetadataLockService,
    private readonly coverStore: BookCoverStore,
    @Optional() private readonly embedder: BookEmbedderService,
    @Optional() private readonly metadataEvents?: MetadataEventsService,
    @Optional() private readonly seriesIdentity?: SeriesIdentityService,
    @Optional() private readonly seriesMemberships?: SeriesMembershipService,
    @Optional() private readonly seriesExpectedCount?: SeriesExpectedCountService,
  ) {}

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

      await Promise.all([
        this.persistMetadata(bookId, data, format),
        data.cover ? this.persistSourceCover(bookId, format, data.cover) : Promise.resolve(),
        this.persistFixedLayout(bookId, absolutePath, data.isFixedLayout),
      ]);

      await this.scoreService.calculateAndSave(bookId);

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
  // Saves audio-specific fields that no ebook format can provide, plus audio provider IDs, and the
  // track's art into the audio slot. The leading source owns the ebook slot, and a custom audio
  // cover survives because this write never overwrites one.
  async extractAudioChaptersAndNarrators(bookId: number, absolutePath: string, format: string): Promise<void> {
    if (!this.extractionService.supports(format)) return;
    const data = await this.extractionService.extract(absolutePath, format);
    if (!data) return;

    const { dto: filtered } = await this.bookMetadataLockService.filterAutomatedBookUpdate(bookId, {
      audibleId: boundProviderId('audibleId', data.audibleId),
      librofmId: boundProviderId('librofmId', data.librofmId),
      audioMetadata: {
        // Omitted when the tags name none: this pass fills in fields the shared metadata source
        // cannot carry, so an untagged file must not erase narrators another source already set.
        ...(data.narrators && data.narrators.length > 0 ? { narrators: data.narrators } : {}),
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

    if (data.cover) {
      updates.push(this.coverStore.saveExtracted(bookId, 'audio', data.cover, { origin: 'embedded', overwrite: false, skipIfUnchanged: true }));
    }

    await Promise.all(updates);
  }

  /**
   * Saves a fetched cover into one slot, trying the choices in order. An image that is too small or
   * the wrong shape for the slot moves on to the next choice, up to three downloads, and is kept
   * only as a last resort for an empty slot: a wrong-shape image never replaces a cover. A cover the
   * user picked by hand skips the shape check.
   */
  async downloadAndSaveCover(
    choices: readonly CoverDownloadChoice[],
    bookId: number,
    medium: CoverMedium,
    options: { userChosen?: boolean } = {},
  ): Promise<boolean> {
    const event = 'metadata.cover_download';
    const startedAt = Date.now();
    const checkShape = options.userChosen !== true;
    this.logger.debug(`[${event}] [start] bookId=${bookId} medium=${medium} choices=${choices.length} - cover download started`);

    try {
      const lockField = medium === 'ebook' ? 'cover' : 'audioCover';
      if (await this.bookMetadataLockService.isFieldLocked(bookId, lockField)) {
        this.logger.debug(
          `[${event}] [end] bookId=${bookId} medium=${medium} durationMs=${Date.now() - startedAt} saved=false locked=true - cover download skipped`,
        );
        return false;
      }
      const slotFilled = checkShape ? await this.coverStore.hasActiveSlot(bookId, medium) : false;

      let lastResort: Buffer | null = null;
      let downloads = 0;
      let skipped = 0;
      let saved = false;
      for (const choice of choices) {
        if (downloads >= MAX_COVER_DOWNLOADS) break;
        if (checkShape && choice.fit === 'mismatch' && (slotFilled || lastResort)) continue;
        downloads++;
        const bytes = await this.fetchCoverBytes(choice.url);
        if (!bytes) {
          skipped++;
          continue;
        }
        if (!checkShape) {
          saved = await this.persistCover(bookId, medium, bytes, true, 'provider');
          break;
        }
        const fit = await this.measureCoverFit(bytes, medium);
        if (fit === 'fits') {
          saved = await this.persistCover(bookId, medium, bytes, true, 'provider');
          break;
        }
        skipped++;
        if (fit === 'wrong_shape' && !slotFilled && !lastResort) lastResort = bytes;
      }
      if (!saved && lastResort) saved = await this.persistCover(bookId, medium, lastResort, true, 'provider');

      this.logger.debug(
        `[${event}] [end] bookId=${bookId} medium=${medium} durationMs=${Date.now() - startedAt} downloads=${downloads} skipped=${skipped} saved=${saved} - cover download completed`,
      );
      if (!saved) return false;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} medium=${medium} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - cover download failed`,
      );
      return false;
    }

    await this.scoreService.calculateAndSave(bookId);
    return true;
  }

  private async fetchCoverBytes(url: string): Promise<Buffer | null> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const res = await fetch(parsed, { signal: AbortSignal.timeout(COVER_DOWNLOAD_TIMEOUT_MS) });
    if (!res.ok || !res.body) return null;
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_COVER_DOWNLOAD_BYTES) return null;

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_COVER_DOWNLOAD_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return total > 0 ? Buffer.concat(chunks) : null;
  }

  private async measureCoverFit(bytes: Buffer, medium: CoverMedium): Promise<'fits' | 'wrong_shape' | 'unusable'> {
    let width: number | undefined;
    let height: number | undefined;
    try {
      ({ width, height } = await sharp(bytes, { failOn: 'none' }).metadata());
    } catch {
      return 'unusable';
    }
    if (!width || !height || Math.min(width, height) < MIN_COVER_SHORT_SIDE_PX || isKnownPlaceholderCover(bytes)) return 'unusable';
    return coverShapeFromSize(width, height) === (medium === 'audio' ? 'square' : 'portrait') ? 'fits' : 'wrong_shape';
  }

  async saveExtractedCoverBytes(bookId: number, bytes: Buffer, medium?: CoverMedium): Promise<void> {
    const target = medium ?? (await this.coverStore.chooseWriteMedium(bookId, bytes));
    if (await this.persistCover(bookId, target, bytes, true, 'dock')) await this.scoreService.calculateAndSave(bookId);
  }

  async refreshCoverForBook(bookId: number, absolutePath: string, format: string, requestedMedium?: CoverMedium): Promise<boolean> {
    const event = 'metadata.cover_refresh';
    const startedAt = Date.now();
    if (!this.extractionService.supports(format)) {
      this.logger.debug(
        `[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} refreshed=false extractorFound=false - cover refresh skipped`,
      );
      return false;
    }

    try {
      const medium = requestedMedium ?? this.mediumForFormat(format);
      const lockField = medium === 'ebook' ? 'cover' : 'audioCover';
      if (await this.bookMetadataLockService.isFieldLocked(bookId, lockField)) {
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
      if (!(await this.persistCover(bookId, medium, data.cover, false, 'embedded'))) return false;
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const errorMessage = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - cover refresh failed`,
      );
      return false;
    }

    await this.scoreService.calculateAndSave(bookId);
    this.logger.debug(
      `[${event}] [end] bookId=${bookId} format=${format} durationMs=${Date.now() - startedAt} refreshed=true - cover refresh completed`,
    );
    return true;
  }

  // ── Audio helpers ────────────────────────────────────────────────────────────

  /**
   * Records whether the extracted file is a fixed-layout EPUB. Kobo sync reads this to announce
   * comics as EPUB3FL so the device renders them full screen instead of adding reflow margins.
   */
  private async persistFixedLayout(bookId: number, absolutePath: string, isFixedLayout: boolean | null | undefined): Promise<void> {
    if (isFixedLayout == null) return;
    // `is distinct from` keeps a re-extraction of an unchanged file from touching the row at all.
    // Any write bumps book_files.updatedAt, which feeds the KOReader library token and OPDS entry
    // timestamps, so a no-op update would invalidate both for nothing.
    await this.db
      .update(schema.bookFiles)
      .set({ isFixedLayout })
      .where(
        and(
          eq(schema.bookFiles.bookId, bookId),
          eq(schema.bookFiles.absolutePath, absolutePath),
          sql`${schema.bookFiles.isFixedLayout} is distinct from ${isFixedLayout}`,
        ),
      );
  }

  /**
   * Rebuilds the chapter list of an audiobook split across several files.
   *
   * Metadata extraction reads a single file, and each file of a multi-file audiobook embeds only its
   * own chapters, numbered from zero. Probing every file in playback order is what turns those
   * per-file lists into one book-length list.
   *
   * With no file changed this first checks the stored list against the files, so books scanned
   * before chapters were merged are repaired without re-probing every audiobook on every scan.
   */
  async extractMergedAudioChapters(bookId: number, absolutePaths: string[], options: { filesChanged: boolean }): Promise<void> {
    const event = 'metadata.merge_audio_chapters';
    const startedAt = Date.now();
    if (absolutePaths.length < 2) return;
    if (!options.filesChanged && (await this.storedChaptersCoverBook(bookId, absolutePaths))) return;

    const sources: AudioChapterSource[] = [];
    for (const absolutePath of absolutePaths) {
      const { chapters, durationMs } = await probeAudioChapters(absolutePath);
      sources.push({ absolutePath, chapters, durationMs });
    }

    const merged = mergeAudioChapters(sources);
    if (merged === null) {
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} files=${absolutePaths.length} durationMs=${Date.now() - startedAt} errorClass=UnknownFileDuration error="a file length could not be read" - chapters left unchanged`,
      );
      return;
    }
    if (merged.length === 0) {
      this.logger.debug(
        `[${event}] [end] bookId=${bookId} files=${absolutePaths.length} durationMs=${Date.now() - startedAt} chapters=0 - no embedded chapters to merge`,
      );
      return;
    }

    const { dto: filtered } = await this.bookMetadataLockService.filterAutomatedBookUpdate(bookId, {
      audioMetadata: { chapters: merged },
    });
    if (filtered.audioMetadata?.chapters === undefined) return;

    await this.db
      .update(bookMetadata)
      .set({ chapters: filtered.audioMetadata.chapters, updatedAt: new Date() })
      .where(eq(bookMetadata.bookId, bookId));

    this.logger.debug(
      `[${event}] [end] bookId=${bookId} files=${absolutePaths.length} durationMs=${Date.now() - startedAt} chapters=${merged.length} - merged audio chapters saved`,
    );
  }

  private async storedChaptersCoverBook(bookId: number, orderedAudioPaths: string[]): Promise<boolean> {
    const [meta] = await this.db.select({ chapters: bookMetadata.chapters }).from(bookMetadata).where(eq(bookMetadata.bookId, bookId)).limit(1);
    const stored = (meta?.chapters ?? []) as AudiobookChapter[];
    if (stored.length === 0) return true;

    const fileRows = await this.db
      .select({ absolutePath: schema.bookFiles.absolutePath, durationSeconds: schema.bookFiles.durationSeconds })
      .from(schema.bookFiles)
      .where(eq(schema.bookFiles.bookId, bookId));

    const durationByPath = new Map(fileRows.map((row) => [row.absolutePath, row.durationSeconds]));
    const orderedDurationsMs = orderedAudioPaths.map((absolutePath) => {
      const durationSeconds = durationByPath.get(absolutePath);
      return durationSeconds === null || durationSeconds === undefined ? null : durationSeconds * 1000;
    });

    return chaptersReachLastFile(stored, orderedDurationsMs);
  }

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
      .where(eq(schema.books.id, bookId));
    if (!primary?.format) return;

    const audioFormats = isAudioFormat(primary.format) ? [primary.format] : [...METADATA_AUDIO_FORMATS];
    const rows = await this.db
      .select({ total: sql<number>`COALESCE(SUM(${schema.bookFiles.durationSeconds}), 0)` })
      .from(schema.bookFiles)
      .where(and(eq(schema.bookFiles.bookId, bookId), eq(schema.bookFiles.role, 'content'), inArray(schema.bookFiles.format, audioFormats)));

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
      audibleId: boundProviderId('audibleId', data.audibleId),
      librofmId: boundProviderId('librofmId', data.librofmId),
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
      // Every extractor feeds this path, so the column bound is enforced once here rather than
      // trusted to each parser: an identifier that overflows would otherwise fail the write with
      // a Postgres 22001 and take the rest of the book's metadata down with it.
      googleBooksId: boundProviderId('googleBooksId', data.googleBooksId),
      goodreadsId: boundProviderId('goodreadsId', data.goodreadsId),
      amazonId: boundProviderId('amazonId', data.amazonId),
      hardcoverId: boundProviderId('hardcoverId', data.hardcoverId),
      hardcoverEditionId: boundProviderId('hardcoverEditionId', data.hardcoverEditionId),
      openLibraryId: boundProviderId('openLibraryId', data.openLibraryId),
      ranobedbId: boundProviderId('ranobedbId', data.ranobedbId),
      koboId: boundProviderId('koboId', data.koboId),
      comicvineId: boundProviderId('comicvineId', data.comicvineId),
      lubimyczytacId: boundProviderId('lubimyczytacId', data.lubimyczytacId),
      aladinId: boundProviderId('aladinId', data.aladinId),
      itunesId: boundProviderId('itunesId', data.itunesId),
      comicMetadata: data.comicMetadata ?? undefined,
      // A sidecar can name narrators (OPF role="nrt"); only sent when it did, so an extractor that
      // has no narrator concept never reaches the replace below.
      audioMetadata: data.narrators && data.narrators.length > 0 ? { narrators: data.narrators } : undefined,
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
    if (filtered.comicvineId !== undefined) scalarFields.comicvineId = filtered.comicvineId;
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

    if (filtered.audioMetadata?.narrators !== undefined) {
      await this.narratorService.replaceForBook(bookId, filtered.audioMetadata.narrators);
    }

    // ComicInfo Count describes the series the file names, so it is read from the parsed file
    // rather than the lock-filtered patch: a locked seriesName still leaves the count truthful.
    await this.seriesExpectedCount?.record(data.seriesName, data.seriesTotalBooks);

    this.logger.debug(
      `[metadata.persist_book] [end] bookId=${bookId} format=${format} title="${sanitizeLogValue(data.title ?? '')}" - book metadata persisted`,
    );
  }

  // ── Cover ────────────────────────────────────────────────────────────────────

  /**
   * Saves extracted cover bytes into the medium's slot, resolving false when the slot is locked.
   * When overwrite is false a custom cover in the slot is kept and only its extracted fallback is
   * refreshed. When overwrite is true the extracted cover replaces it (used for the leading source
   * and fetched covers).
   */
  private async persistCover(bookId: number, medium: CoverMedium, bytes: Buffer, overwrite: boolean, origin: BookCoverOrigin): Promise<boolean> {
    return this.coverStore.saveExtracted(bookId, medium, bytes, { origin, overwrite });
  }

  /** An OPF image belongs to no medium, so on a book with both media its shape picks the slot. */
  private async persistSourceCover(bookId: number, format: string, bytes: Buffer): Promise<boolean> {
    if (format === 'opf') {
      const medium = await this.coverStore.chooseSidecarMedium(bookId, bytes);
      return this.persistCover(bookId, medium, bytes, true, 'opf');
    }
    return this.persistCover(bookId, this.mediumForFormat(format), bytes, true, 'embedded');
  }

  private mediumForFormat(format: string): CoverMedium {
    return isAudioFormat(format) ? 'audio' : 'ebook';
  }

  private normalizeUniqueRelationNames(values: string[]): string[] {
    const names = values.map((value) => {
      const truncated = normalizeMetadataText(value)?.substring(0, MAX_RELATION_NAME_LENGTH);
      // Truncating can strand a trailing space, so normalize again after the cut.
      return normalizeMetadataText(truncated);
    });
    return [...new Set(names.filter((name): name is string => name !== null))];
  }
}

function normalizeImportedRating(value: number | null | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  const normalized = Math.round(value);
  return normalized >= 1 && normalized <= 10 ? normalized : null;
}
