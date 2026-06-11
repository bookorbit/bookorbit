import { Injectable } from '@nestjs/common';

import { KepubContext } from '../../position-converter/kobo-span-converter.service';
import { BookReadService } from '../../book/book-read.service';
import { KepubConversionService } from './kepub-conversion.service';
import { KepubifyBinaryService } from './kepubify-binary.service';
import { KoboSettingsService, type KoboSettings } from './kobo-settings.service';

export interface KepubReaderFile {
  id: number;
  bookId: number;
  absolutePath: string;
  format: string | null;
  fileHash: string | null;
  sizeBytes: number | null;
}

export type KepubContextResult =
  | { ok: true; ctx: KepubContext; file: KepubReaderFile; settings: KoboSettings }
  | { ok: false; reason: string; settings: KoboSettings | null };

/**
 * Resolves the kepub artifact context for a book: the primary reader file, the
 * user's conversion settings, and the cached (or regenerated) kepub path. Every
 * Kobo position conversion goes through this so the codec always sees the same
 * artifact the device downloaded.
 */
@Injectable()
export class KoboKepubContextService {
  constructor(
    private readonly bookReadService: BookReadService,
    private readonly koboSettingsService: KoboSettingsService,
    private readonly kepubConversionService: KepubConversionService,
    private readonly kepubifyBinaryService: KepubifyBinaryService,
  ) {}

  async resolveReaderFile(bookId: number): Promise<KepubReaderFile | null> {
    const [file] = await this.bookReadService.findPrimaryReaderFilesByBookIds([bookId]);
    return file ?? null;
  }

  async resolveForBook(userId: number, bookId: number): Promise<KepubContextResult> {
    const file = await this.resolveReaderFile(bookId);
    if (!file) return { ok: false, reason: 'no_reader_file', settings: null };

    const settings = await this.koboSettingsService.getSettings(userId);
    const readiness = this.getKepubReadinessFailure(file, settings);
    if (readiness) return { ok: false, reason: readiness, settings };

    let kepubPath: string;
    try {
      kepubPath = await this.kepubConversionService.getKepubPath({
        sourcePath: file.absolutePath,
        fileHash: file.fileHash,
        bookId,
        hyphenate: settings.forceEnableHyphenation,
      });
    } catch {
      return { ok: false, reason: 'conversion_failed', settings };
    }

    const kepubifyVersion = await this.kepubifyBinaryService.getVersion();
    return {
      ok: true,
      file,
      settings,
      ctx: { kepubPath, fileHash: file.fileHash, hyphenate: settings.forceEnableHyphenation, kepubifyVersion },
    };
  }

  private getKepubReadinessFailure(file: KepubReaderFile, settings: KoboSettings): string | null {
    if (file.format !== 'epub') return 'kepub_required';
    if (!settings.convertToKepub) return 'kepub_required';
    const limitBytes = settings.kepubConversionLimitMb * 1024 * 1024;
    if (file.sizeBytes && file.sizeBytes > limitBytes) return 'kepub_too_large';
    return null;
  }
}
