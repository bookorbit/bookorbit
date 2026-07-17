import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import type { BookDockMetadata, ComicMetadataFields } from '@bookorbit/types';
import type { ParsedBookData } from '../metadata/extractors/format-extractor.interface';
import { generateThumbnail, imageExt } from '../metadata/lib/cover';
import { MetadataExtractionService } from '../metadata/metadata-extraction.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { BookDockRepository } from './book-dock.repository';

@Injectable()
export class BookDockMetadataService {
  private readonly logger = new Logger(BookDockMetadataService.name);

  constructor(
    private readonly repo: BookDockRepository,
    private readonly extractionService: MetadataExtractionService,
  ) {}

  async extractAndSave(fileId: number, absolutePath: string, format: string, coversDir: string): Promise<void> {
    const startedAt = Date.now();
    await this.repo.update(fileId, { status: 'extracting' });
    try {
      const extracted = await this.extractionService.extractWithCoverFallback(absolutePath, format);
      const metadata = this.toBookDockMetadata(extracted.metadata);
      const coverBytes = extracted.cover;

      let coverPath: string | null = null;
      if (coverBytes && coverBytes.length > 0) {
        coverPath = await this.saveCover(fileId, coverBytes, coversDir);
      }

      await this.repo.update(fileId, {
        embeddedMetadata: metadata,
        coverPath,
        status: 'ready',
      });
    } catch (err) {
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[book_dock.extract_metadata] [fail] fileId=${fileId} format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - metadata extraction failed`,
      );
      await this.repo.update(fileId, {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Metadata extraction failed',
      });
    }
  }

  private async saveCover(fileId: number, bytes: Buffer, coversDir: string): Promise<string> {
    await mkdir(coversDir, { recursive: true });

    const ext = imageExt(bytes);
    const coverPath = join(coversDir, `${fileId}.${ext}`);
    const thumbPath = join(coversDir, `${fileId}_thumb.jpg`);

    const thumbnail = await generateThumbnail(bytes);
    await Promise.all([writeFile(coverPath, bytes), writeFile(thumbPath, thumbnail)]);

    return coverPath;
  }

  private toBookDockMetadata(data: ParsedBookData | null): BookDockMetadata {
    if (!data) return {};
    return {
      title: data.title ?? undefined,
      subtitle: data.subtitle ?? undefined,
      description: data.description ?? undefined,
      publisher: data.publisher ?? undefined,
      publishedDate: data.publishedDate ?? undefined,
      publishedYear: data.publishedYear ?? undefined,
      language: data.language ?? undefined,
      isbn10: data.isbn10 ?? undefined,
      isbn13: data.isbn13 ?? undefined,
      seriesName: data.seriesName ?? undefined,
      seriesIndex: data.seriesIndex ?? undefined,
      pageCount: data.pageCount ?? undefined,
      authors: data.authors.length > 0 ? data.authors.map((a) => a.name) : undefined,
      genres: data.genres.length > 0 ? data.genres : undefined,
      narrators: data.narrators?.length ? data.narrators : undefined,
      durationSeconds: data.durationSeconds ?? undefined,
      chapters: data.chapters?.length ? data.chapters : undefined,
      ...providerIdMetadata(data),
      ...(data.comicMetadata ? { comicMetadata: normalizeBookDockComicMetadata(data.comicMetadata) } : {}),
    };
  }
}

type ProviderIdMetadata = Partial<
  Record<
    | 'googleBooksId'
    | 'goodreadsId'
    | 'amazonId'
    | 'hardcoverId'
    | 'hardcoverEditionId'
    | 'openLibraryId'
    | 'itunesId'
    | 'audibleId'
    | 'librofmId'
    | 'koboId'
    | 'comicvineId'
    | 'ranobedbId'
    | 'lubimyczytacId'
    | 'aladinId',
    string | null
  >
>;

function providerIdMetadata(data: ProviderIdMetadata): Partial<BookDockMetadata> {
  const metadata: Partial<BookDockMetadata> = {};
  const fields = [
    'googleBooksId',
    'goodreadsId',
    'amazonId',
    'hardcoverId',
    'hardcoverEditionId',
    'openLibraryId',
    'itunesId',
    'audibleId',
    'librofmId',
    'koboId',
    'comicvineId',
    'ranobedbId',
    'lubimyczytacId',
    'aladinId',
  ] as const;
  for (const field of fields) {
    const value = data[field];
    if (value) metadata[field] = value;
  }
  return metadata;
}

function normalizeBookDockComicMetadata(
  value: Partial<Record<keyof ComicMetadataFields, string | string[] | null | undefined>>,
): ComicMetadataFields {
  const metadata: ComicMetadataFields = {};
  if (value.issueNumber) metadata.issueNumber = value.issueNumber as string;
  if (value.volumeName) metadata.volumeName = value.volumeName as string;

  const arrayFields = ['pencillers', 'inkers', 'colorists', 'letterers', 'coverArtists', 'characters', 'teams', 'locations', 'storyArcs'] as const;
  for (const field of arrayFields) {
    const entries = value[field];
    if (Array.isArray(entries) && entries.length > 0) metadata[field] = entries;
  }
  return metadata;
}
