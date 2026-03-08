import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

import type { StagingMetadata } from '@projectx/types';
import { extractEpubMetadata } from '../metadata/lib/epub';
import { extractCbzMetadata, extractCbrMetadata, extractCb7Metadata } from '../metadata/lib/cbz-metadata';
import { parseFb2File } from '../metadata/lib/fb2-parser';
import { parseMobiFile } from '../metadata/lib/mobi-parser';
import { parsePdfFile } from '../metadata/lib/pdf-parser';
import { extractCover, generateThumbnail, imageExt } from '../metadata/lib/cover';
import { StagingRepository } from './staging.repository';

@Injectable()
export class StagingMetadataService {
  private readonly logger = new Logger(StagingMetadataService.name);

  constructor(private readonly repo: StagingRepository) {}

  async extractAndSave(fileId: number, absolutePath: string, format: string, coversDir: string): Promise<void> {
    await this.repo.update(fileId, { status: 'extracting' });
    try {
      const [metadata, coverBytes] = await Promise.all([this.extractMetadata(absolutePath, format), extractCover(absolutePath, format)]);

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
      this.logger.warn(`Metadata extraction failed for staging file ${fileId}: ${err instanceof Error ? err.message : String(err)}`);
      await this.repo.update(fileId, {
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Metadata extraction failed',
      });
    }
  }

  private async extractMetadata(absolutePath: string, format: string): Promise<StagingMetadata> {
    switch (format) {
      case 'epub':
        return this.fromEpub(absolutePath);
      case 'pdf':
        return this.fromPdf(absolutePath);
      case 'mobi':
      case 'azw3':
      case 'azw':
        return this.fromMobi(absolutePath);
      case 'cbz':
        return this.fromCbx(absolutePath, 'cbz');
      case 'cbr':
        return this.fromCbx(absolutePath, 'cbr');
      case 'cb7':
        return this.fromCbx(absolutePath, 'cb7');
      case 'fb2':
        return this.fromFb2(absolutePath);
      default:
        return {};
    }
  }

  private async fromEpub(absolutePath: string): Promise<StagingMetadata> {
    const parsed = await extractEpubMetadata(absolutePath);
    if (!parsed) return {};
    return {
      title: parsed.title ?? undefined,
      subtitle: parsed.subtitle ?? undefined,
      description: parsed.description ?? undefined,
      publisher: parsed.publisher ?? undefined,
      publishedYear: parsed.publishedYear ?? undefined,
      language: parsed.language ?? undefined,
      isbn10: parsed.isbn10 ?? undefined,
      isbn13: parsed.isbn13 ?? undefined,
      seriesName: parsed.seriesName ?? undefined,
      seriesIndex: parsed.seriesIndex ?? undefined,
      authors: parsed.authors.length > 0 ? parsed.authors.map((a) => a.name) : undefined,
      genres: parsed.tags.length > 0 ? parsed.tags : undefined,
    };
  }

  private async fromPdf(absolutePath: string): Promise<StagingMetadata> {
    const parsed = await parsePdfFile(absolutePath);
    if (!parsed) return {};
    return {
      title: parsed.title ?? undefined,
      publisher: parsed.publisher ?? undefined,
      pageCount: parsed.pageCount ?? undefined,
      authors: parsed.authors.length > 0 ? parsed.authors.map((a) => a.name) : undefined,
      genres: parsed.genres.length > 0 ? parsed.genres : undefined,
    };
  }

  private async fromMobi(absolutePath: string): Promise<StagingMetadata> {
    const parsed = await parseMobiFile(absolutePath);
    if (!parsed) return {};
    const year = parsed.publishedDate ? parseInt(parsed.publishedDate.substring(0, 4), 10) || undefined : undefined;
    return {
      title: parsed.title ?? undefined,
      description: parsed.description ?? undefined,
      publisher: parsed.publisher ?? undefined,
      publishedYear: year,
      language: parsed.language ?? undefined,
      isbn13: parsed.isbn ?? undefined,
      authors: parsed.authors.length > 0 ? parsed.authors : undefined,
      genres: parsed.tags.length > 0 ? parsed.tags : undefined,
    };
  }

  private async fromCbx(absolutePath: string, format: 'cbz' | 'cbr' | 'cb7'): Promise<StagingMetadata> {
    const extractor = format === 'cbz' ? extractCbzMetadata : format === 'cbr' ? extractCbrMetadata : extractCb7Metadata;
    const parsed = await extractor(absolutePath);
    if (!parsed) return {};
    return {
      title: parsed.title ?? undefined,
      description: parsed.description ?? undefined,
      publisher: parsed.publisher ?? undefined,
      publishedYear: parsed.publishedYear ?? undefined,
      language: parsed.language ?? undefined,
      seriesName: parsed.seriesName ?? undefined,
      seriesIndex: parsed.seriesIndex ?? undefined,
      authors: parsed.authors.length > 0 ? parsed.authors.map((a) => a.name) : undefined,
      genres: parsed.tags.length > 0 ? parsed.tags : undefined,
    };
  }

  private async fromFb2(absolutePath: string): Promise<StagingMetadata> {
    const parsed = await parseFb2File(absolutePath);
    if (!parsed) return {};
    return {
      title: parsed.title ?? undefined,
      description: parsed.description ?? undefined,
      publishedYear: parsed.publishedYear ?? undefined,
      language: parsed.language ?? undefined,
      seriesName: parsed.seriesName ?? undefined,
      seriesIndex: parsed.seriesIndex ?? undefined,
      authors: parsed.authors.length > 0 ? parsed.authors.map((a) => a.name) : undefined,
      genres: parsed.genres.length > 0 ? parsed.genres : undefined,
    };
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
}
