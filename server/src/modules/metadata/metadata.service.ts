import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { BookEmbedderService } from '../embedding/book-embedder.service';
import { ComicMetadataService } from '../book/comic-metadata.service';
import { MetadataScoreService } from '../metadata-score/metadata-score.service';
import { NarratorService } from '../narrator/narrator.service';
import { authors, bookAuthors, bookGenres, bookMetadata, bookTags, genres, tags } from '../../db/schema';
import { isAudioFormat } from '@projectx/types';
import { extractAudioMetadata, parseAudioDuration } from './extractors/audio.extractor';
import { extractCb7Metadata, extractCbrMetadata, extractCbzMetadata } from './lib/cbz-metadata';
import { extractAndSaveCover, generateThumbnail, imageExt } from './lib/cover';
import { extractEpubMetadata } from './lib/epub';
import { parseBookFilename } from './lib/filename-parser';
import { parseFb2File } from './lib/fb2-parser';
import { parseMobiFile } from './lib/mobi-parser';
import { parsePdfFile } from './lib/pdf-parser';
import { MetadataEventsService, METADATA_AUTHORS_REPLACED } from './metadata-events.service';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);
  private readonly booksPath: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
    private readonly scoreService: MetadataScoreService,
    private readonly narratorService: NarratorService,
    private readonly comicMetadataService: ComicMetadataService,
    @Optional() private readonly embedder: BookEmbedderService,
    @Optional() private readonly metadataEvents?: MetadataEventsService,
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async extractAndSave(bookId: number, absolutePath: string, format: string): Promise<void> {
    await Promise.all([this.extractMetadata(bookId, absolutePath, format), this.extractCover(bookId, absolutePath, format)]);
    this.scoreService.calculateAndSave(bookId).catch((err: Error) => this.logger.warn(`Score calculation failed for book ${bookId}: ${err.message}`));
  }

  async downloadAndSaveCover(url: string, bookId: number): Promise<boolean> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return false;
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length === 0) return false;

      const ext = imageExt(buffer);
      const dir = join(this.booksPath, 'covers', String(bookId));
      await mkdir(dir, { recursive: true });
      const [thumbnail] = await Promise.all([generateThumbnail(buffer), writeFile(join(dir, `cover_extracted.${ext}`), buffer)]);
      await writeFile(join(dir, 'thumbnail.jpg'), thumbnail);

      await this.db.update(bookMetadata).set({ coverSource: 'extracted', updatedAt: new Date() }).where(eq(bookMetadata.bookId, bookId));

      this.logger.debug(`Online cover saved for book ${bookId}`);
      return true;
    } catch (err) {
      this.logger.warn(`Cover download failed for book ${bookId}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  async saveExtractedCoverBytes(bookId: number, bytes: Buffer): Promise<void> {
    const ext = imageExt(bytes);
    const dir = join(this.booksPath, 'covers', String(bookId));
    await mkdir(dir, { recursive: true });
    const [thumbnail] = await Promise.all([generateThumbnail(bytes), writeFile(join(dir, `cover_extracted.${ext}`), bytes)]);
    await writeFile(join(dir, 'thumbnail.jpg'), thumbnail);
    await this.db.update(bookMetadata).set({ coverSource: 'extracted', updatedAt: new Date() }).where(eq(bookMetadata.bookId, bookId));
  }

  async refreshCoverForBook(bookId: number, absolutePath: string, format: string): Promise<boolean> {
    try {
      const saved = await extractAndSaveCover(absolutePath, format, bookId, this.booksPath);
      if (saved) await this.setCoverSourceIfUnset(bookId, 'extracted');
      return !!saved;
    } catch {
      return false;
    }
  }

  // ── Metadata ─────────────────────────────────────────────────────────────────

  private async extractMetadata(bookId: number, absolutePath: string, format: string): Promise<void> {
    let parsed: {
      title?: string | null;
      subtitle?: string | null;
      description?: string | null;
      isbn10?: string | null;
      isbn13?: string | null;
      publisher?: string | null;
      publishedYear?: number | null;
      language?: string | null;
      seriesName?: string | null;
      seriesIndex?: number | null;
      authors: { name: string; sortName: string | null }[];
      tags: string[];
    } | null = null;

    if (format === 'epub') {
      parsed = await extractEpubMetadata(absolutePath);
    } else if (format === 'cbz') {
      const cbz = await extractCbzMetadata(absolutePath);
      const fb = parseBookFilename(absolutePath);
      parsed = {
        title: cbz?.title ?? fb.title,
        subtitle: null,
        description: cbz?.description ?? null,
        isbn10: null,
        isbn13: null,
        publisher: cbz?.publisher ?? null,
        publishedYear: cbz?.publishedYear ?? fb.publishedYear ?? null,
        language: cbz?.language ?? null,
        seriesName: cbz?.seriesName ?? null,
        seriesIndex: cbz?.seriesIndex ?? null,
        authors: cbz?.authors ?? [],
        tags: cbz?.tags ?? [],
      };
      if (cbz?.comicMetadata) {
        await this.comicMetadataService.upsert(bookId, cbz.comicMetadata);
      }
    } else if (format === 'cbr' || format === 'cb7') {
      const cbx = format === 'cbr' ? await extractCbrMetadata(absolutePath) : await extractCb7Metadata(absolutePath);
      const fb = parseBookFilename(absolutePath);
      parsed = {
        title: cbx?.title ?? fb.title,
        subtitle: null,
        description: cbx?.description ?? null,
        isbn10: null,
        isbn13: null,
        publisher: cbx?.publisher ?? null,
        publishedYear: cbx?.publishedYear ?? fb.publishedYear ?? null,
        language: cbx?.language ?? null,
        seriesName: cbx?.seriesName ?? null,
        seriesIndex: cbx?.seriesIndex ?? null,
        authors: cbx?.authors ?? [],
        tags: cbx?.tags ?? [],
      };
      if (cbx?.comicMetadata) {
        await this.comicMetadataService.upsert(bookId, cbx.comicMetadata);
      }
    } else if (format === 'mobi' || format === 'azw3' || format === 'azw') {
      const mobi = await parseMobiFile(absolutePath);
      if (mobi) {
        const yearMatch = mobi.publishedDate?.match(/\b(\d{4})\b/);
        const year = yearMatch ? Number.parseInt(yearMatch[1], 10) : null;
        parsed = {
          title: mobi.title,
          subtitle: null,
          description: mobi.description,
          isbn10: null,
          isbn13: mobi.isbn,
          publisher: mobi.publisher,
          publishedYear: year,
          language: mobi.language,
          seriesName: null,
          seriesIndex: null,
          authors: mobi.authors.map((name) => ({ name, sortName: null })),
          tags: mobi.tags,
        };
      }
    } else if (format === 'fb2') {
      const fb2 = await parseFb2File(absolutePath);
      if (fb2) {
        parsed = {
          title: fb2.title,
          subtitle: null,
          description: fb2.description,
          isbn10: null,
          isbn13: null,
          publisher: null,
          publishedYear: fb2.publishedYear,
          language: fb2.language,
          seriesName: fb2.seriesName,
          seriesIndex: fb2.seriesIndex,
          authors: fb2.authors,
          tags: fb2.genres,
        };
      }
    } else if (format === 'pdf') {
      const pdf = await parsePdfFile(absolutePath);
      if (pdf) {
        const fb = !pdf.title ? parseBookFilename(absolutePath) : null;
        parsed = {
          title: pdf.title ?? fb?.title ?? null,
          subtitle: pdf.subtitle,
          description: pdf.description,
          isbn10: pdf.isbn10,
          isbn13: pdf.isbn13,
          publisher: pdf.publisher,
          publishedYear: pdf.publishedYear ?? fb?.publishedYear ?? null,
          language: pdf.language,
          seriesName: pdf.seriesName,
          seriesIndex: pdf.seriesIndex,
          authors: pdf.authors,
          tags: pdf.genres, // 'tags' in parsed feeds replaceGenres
        };
        if (pdf.pageCount !== null) {
          await this.db.update(bookMetadata).set({ pageCount: pdf.pageCount }).where(eq(bookMetadata.bookId, bookId));
        }
        if (pdf.coverBuffer) {
          await this.savePdfCover(bookId, pdf.coverBuffer);
        }
      }
    } else if (isAudioFormat(format)) {
      const audio = await extractAudioMetadata(absolutePath);
      await this.db
        .update(bookMetadata)
        .set({
          title: audio.title,
          description: audio.description,
          publisher: audio.publisher,
          publishedYear: audio.publishedYear,
          language: audio.language,
          durationSeconds: audio.durationSeconds,
          chapters: audio.chapters.length > 0 ? audio.chapters : null,
          updatedAt: new Date(),
        })
        .where(eq(bookMetadata.bookId, bookId));

      await this.replaceAuthors(bookId, audio.authors);
      if (audio.narrators.length > 0) {
        await this.narratorService.replaceForBook(bookId, audio.narrators);
      }

      if (audio.coverBytes && audio.coverBytes.length > 0) {
        await this.saveExtractedCoverBytes(bookId, audio.coverBytes);
      }

      this.logger.debug(`Audio metadata saved for book ${bookId}: "${audio.title}"`);
      this.embedder?.embedBook(bookId).catch((err: Error) => this.logger.warn(`Embedding failed for book ${bookId}: ${err.message}`));
      return;
    }

    if (!parsed) return;

    await this.db
      .update(bookMetadata)
      .set({
        title: parsed.title,
        subtitle: parsed.subtitle,
        description: parsed.description,
        isbn10: parsed.isbn10 ? parsed.isbn10.replace(/[^0-9Xx]/g, '') : parsed.isbn10,
        isbn13: parsed.isbn13 ? parsed.isbn13.replace(/[^0-9]/g, '') : parsed.isbn13,
        publisher: parsed.publisher,
        publishedYear: parsed.publishedYear,
        language: parsed.language,
        seriesName: parsed.seriesName,
        seriesIndex: parsed.seriesIndex,
        updatedAt: new Date(),
      })
      .where(eq(bookMetadata.bookId, bookId));

    await this.replaceAuthors(bookId, parsed.authors);
    await this.replaceGenres(bookId, parsed.tags);

    this.logger.debug(`Metadata saved for book ${bookId}: "${parsed.title}"`);
    this.embedder?.embedBook(bookId).catch((err: Error) => this.logger.warn(`Embedding failed for book ${bookId}: ${err.message}`));
  }

  // ── Cover ────────────────────────────────────────────────────────────────────

  private async extractCover(bookId: number, absolutePath: string, format: string): Promise<void> {
    try {
      const saved = await extractAndSaveCover(absolutePath, format, bookId, this.booksPath);
      if (saved) {
        await this.setCoverSourceIfUnset(bookId, 'extracted');
        this.logger.debug(`Cover saved for book ${bookId}: ${saved}`);
      }
    } catch (err) {
      this.logger.warn(`Cover extraction failed for book ${bookId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── PDF cover ────────────────────────────────────────────────────────────────

  private async savePdfCover(bookId: number, jpeg: Buffer): Promise<void> {
    try {
      const dir = join(this.booksPath, 'covers', String(bookId));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'cover_extracted.jpg'), jpeg);
      const thumbnail = await generateThumbnail(jpeg);
      await writeFile(join(dir, 'thumbnail.jpg'), thumbnail);
      await this.setCoverSourceIfUnset(bookId, 'extracted');
      this.logger.debug(`PDF cover saved for book ${bookId}`);
    } catch (err) {
      this.logger.warn(`PDF cover save failed for book ${bookId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async setCoverSourceIfUnset(bookId: number, source: 'extracted'): Promise<void> {
    await this.db
      .update(bookMetadata)
      .set({ coverSource: source })
      .where(and(eq(bookMetadata.bookId, bookId), isNull(bookMetadata.coverSource)));
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
}
