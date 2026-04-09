import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { basename, extname, join } from 'path';
import { stat } from 'fs/promises';
import { Readable } from 'stream';

import type { BookBucketMetadata } from '@projectx/types';
import { SUPPORTED_BOOK_FORMATS, UploadValidatorService } from '../upload/upload-validator.service';
import { UploadStorageService } from '../upload/upload-storage.service';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { MetadataFetchPipeline } from '../metadata-fetch/metadata-fetch-pipeline';
import { BookBucketRepository } from './book-bucket.repository';
import { BookBucketMetadataService } from './book-bucket-metadata.service';
import { BookBucketEventsService, BOOK_BUCKET_FILE_INGESTED } from './book-bucket-events.service';
import { BookBucketGateway } from './book-bucket.gateway';

@Injectable()
export class BookBucketIngestService {
  private readonly logger = new Logger(BookBucketIngestService.name);
  private readonly bookBucketPath: string;

  constructor(
    private readonly config: ConfigService,
    private readonly repo: BookBucketRepository,
    private readonly validator: UploadValidatorService,
    private readonly storage: UploadStorageService,
    private readonly metadataService: BookBucketMetadataService,
    private readonly events: BookBucketEventsService,
    private readonly appSettings: AppSettingsService,
    private readonly metadataFetchPipeline: MetadataFetchPipeline,
    private readonly gateway: BookBucketGateway,
  ) {
    const appDataPath = this.config.get<string>('storage.appDataPath')!;
    this.bookBucketPath = join(appDataPath, 'book-bucket');
  }

  async ingestUpload(rawFilename: string, fileStream: Readable): Promise<number> {
    const filename = this.validator.sanitizeFilename(rawFilename);
    const ext = extname(filename).toLowerCase().slice(1);

    if (!SUPPORTED_BOOK_FORMATS.has(ext)) {
      throw new BadRequestException(`Unsupported file type .${ext}. Allowed types: ${[...SUPPORTED_BOOK_FORMATS].join(', ')}`);
    }

    const { tempPath, sizeBytes } = await this.storage.streamToTemp(fileStream);
    let destPath: string | null = null;

    try {
      destPath = await this.resolveUniquePath(join(this.bookBucketPath, filename));

      await this.storage.moveToPath(tempPath, destPath);

      const row = await this.repo.create({
        fileName: basename(destPath),
        absolutePath: destPath,
        fileSize: sizeBytes,
        format: ext,
        status: 'pending',
      });

      this.extractMetadataAsync(row.id, destPath, ext);

      return row.id;
    } catch (err) {
      await Promise.allSettled([this.storage.cleanup(tempPath), destPath ? this.storage.cleanup(destPath) : Promise.resolve()]);
      throw err;
    }
  }

  async retryFetch(fileId: number): Promise<void> {
    const row = await this.repo.findById(fileId);
    if (!row || row.status !== 'error' || !row.format) return;
    await this.repo.update(fileId, { status: 'pending', errorMessage: null });
    this.extractMetadataAsync(fileId, row.absolutePath, row.format);
  }

  async ingestFromWatchedFolder(absolutePath: string): Promise<number | null> {
    const existing = await this.repo.findByAbsolutePath(absolutePath);
    if (existing) return null;

    const ext = extname(absolutePath).toLowerCase().slice(1);
    if (!SUPPORTED_BOOK_FORMATS.has(ext)) return null;

    let fileSize: number;
    try {
      const s = await stat(absolutePath);
      fileSize = s.size;
    } catch {
      return null;
    }

    const row = await this.repo.create({
      fileName: basename(absolutePath),
      absolutePath,
      fileSize,
      format: ext,
      status: 'pending',
    });

    this.extractMetadataAsync(row.id, absolutePath, ext);

    return row.id;
  }

  private extractMetadataAsync(fileId: number, absolutePath: string, format: string): void {
    const coversDir = join(this.bookBucketPath, 'covers');
    this.metadataService
      .extractAndSave(fileId, absolutePath, format, coversDir)
      .then(() => this.autoFetchMetadataAsync(fileId))
      .then(() => this.emitSummary())
      .then(() => this.events.emit(BOOK_BUCKET_FILE_INGESTED, fileId))
      .catch((err: Error) => this.logger.warn(`Background metadata extraction failed for Book Bucket file ${fileId}: ${err.message}`));
  }

