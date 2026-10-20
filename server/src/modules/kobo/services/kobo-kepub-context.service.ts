import { Injectable, Logger, Optional } from '@nestjs/common';

import { KoboDeliveryService, isSettledDelivery, isUnconfirmedReplacement, type KoboDeliveryRecord } from './kobo-delivery.service';
import { DeliveryArtifactService } from '../../book/delivery-artifact.service';
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
  mediaOverlayAvailable?: boolean;
}

export type KepubContextResult =
  | { ok: true; ctx: KepubContext; file: KepubReaderFile; settings: KoboSettings; release?: () => Promise<void> }
  | { ok: false; reason: string; settings: KoboSettings | null };

/**
 * Resolves the kepub artifact context for a book: the primary reader file, the
 * user's conversion settings, and the cached (or regenerated) kepub path. Every
 * Kobo position conversion goes through this so the codec always sees the same
 * artifact the device downloaded.
 */
@Injectable()
export class KoboKepubContextService {
  private readonly logger = new Logger(KoboKepubContextService.name);

  constructor(
    private readonly bookReadService: BookReadService,
    private readonly koboSettingsService: KoboSettingsService,
    private readonly kepubConversionService: KepubConversionService,
    private readonly kepubifyBinaryService: KepubifyBinaryService,
    @Optional() private readonly deliveries?: KoboDeliveryService,
    @Optional() private readonly artifacts?: DeliveryArtifactService,
  ) {}

  async resolveReaderFile(bookId: number): Promise<KepubReaderFile | null> {
    const [file] = await this.bookReadService.findPrimaryReaderFilesByBookIds([bookId]);
    return file ?? null;
  }

  async resolveForDelivery(userId: number, bookId: number, deviceId: number, deliveryId: string): Promise<KepubContextResult> {
    const settings = await this.koboSettingsService.getSettings(userId);
    const record = await this.deliveries?.byId(userId, deviceId, deliveryId);
    if (!record || record.bookId !== bookId || record.metadata.format !== 'kepub')
      return { ok: false, reason: 'historical_artifact_unavailable', settings };
    try {
      const artifact = await this.deliveries!.resolve(userId, deviceId, record);
      const file = await this.resolveReaderFile(bookId);
      if (!file || file.id !== record.sourceFileId) {
        await artifact.release();
        return { ok: false, reason: 'historical_source_unavailable', settings };
      }
      const ctx = {
        kepubPath: artifact.path,
        fileHash: artifact.sha256,
        hyphenate: record.options.hyphenate,
        kepubifyVersion: record.options.converterVersion ?? 'native-kepub',
      };
      return { ok: true, file, settings, ctx, release: artifact.release };
    } catch {
      return { ok: false, reason: 'historical_artifact_unavailable', settings };
    }
  }

