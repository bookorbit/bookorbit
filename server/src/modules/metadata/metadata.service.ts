import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { mkdir, readdir, writeFile } from 'fs/promises';
import { join } from 'path';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { ComicMetadataRepository } from './comic-metadata.repository';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { NarratorService } from '../narrator/narrator.service';
import { authors, bookAuthors, bookGenres, bookMetadata, bookTags, genres, tags } from '../../db/schema';
import { isAudioFormat } from '@projectx/types';
import { parseAudioDuration } from './extractors/audio.extractor';
import { AudioFormatExtractor } from './extractors/audio-format.extractor';
import { ComicFormatExtractor } from './extractors/comic-format.extractor';
import { EpubFormatExtractor } from './extractors/epub-format.extractor';
import { Fb2FormatExtractor } from './extractors/fb2-format.extractor';
import { MobiFormatExtractor } from './extractors/mobi-format.extractor';
import { PdfFormatExtractor } from './extractors/pdf-format.extractor';
import type { FormatExtractor, ParsedBookData } from './extractors/format-extractor.interface';
import { generateThumbnail, imageExt } from './lib/cover';
import { MetadataEventsService, METADATA_AUTHORS_REPLACED } from './metadata-events.service';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);
  private readonly booksPath: string;
  private readonly extractorMap: Map<string, FormatExtractor>;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
    private readonly scoreService: MetadataScoreService,
    private readonly narratorService: NarratorService,
    private readonly comicMetadataService: ComicMetadataRepository,
    @Optional() private readonly embedder: BookEmbedderService,
    @Optional() private readonly metadataEvents?: MetadataEventsService,
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
    const audio = new AudioFormatExtractor();
    const mobi = new MobiFormatExtractor();
    this.extractorMap = new Map<string, FormatExtractor>([
      ['epub', new EpubFormatExtractor()],
      ['pdf', new PdfFormatExtractor()],
      ['mobi', mobi],
      ['azw3', mobi],
      ['azw', mobi],
      ['cbz', new ComicFormatExtractor('cbz')],
      ['cbr', new ComicFormatExtractor('cbr')],
      ['cb7', new ComicFormatExtractor('cb7')],
      ['fb2', new Fb2FormatExtractor()],
      ['m4b', audio],
      ['mp3', audio],
      ['m4a', audio],
      ['opus', audio],
      ['ogg', audio],
      ['flac', audio],
    ]);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async extractAndSave(bookId: number, absolutePath: string, format: string): Promise<void> {
    const extractor = this.extractorMap.get(format);
    if (!extractor) return;

    const data = await extractor.extract(absolutePath);
    if (!data) return;

    await Promise.all([this.persistMetadata(bookId, data, format), data.cover ? this.persistCover(bookId, data.cover, true) : Promise.resolve()]);

    this.scoreService.calculateAndSave(bookId).catch((err: Error) => this.logger.warn(`Score calculation failed for book ${bookId}: ${err.message}`));
  }

  // Called when ebook is the winner but audio files are also present.
  // Saves audio-specific fields that no ebook format can provide: chapters and narrators.
  // Cover is intentionally excluded — the winner ebook owns cover.
  async extractAudioChaptersAndNarrators(bookId: number, absolutePath: string, format: string): Promise<void> {
    const extractor = this.extractorMap.get(format);
    if (!extractor) return;
    const data = await extractor.extract(absolutePath);
    if (!data) return;

    const updates: Promise<unknown>[] = [];

    if (data.chapters && data.chapters.length > 0) {
      updates.push(this.db.update(bookMetadata).set({ chapters: data.chapters, updatedAt: new Date() }).where(eq(bookMetadata.bookId, bookId)));
    }

    if (data.narrators && data.narrators.length > 0) {
      updates.push(this.narratorService.replaceForBook(bookId, data.narrators));
    }

    await Promise.all(updates);
  }

  async downloadAndSaveCover(url: string, bookId: number): Promise<boolean> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return false;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0) return false;
      await this.persistCover(bookId, buffer, true);
      this.logger.debug(`Online cover saved for book ${bookId}`);
      return true;
    } catch (err) {
      this.logger.warn(`Cover download failed for book ${bookId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  async saveExtractedCoverBytes(bookId: number, bytes: Buffer): Promise<void> {
    await this.persistCover(bookId, bytes, true);
  }

  async refreshCoverForBook(bookId: number, absolutePath: string, format: string): Promise<boolean> {
    const extractor = this.extractorMap.get(format);
    if (!extractor) return false;
    try {
      const data = await extractor.extract(absolutePath);
      if (!data?.cover) return false;
      await this.persistCover(bookId, data.cover, false);
      return true;
    } catch {
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
    const AUDIO_FORMATS = ['m4b', 'mp3', 'm4a', 'opus', 'ogg', 'flac'];
    const [primary] = await this.db
      .select({ format: schema.bookFiles.format })
      .from(schema.books)
      .innerJoin(schema.bookFiles, eq(schema.bookFiles.id, schema.books.primaryFileId))
      .where(and(eq(schema.books.id, bookId), inArray(schema.bookFiles.format, AUDIO_FORMATS)));
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

  // ── Authors ──────────────────────────────────────────────────────────────────

  async replaceAuthors(bookId: number, parsedAuthors: { name: string; sortName: string | null }[]) {
    await this.db.delete(bookAuthors).where(eq(bookAuthors.bookId, bookId));

    const normalized = parsedAuthors
      .map((author) => ({
        name: author.name.trim(),
        sortName: author.sortName?.trim() || null,
      }))
      .filter((author) => author.name.length > 0);

    if (normalized.length === 0) return;

    const seen = new Set<string>();
    const unique = normalized.filter((author) => {
      const key = author.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const linkedAuthorIds: number[] = [];

    for (let i = 0; i < unique.length; i++) {
      const { name, sortName } = unique[i];

      let [author] = await this.db.insert(authors).values({ name, sortName }).onConflictDoNothing().returning();
      if (!author) {
        [author] = await this.db.select().from(authors).where(eq(authors.name, name)).limit(1);
      }

      await this.db.insert(bookAuthors).values({ bookId, authorId: author.id, displayOrder: i }).onConflictDoNothing();
      linkedAuthorIds.push(author.id);
    }

    if (linkedAuthorIds.length > 0) {
      this.metadataEvents?.emit(METADATA_AUTHORS_REPLACED, {
        bookId,
        authorIds: linkedAuthorIds,
      });
    }
  }

  // ── Genres ───────────────────────────────────────────────────────────────────

  async replaceNarrators(bookId: number, narratorNames: { name: string; sortName: string | null }[]) {
    await this.narratorService.replaceForBook(bookId, narratorNames);
  }

  async replaceGenres(bookId: number, parsedGenres: string[]) {
    await this.db.delete(bookGenres).where(eq(bookGenres.bookId, bookId));
    const unique = [...new Set(parsedGenres.map((g) => g.trim().substring(0, 200)).filter(Boolean))];
    if (unique.length === 0) return;

    for (const name of unique) {
      let [genre] = await this.db.insert(genres).values({ name }).onConflictDoNothing().returning();
      if (!genre) {
        [genre] = await this.db.select().from(genres).where(eq(genres.name, name)).limit(1);
      }
      await this.db.insert(bookGenres).values({ bookId, genreId: genre.id }).onConflictDoNothing();
    }
  }

  // ── Tags ─────────────────────────────────────────────────────────────────────

  async replaceTags(bookId: number, userTags: string[]) {
    await this.db.delete(bookTags).where(eq(bookTags.bookId, bookId));
    const unique = [...new Set(userTags.map((t) => t.trim().substring(0, 200)).filter(Boolean))];
    if (unique.length === 0) return;

    for (const name of unique) {
      let [tag] = await this.db.insert(tags).values({ name }).onConflictDoNothing().returning();
      if (!tag) {
        [tag] = await this.db.select().from(tags).where(eq(tags.name, name)).limit(1);
      }
      await this.db.insert(bookTags).values({ bookId, tagId: tag.id }).onConflictDoNothing();
    }
  }

  // ── Persistence ──────────────────────────────────────────────────────────────

  private async persistMetadata(bookId: number, data: ParsedBookData, format: string): Promise<void> {
    if (isAudioFormat(format)) {
      await this.persistAudioMetadata(bookId, data);
    } else {
      await this.persistBookMetadata(bookId, data, format);
    }
    this.embedder?.embedBook(bookId).catch((err: Error) => this.logger.warn(`Embedding failed for book ${bookId}: ${err.message}`));
  }

  private async persistAudioMetadata(bookId: number, data: ParsedBookData): Promise<void> {
    await this.db
      .update(bookMetadata)
      .set({
        title: data.title,
        description: data.description,
        publisher: data.publisher,
        publishedYear: data.publishedYear,
        language: data.language,
        durationSeconds: data.durationSeconds ?? null,
        chapters: data.chapters && data.chapters.length > 0 ? data.chapters : null,
        updatedAt: new Date(),
      })
      .where(eq(bookMetadata.bookId, bookId));

    await this.replaceAuthors(bookId, data.authors);

    if (data.narrators && data.narrators.length > 0) {
      await this.narratorService.replaceForBook(bookId, data.narrators);
    }

    this.logger.debug(`Audio metadata saved for book ${bookId}: "${data.title}"`);
  }

  private async persistBookMetadata(bookId: number, data: ParsedBookData, format: string): Promise<void> {
    await this.db
      .update(bookMetadata)
      .set({
        title: data.title,
        subtitle: data.subtitle,
        description: data.description,
        isbn10: data.isbn10 ? data.isbn10.replace(/[^0-9Xx]/g, '') : data.isbn10,
        isbn13: data.isbn13 ? data.isbn13.replace(/[^0-9]/g, '') : data.isbn13,
        publisher: data.publisher,
        publishedYear: data.publishedYear,
        language: data.language,
        seriesName: data.seriesName,
        seriesIndex: data.seriesIndex,
        updatedAt: new Date(),
      })
      .where(eq(bookMetadata.bookId, bookId));

    await this.replaceAuthors(bookId, data.authors);
    await this.replaceGenres(bookId, data.genres);

    if (data.pageCount != null) {
      await this.db.update(bookMetadata).set({ pageCount: data.pageCount }).where(eq(bookMetadata.bookId, bookId));
    }

    if (data.comicMetadata) {
      await this.comicMetadataService.upsert(bookId, data.comicMetadata);
    }

    this.logger.debug(`Metadata saved for book ${bookId}: "${data.title}" (${format})`);
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
    const ext = imageExt(bytes);
    const dir = join(this.booksPath, 'covers', String(bookId));
    await mkdir(dir, { recursive: true });

    const files = await readdir(dir).catch(() => [] as string[]);
    const hasCustom = files.some((f) => f.startsWith('cover_custom.'));

    await writeFile(join(dir, `cover_extracted.${ext}`), bytes);

    if (!hasCustom) {
      const thumbnail = await generateThumbnail(bytes);
      await writeFile(join(dir, 'thumbnail.jpg'), thumbnail);
    }

    if (overwrite) {
      await this.db.update(bookMetadata).set({ coverSource: 'extracted', updatedAt: new Date() }).where(eq(bookMetadata.bookId, bookId));
    } else {
      await this.db
        .update(bookMetadata)
        .set({ coverSource: 'extracted' })
        .where(and(eq(bookMetadata.bookId, bookId), isNull(bookMetadata.coverSource)));
    }
  }
}