  private async autoFetchMetadataAsync(fileId: number): Promise<void> {
    const enabled = await this.appSettings.isBookBucketAutoFetchEnabled();
    if (!enabled) return;

    const row = await this.repo.findById(fileId);
    if (!row || row.status === 'error') return;

    const meta = row.embeddedMetadata;
    const params = {
      title: meta?.title ?? undefined,
      author: meta?.authors?.[0] ?? undefined,
      isbn: meta?.isbn13 ?? meta?.isbn10 ?? undefined,
    };
    if (!params.title && !params.isbn) return;

    await this.repo.update(fileId, { status: 'fetching' });
    try {
      const { resolved, sources } = await this.metadataFetchPipeline.runWithSources(params, {});
      const fetched: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(resolved)) {
        if (value === undefined) continue;
        fetched[field] = value;
      }
      const updates =
        Object.keys(fetched).length > 0
          ? {
              status: 'ready' as const,
              fetchedMetadata: fetched,
              confidence: computeConfidence(row.embeddedMetadata ?? {}, fetched as BookBucketMetadata),
              fetchedMetadataSources: sources,
            }
          : { status: 'ready' as const };
      await this.repo.update(fileId, updates);
    } catch (err) {
      this.logger.warn(`Auto-fetch metadata failed for Book Bucket file ${fileId}: ${err instanceof Error ? err.message : String(err)}`);
      await this.repo.update(fileId, { status: 'ready' });
    }
  }

  private async resolveUniquePath(desiredPath: string): Promise<string> {
    const exists = await stat(desiredPath)
      .then(() => true)
      .catch(() => false);
    if (!exists) return desiredPath;

    const ext = extname(desiredPath);
    const stem = basename(desiredPath, ext);
    const dir = desiredPath.substring(0, desiredPath.length - basename(desiredPath).length);
    const uniqueName = `${stem}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
    return join(dir, uniqueName);
  }

  private async emitSummary(): Promise<void> {
    const summary = await this.repo.countsByStatus();
    this.gateway.emitSummary(summary);
  }
}

const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'to', 'for', 'by', 'at', 'on', 'is', 'it']);

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((t) => b.has(t)).length;
  return intersection / (a.size + b.size - intersection);
}

function titleSimilarity(a: string, b: string): number {
  // Strip subtitles (after ': ' or ' - ') before comparing
  const strip = (s: string) => s.split(/:\s+|-\s+/)[0].trim();
  return jaccard(tokenize(strip(a)), tokenize(strip(b)));
}

function normalizeAuthorName(name: string): string {
  // Normalize "Last, First" → "first last"
  const comma = name.indexOf(',');
  if (comma > 0) {
    const last = name.slice(0, comma).trim();
    const first = name.slice(comma + 1).trim();
    return `${first} ${last}`.toLowerCase();
  }
  return name.toLowerCase();
}

function authorSimilarity(embAuthors: string[], fetchAuthors: string[]): number {
  let best = 0;
  for (const ea of embAuthors) {
    const tokA = new Set(
      normalizeAuthorName(ea)
        .replace(/[^a-z\s]/g, '')
        .split(/\s+/)
        .filter((t) => t.length > 1),
    );
    for (const fa of fetchAuthors) {
      const tokB = new Set(
        normalizeAuthorName(fa)
          .replace(/[^a-z\s]/g, '')
          .split(/\s+/)
          .filter((t) => t.length > 1),
      );
      best = Math.max(best, jaccard(tokA, tokB));
    }
  }
  return best;
}

function computeConfidence(embedded: BookBucketMetadata, fetched: BookBucketMetadata): number {
  // ISBN exact match — definitive
  if (embedded.isbn13 && fetched.isbn13 && embedded.isbn13 === fetched.isbn13) return 95;
  if (embedded.isbn10 && fetched.isbn10 && embedded.isbn10 === fetched.isbn10) return 90;

  // Conflicting ISBNs — almost certainly wrong book
  const embIsbn = embedded.isbn13 ?? embedded.isbn10;
  const fetchIsbn = fetched.isbn13 ?? fetched.isbn10;
  if (embIsbn && fetchIsbn && embIsbn !== fetchIsbn) return 10;

  let score = 0;

  // Title: up to 55 points
  if (embedded.title && fetched.title) {
    score += Math.round(titleSimilarity(embedded.title, fetched.title) * 55);
  }

  // Authors: up to 30 points
  if (embedded.authors?.length && fetched.authors?.length) {
    score += Math.round(authorSimilarity(embedded.authors, fetched.authors) * 30);
  }

  // Published year: up to 10 points
  if (embedded.publishedYear && fetched.publishedYear) {
    if (embedded.publishedYear === fetched.publishedYear) score += 10;
  }

  // Series: up to 5 points
  if (embedded.seriesName && fetched.seriesName) {
    if (jaccard(tokenize(embedded.seriesName), tokenize(fetched.seriesName)) >= 0.5) score += 5;
  }

  return Math.min(score, 100);
}
