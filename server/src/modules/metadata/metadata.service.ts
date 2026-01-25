import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../db';
import * as schema from '../../db/schema';
import { authors, bookAuthors, bookMetadata, bookTags, tags } from '../../db/schema';
import sharp from 'sharp';

import { extractCb7Metadata, extractCbrMetadata, extractCbzMetadata } from './lib/cbz-metadata';
import { extractAndSaveCover } from './lib/cover';
import { extractEpubMetadata } from './lib/epub';
import { parseBookFilename } from './lib/filename-parser';
import { parseMobiFile } from './lib/mobi-parser';
import { parsePdfFile } from './lib/pdf-parser';

type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class MetadataService {
  private readonly logger = new Logger(MetadataService.name);
  private readonly booksPath: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async extractAndSave(bookId: number, absolutePath: string, format: string): Promise<void> {
    await Promise.all([this.extractMetadata(bookId, absolutePath, format), this.extractCover(bookId, absolutePath, format)]);
  }

  async refreshCoverForBook(bookId: number, absolutePath: string, format: string): Promise<boolean> {
    try {
      const saved = await extractAndSaveCover(absolutePath, format, bookId, this.booksPath);
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
      if (cbz) {
        parsed = {
          title: cbz.title,
          subtitle: null,
          description: cbz.description,
          isbn10: null,
          isbn13: null,
          publisher: cbz.publisher,
          publishedYear: cbz.publishedYear,
          language: cbz.language,
          seriesName: cbz.seriesName,
          seriesIndex: cbz.seriesIndex,
          authors: cbz.authors,
          tags: cbz.tags,
        };
      }
    } else if (format === 'cbr' || format === 'cb7') {
      const cbx = format === 'cbr' ? await extractCbrMetadata(absolutePath) : await extractCb7Metadata(absolutePath);
      if (cbx) {
        parsed = {
          title: cbx.title,
          subtitle: null,
          description: cbx.description,
          isbn10: null,
          isbn13: null,
          publisher: cbx.publisher,
          publishedYear: cbx.publishedYear,
          language: cbx.language,
          seriesName: cbx.seriesName,
          seriesIndex: cbx.seriesIndex,
          authors: cbx.authors,
          tags: cbx.tags,
        };
      }
    } else if (format === 'mobi' || format === 'azw3' || format === 'azw') {
      const mobi = await parseMobiFile(absolutePath);
      if (mobi) {
        const year = mobi.publishedDate ? parseInt(mobi.publishedDate.substring(0, 4), 10) || null : null;
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
    } else if (format === 'pdf') {
      const pdf = await parsePdfFile(absolutePath);
      if (pdf) {
        const fb = !pdf.title ? parseBookFilename(absolutePath) : null;
        parsed = {
          title: pdf.title ?? fb?.title ?? null,
          subtitle: null,
          description: pdf.subject,
          isbn10: null,
          isbn13: null,
          publisher: null,
          publishedYear: fb?.publishedYear ?? null,
          language: null,
          seriesName: null,
          seriesIndex: null,
          authors: pdf.authors,
          tags: pdf.keywords,
        };
        if (pdf.pageCount !== null) {
          await this.db.update(bookMetadata).set({ pageCount: pdf.pageCount }).where(eq(bookMetadata.bookId, bookId));
        }
        if (pdf.coverBuffer) {
          await this.savePdfCover(bookId, pdf.coverBuffer);
        }
      }
    }

    if (!parsed) return;

    await this.db
      .update(bookMetadata)
      .set({
        title: parsed.title,
        subtitle: parsed.subtitle,
        description: parsed.description,
        isbn10: parsed.isbn10,
        isbn13: parsed.isbn13,
        publisher: parsed.publisher,
        publishedYear: parsed.publishedYear,
        language: parsed.language,
        seriesName: parsed.seriesName,
        seriesIndex: parsed.seriesIndex,
        updatedAt: new Date(),
      })
      .where(eq(bookMetadata.bookId, bookId));

    await this.saveAuthors(bookId, parsed.authors);
    await this.saveTags(bookId, parsed.tags);

    this.logger.debug(`Metadata saved for book ${bookId}: "${parsed.title}"`);
  }

  // ── Cover ────────────────────────────────────────────────────────────────────

  private async extractCover(bookId: number, absolutePath: string, format: string): Promise<void> {
    try {
      const saved = await extractAndSaveCover(absolutePath, format, bookId, this.booksPath);
      if (saved) {
        this.logger.debug(`Cover saved for book ${bookId}: ${saved}`);
      }
    } catch (err) {
      this.logger.warn(`Cover extraction failed for book ${bookId}: ${err}`);
    }
  }

  // ── PDF cover ────────────────────────────────────────────────────────────────

  private async savePdfCover(bookId: number, jpeg: Buffer): Promise<void> {
    try {
      const { mkdir, writeFile } = await import('fs/promises');
      const { join } = await import('path');
      const dir = join(this.booksPath, 'covers', String(bookId));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'cover.jpg'), jpeg);
      const thumbnail = await sharp(jpeg).resize(400, 600, { fit: 'cover', position: 'top' }).jpeg({ quality: 90 }).toBuffer();
      await writeFile(join(dir, 'thumbnail.jpg'), thumbnail);
      this.logger.debug(`PDF cover saved for book ${bookId}`);
    } catch (err) {
      this.logger.warn(`PDF cover save failed for book ${bookId}: ${err}`);
    }
  }

  // ── Authors ──────────────────────────────────────────────────────────────────

  private async saveAuthors(bookId: number, parsedAuthors: { name: string; sortName: string | null }[]) {
    if (parsedAuthors.length === 0) return;

    // Deduplicate by name to avoid inserting the same author twice for one book
    const unique = parsedAuthors.filter((a, i, arr) => arr.findIndex((b) => b.name === a.name) === i);

    await this.db.delete(bookAuthors).where(eq(bookAuthors.bookId, bookId));

    for (let i = 0; i < unique.length; i++) {
      const { name, sortName } = unique[i]!;

      let [author] = await this.db.select().from(authors).where(eq(authors.name, name)).limit(1);

      if (!author) {
        [author] = await this.db.insert(authors).values({ name, sortName }).returning();
      }

      await this.db.insert(bookAuthors).values({ bookId, authorId: author!.id, displayOrder: i }).onConflictDoNothing();
    }
  }

  // ── Tags ─────────────────────────────────────────────────────────────────────

  private async saveTags(bookId: number, parsedTags: string[]) {
    await this.db.delete(bookTags).where(eq(bookTags.bookId, bookId));
    const uniqueTags = [...new Set(parsedTags.map((t) => t.substring(0, 200)).filter(Boolean))];
    if (uniqueTags.length === 0) return;

    for (const rawName of uniqueTags) {
      const name = rawName;
      let [tag] = await this.db.select().from(tags).where(eq(tags.name, name)).limit(1);

      if (!tag) {
        [tag] = await this.db.insert(tags).values({ name }).returning();
      }

      await this.db.insert(bookTags).values({ bookId, tagId: tag!.id }).onConflictDoNothing();
    }
  }
}