  /**
   * `followDeliverySource` resolves a device whose copy was built from a file that is no longer the
   * book's primary against that file, for callers that keep the device's progress on it. Without it such
   * a copy is unavailable, since its positions do not belong to the primary file.
   *
   * `outgoing` also resolves a book's first delivery before the device has downloaded it, for a bookmark
   * sent to the device: it downloads exactly those bytes, so a location in them is where the book opens.
   * Positions coming from the device are not trusted until the transfer is observed.
   */
  async resolveForBook(
    userId: number,
    bookId: number,
    deviceId?: number,
    options: { followDeliverySource?: boolean; outgoing?: boolean } = {},
  ): Promise<KepubContextResult> {
    if (deviceId && this.deliveries) {
      const settings = await this.koboSettingsService.getSettings(userId);
      const record = await this.deliveries.current(userId, deviceId, bookId);
      if (record && record.state === 'prepared' && record.previousId) return this.resolveForDelivery(userId, bookId, deviceId, record.previousId);
      const firstOffer = Boolean(options.outgoing && record?.state === 'offered' && !isUnconfirmedReplacement(record));
      if (!record || (!firstOffer && ['offered', 'prepared', 'cancelled'].includes(record.state)))
        return { ok: false, reason: 'unknown_delivery', settings };
      if (!firstOffer && !isSettledDelivery(record)) return { ok: false, reason: 'replacement_events_ambiguous', settings };
      if (record.metadata.format !== 'kepub') return { ok: false, reason: 'kepub_required', settings };
      try {
        const artifact = await this.deliveries.resolve(userId, deviceId, record);
        const primary = await this.resolveReaderFile(bookId);
        const source = primary?.id !== record.sourceFileId && options.followDeliverySource ? await this.deliveries.findSourceFile(record) : null;
        const file: KepubReaderFile | null =
          primary && primary.id === record.sourceFileId
            ? primary
            : source
              ? {
                  id: source.id,
                  bookId: source.bookId,
                  absolutePath: source.absolutePath,
                  format: source.format,
                  fileHash: source.fileHash,
                  sizeBytes: source.sizeBytes,
                  mediaOverlayAvailable: source.mediaOverlayAvailable,
                }
              : null;
        if (!file) {
          await artifact.release();
          return { ok: false, reason: 'historical_source_unavailable', settings };
        }
        const ctx = {
          kepubPath: artifact.path,
          fileHash: artifact.sha256,
          hyphenate: record.options.hyphenate,
          kepubifyVersion: record.options.converterVersion ?? 'native-kepub',
        };
        return { ok: true, file, settings, ctx, release: artifact.release };
      } catch {
        return (await this.cachedDeliveredContext(bookId, record, settings)) ?? { ok: false, reason: 'historical_artifact_unavailable', settings };
      }
    }
    const file = await this.resolveReaderFile(bookId);
    if (!file) return { ok: false, reason: 'no_reader_file', settings: null };

    const settings = await this.koboSettingsService.getSettings(userId);
    if (file.format === 'kepub') {
      return {
        ok: true,
        file,
        settings,
        ctx: { kepubPath: file.absolutePath, fileHash: file.fileHash, hyphenate: false, kepubifyVersion: 'native-kepub' },
      };
    }
    const prepared =
      file.format === 'epub' && file.mediaOverlayAvailable && this.artifacts
        ? await this.artifacts.prepare(file, settings.readAloudDelivery ?? null)
        : null;
    const selected = prepared ? { ...file, absolutePath: prepared.path, sizeBytes: prepared.sizeBytes, fileHash: prepared.sha256 } : file;
    const readiness =
      settings.readAloudDelivery === 'original' && file.mediaOverlayAvailable ? 'kepub_required' : this.getKepubReadinessFailure(selected, settings);
    if (readiness) {
      await prepared?.release();
      return { ok: false, reason: readiness, settings };
    }

    let kepubPath: string;
    try {
      kepubPath = await this.kepubConversionService.getKepubPath({
        sourcePath: selected.absolutePath,
        fileHash: selected.fileHash,
        ...(prepared ? { audioless: prepared.actualVariant === 'audioless_epub', sourceRevision: prepared.sha256 } : {}),
        bookId,
        hyphenate: settings.forceEnableHyphenation,
      });
    } catch {
      return { ok: false, reason: 'conversion_failed', settings };
    } finally {
      await prepared?.release();
    }

    const kepubifyVersion = await this.kepubifyBinaryService.getVersion();
    return {
      ok: true,
      file,
      settings,
      ctx: { kepubPath, fileHash: selected.fileHash, hyphenate: settings.forceEnableHyphenation, kepubifyVersion },
    };
  }

  private getKepubReadinessFailure(file: KepubReaderFile, settings: KoboSettings): string | null {
    if (file.format !== 'epub') return 'kepub_required';
    if (!settings.convertToKepub) return 'kepub_required';
    const limitBytes = settings.kepubConversionLimitMb * 1024 * 1024;
    if (file.sizeBytes && file.sizeBytes > limitBytes) return 'kepub_too_large';
    return null;
  }

  /**
   * After the book file changes, the device still holds the KEPUB it downloaded. While that exact
   * conversion is cached, positions keep resolving against it instead of the book losing precise sync.
   */
  private async cachedDeliveredContext(bookId: number, record: KoboDeliveryRecord, settings: KoboSettings): Promise<KepubContextResult | null> {
    if (record.metadata.format !== 'kepub' || !record.metadata.sha256) return null;
    const file = await this.resolveReaderFile(bookId);
    if (!file || file.id !== record.sourceFileId) return null;
    const cached = await this.kepubConversionService.acquireCachedByDigest(bookId, record.metadata.sha256);
    if (!cached) return null;
    await this.deliveries?.rememberContentDigest(record, cached.path);
    this.logger.log(
      `[kobo.kepub_context] [end] bookId=${bookId} deliveryId=${record.id} source=cached_delivered_artifact - source changed after delivery; using the copy the device holds`,
    );
    const ctx = {
      kepubPath: cached.path,
      fileHash: record.metadata.sha256,
      hyphenate: record.options.hyphenate,
      kepubifyVersion: record.options.converterVersion ?? 'native-kepub',
    };
    return { ok: true, file, settings, ctx, release: cached.release };
  }
}
