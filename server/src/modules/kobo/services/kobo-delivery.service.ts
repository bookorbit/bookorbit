import { createHash } from 'crypto';
import { open } from 'fs/promises';
import { ConflictException, HttpException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import type { ReadAloudDeliveryPreference } from '@bookorbit/types';
import { DeliveryArtifactService, type DeliveryArtifact } from '../../book/delivery-artifact.service';
import { KoboDeliveryRepository } from '../kobo-delivery.repository';
import { KoboDownloadRepository } from '../kobo-download.repository';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KoboSettingsService } from './kobo-settings.service';
import { KepubConversionService } from './kepub-conversion.service';
import { KepubifyBinaryService } from './kepubify-binary.service';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { computeFileHashFromHandle } from '../../../common/utils/file-hash.utils';
import { kepubContentDigest } from './kepub-content-digest';

export type KoboDeliveryRecord = NonNullable<Awaited<ReturnType<KoboDeliveryRepository['findCurrent']>>>;

/** Failures meaning the source can no longer rebuild an offer's bytes, as opposed to the book being unreadable. */
const STALE_DELIVERY_CODES = new Set(['DELIVERY_SOURCE_CHANGED', 'DELIVERY_ARTIFACT_UNAVAILABLE']);

type DeliveryStanding = Pick<KoboDeliveryRecord, 'state' | 'previousId' | 'options'>;

/**
 * A replacement leaves the device's old copy in doubt until the user confirms they removed it and
 * downloaded the new one, since a completed transfer does not prove the device switched copies.
 */
export function isUnconfirmedReplacement(delivery: DeliveryStanding): boolean {
  return (Boolean(delivery.previousId) || delivery.options.replacement === true) && delivery.state !== 'user_confirmed';
}

/** Whether the device is known to hold this delivery's bytes, so the positions it reports can be trusted. */
export function isSettledDelivery(delivery: DeliveryStanding): boolean {
  return delivery.state === 'user_confirmed' || (delivery.state === 'transfer_observed' && !isUnconfirmedReplacement(delivery));
}

export function deliveryErrorCode(error: unknown): string | null {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  return typeof response === 'object' && response !== null && 'code' in response && typeof response.code === 'string' ? response.code : null;
}

@Injectable()
export class KoboDeliveryService {
  private readonly logger = new Logger(KoboDeliveryService.name);
  constructor(
    private readonly repository: KoboDeliveryRepository,
    private readonly downloads: KoboDownloadRepository,
    private readonly access: KoboBookAccessService,
    private readonly settings: KoboSettingsService,
    private readonly artifacts: DeliveryArtifactService,
    private readonly conversion: KepubConversionService,
    private readonly binary: KepubifyBinaryService,
  ) {}

  async current(userId: number, deviceId: number, bookId: number) {
    await this.repository.assertDevice(userId, deviceId);
    await this.access.assertBookAccessible(userId, bookId);
    return (await this.repository.findCurrent(userId, deviceId, bookId)) ?? null;
  }

  async offer(userId: number, deviceId: number, bookId: number, replacementVariant?: ReadAloudDeliveryPreference): Promise<KoboDeliveryRecord> {
    const startedAt = Date.now();
    const current = await this.current(userId, deviceId, bookId);
    if (current && replacementVariant === undefined) {
      if (!['prepared', 'cancelled'].includes(current.state)) return current;
      const previous = current.previousId ? await this.repository.findById(userId, deviceId, current.previousId) : null;
      if (previous) return previous;
      // A replacement prepared before this device ever received the book has no copy to stand back
      // for, so it stops standing for the book and the book gets an ordinary first offer.
      await this.repository.retire(userId, deviceId, current.id);
    }
    const book = await this.downloads.findBook(bookId);
    if (!book) throw new NotFoundException();
    const file = await this.downloads.findPrimaryFile(bookId, book.primaryFileId ?? -1);
    if (!file) throw new NotFoundException();
    const settings = await this.settings.getSettings(userId);
    const policy = replacementVariant === undefined ? (settings.readAloudDelivery ?? null) : replacementVariant;
    const artifact = await this.artifacts.prepare(
      {
        id: file.id,
        absolutePath: file.absolutePath,
        format: file.format,
        mediaOverlayAvailable: file.mediaOverlayAvailable,
        mtime: file.mtime,
        sizeBytes: file.sizeBytes,
        ino: file.ino,
      },
      policy,
    );
    let converterVersion: string | null = null;
    let contentDigest: string | undefined;
    let conversionRelease: (() => Promise<void>) | undefined;
    try {
      if (file.format === 'kepub') artifact.format = 'kepub';
      else if (
        file.format === 'epub' &&
        settings.convertToKepub &&
        (policy !== 'original' || !file.mediaOverlayAvailable) &&
        artifact.sizeBytes <= settings.kepubConversionLimitMb * 1024 * 1024
      ) {
        try {
          converterVersion = await this.binary.getVersion();
          const converted = await this.conversion.acquireKepub({
            sourcePath: artifact.path,
            fileHash: artifact.sha256,
            sourceRevision: artifact.sha256,
            bookId,
            hyphenate: settings.forceEnableHyphenation,
            audioless: artifact.actualVariant === 'audioless_epub',
          });
          conversionRelease = converted.release;
          const handle = await open(converted.path, 'r');
          try {
            const hash = createHash('sha256');
            for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
            artifact.sha256 = hash.digest('hex');
            artifact.fileHash = await computeFileHashFromHandle(handle);
            artifact.sizeBytes = (await handle.stat()).size;
            artifact.format = 'kepub';
            artifact.artifactId = artifact.sha256;
          } finally {
            await handle.close();
          }
          contentDigest = await kepubContentDigest(converted.path);
        } catch (error) {
          converterVersion = null;
          contentDigest = undefined;
          this.logger.warn(
            `[kobo.delivery] [fail] userId=${userId} deviceId=${deviceId} bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - conversion failed, offering prepared EPUB`,
          );
        }
      }
      const { path: artifactPath, release: artifactRelease, ...metadata } = artifact;
      void artifactPath;
      void artifactRelease;
      return this.repository.offer(
        {
          userId,
          deviceId,
          bookId,
          sourceFileId: file.id,
          metadata,
          options: {
            hyphenate: settings.forceEnableHyphenation,
            converterVersion,
            replacement: replacementVariant !== undefined,
            ...(contentDigest ? { kepubContentDigest: contentDigest } : {}),
          },
          state: replacementVariant === undefined ? 'offered' : 'prepared',
        },
        replacementVariant !== undefined,
      );
    } finally {
      await conversionRelease?.();
      await artifact.release();
    }
  }

  /**
   * The bytes a device download is served from. A download asks for the book now, so an offer whose source
   * can no longer rebuild it, because the file changed after it was offered or stopped being the book's
   * primary, is replaced by a fresh offer of the current primary instead of serving a stale copy or failing
   * that book on every attempt. Pending replacements keep their guided flow.
   */
  async prepareDownload(
    userId: number,
    deviceId: number,
    bookId: number,
    deliveryId?: string,
  ): Promise<{ record: KoboDeliveryRecord; artifact: DeliveryArtifact }> {
    const record = await this.offer(userId, deviceId, bookId);
    if (deliveryId && record.id !== deliveryId) throw new NotFoundException('Delivery offer is no longer current');
    const replaceable = record.current && !record.options.replacement;
    let reason: string | null = null;
    if (replaceable) {
      const book = await this.downloads.findBook(bookId);
      if (book?.primaryFileId != null && record.sourceFileId !== book.primaryFileId) reason = 'PRIMARY_FILE_CHANGED';
    }
    if (!reason) {
      try {
        return { record, artifact: await this.resolve(userId, deviceId, record) };
      } catch (error) {
        const code = deliveryErrorCode(error);
        if (!replaceable || !code || !STALE_DELIVERY_CODES.has(code)) throw error;
        reason = code;
      }
    }
    const startedAt = Date.now();
    await this.repository.retire(userId, deviceId, record.id);
    const fresh = await this.offer(userId, deviceId, bookId);
    // The device learns the fresh offer's size and URL on its next sync either way.
    await this.repository.reoffer(userId, deviceId, bookId);
    if (fresh.metadata.format !== record.metadata.format) {
      this.logger.warn(
        `[kobo.delivery_refresh] [fail] userId=${userId} deviceId=${deviceId} bookId=${bookId} staleId=${record.id} freshId=${fresh.id} reason=${reason} durationMs=${Date.now() - startedAt} - fresh offer changes format, the device must sync before downloading`,
      );
      throw new ConflictException({ code: 'KOBO_DELIVERY_FORMAT_CHANGED' });
    }
    this.logger.log(
      `[kobo.delivery_refresh] [end] userId=${userId} deviceId=${deviceId} bookId=${bookId} staleId=${record.id} freshId=${fresh.id} reason=${reason} durationMs=${Date.now() - startedAt} - stale offer replaced from the current file`,
    );
    return { record: fresh, artifact: await this.resolve(userId, deviceId, fresh) };
  }

  /** The book file a delivery was built from, while it still belongs to the book as an EPUB. */
  async findSourceFile(record: KoboDeliveryRecord) {
    if (record.sourceFileId === null) return null;
    const file = await this.downloads.findPrimaryFile(record.bookId, record.sourceFileId);
    return file && (file.format === 'epub' || file.format === 'kepub') ? file : null;
  }

  async resolve(userId: number, deviceId: number, record: KoboDeliveryRecord): Promise<DeliveryArtifact> {
    await this.repository.assertDevice(userId, deviceId);
    await this.access.assertBookAccessible(userId, record.bookId);
    if (record.sourceFileId === null) throw new ConflictException({ code: 'DELIVERY_ARTIFACT_UNAVAILABLE' });
    const file = await this.downloads.findPrimaryFile(record.bookId, record.sourceFileId);
    if (!file) throw new ConflictException({ code: 'DELIVERY_ARTIFACT_UNAVAILABLE' });
    const artifact = await this.artifacts.prepare(
      {
        id: file.id,
        absolutePath: file.absolutePath,
        format: file.format,
        mediaOverlayAvailable: file.mediaOverlayAvailable,
        mtime: file.mtime,
        sizeBytes: file.sizeBytes,
        ino: file.ino,
      },
      record.metadata.actualVariant === 'original' ? 'original' : 'audioless_epub',
      record.metadata.sourceRevision,
    );
    let conversionRelease: (() => Promise<void>) | undefined;
    try {
      if (record.metadata.format === 'kepub' && file.format !== 'kepub') {
        // Another converter may still write the same content, which the digest can confirm; without one it cannot be told.
        if ((await this.binary.getVersion()) !== record.options.converterVersion && !record.options.kepubContentDigest)
          throw new ConflictException({ code: 'DELIVERY_ARTIFACT_UNAVAILABLE' });
        const converted = await this.conversion.acquireKepub({
          sourcePath: artifact.path,
          fileHash: artifact.sha256,
          sourceRevision: artifact.sha256,
          bookId: record.bookId,
          hyphenate: record.options.hyphenate,
          audioless: artifact.actualVariant === 'audioless_epub',
        });
        artifact.path = converted.path;
        conversionRelease = converted.release;
        const handle = await open(artifact.path, 'r');
        try {
          const hash = createHash('sha256');
          for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
          artifact.sha256 = hash.digest('hex');
        } finally {
          await handle.close();
        }
      }
      if (artifact.sha256 !== record.metadata.sha256) {
        if (!(await this.holdsDeliveredContent(record, artifact.path))) throw new ConflictException({ code: 'DELIVERY_ARTIFACT_UNAVAILABLE' });
      } else if (record.metadata.format === 'kepub' && file.format !== 'kepub' && !record.options.kepubContentDigest) {
        await this.rememberContentDigest(record, artifact.path);
      }
      return {
        ...artifact,
        ...record.metadata,
        release: async () => {
          await conversionRelease?.();
          await artifact.release();
        },
      };
    } catch (error) {
      await conversionRelease?.();
      await artifact.release();
      throw error;
    }
  }

  /**
   * Whether a rebuilt KEPUB is the conversion the device holds. kepubify orders archive entries differently on every
   * run, so a cache eviction otherwise ends precise sync for the book until it is delivered again.
   */
  private async holdsDeliveredContent(record: KoboDeliveryRecord, path: string): Promise<boolean> {
    const expected = record.options.kepubContentDigest;
    if (record.metadata.format !== 'kepub' || !expected) return false;
    try {
      return (await kepubContentDigest(path)) === expected;
    } catch {
      return false;
    }
  }

  /**
   * Records the content digest of the exact copy a delivery made before digests were kept, so a later rebuild of it
   * can be recognised once the cached copy is evicted.
   */
  async rememberContentDigest(record: KoboDeliveryRecord, path: string): Promise<void> {
    if (record.metadata.format !== 'kepub' || record.options.kepubContentDigest) return;
    try {
      const digest = await kepubContentDigest(path);
      await this.repository.setKepubContentDigest(record.userId, record.deviceId, record.id, digest);
      record.options = { ...record.options, kepubContentDigest: digest };
    } catch (error) {
      this.logger.warn(
        `[kobo.delivery_digest] [fail] userId=${record.userId} deviceId=${record.deviceId} bookId=${record.bookId} deliveryId=${record.id} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - content digest not recorded`,
      );
    }
  }

  async byId(userId: number, deviceId: number, id: string) {
    await this.repository.assertDevice(userId, deviceId);
    const record = await this.repository.findById(userId, deviceId, id);
    if (record) await this.access.assertBookAccessible(userId, record.bookId);
    return record;
  }

  async beginReplacement(userId: number, deviceId: number, bookId: number, variant: ReadAloudDeliveryPreference) {
    return this.offer(userId, deviceId, bookId, variant);
  }

  async offerReplacement(userId: number, deviceId: number, id: string) {
    const record = await this.byId(userId, deviceId, id);
    if (!record || !record.current || !record.options.replacement) throw new NotFoundException();
    if (!['prepared', 'offered', 'transfer_observed'].includes(record.state)) throw new ConflictException({ code: 'KOBO_REPLACEMENT_NOT_PENDING' });
    const artifact = await this.resolve(userId, deviceId, record);
    await artifact.release();
    await this.repository.transition(userId, deviceId, id, ['prepared'], 'offered');
    await this.repository.reoffer(userId, deviceId, record.bookId);
    return this.byId(userId, deviceId, id);
  }

  async cancelReplacement(userId: number, deviceId: number, id: string) {
    const record = await this.byId(userId, deviceId, id);
    if (!record) throw new NotFoundException();
    const cancelled = await this.repository.cancel(userId, deviceId, id);
    // The device was told about an offered replacement, so it must hear which copy stands for the book now.
    if (cancelled && record.state === 'offered') await this.repository.reoffer(userId, deviceId, record.bookId);
    return this.byId(userId, deviceId, id);
  }

  async confirm(userId: number, deviceId: number, id: string) {
    const record = await this.repository.findById(userId, deviceId, id);
    if (!record || !record.current || !record.options.replacement) throw new NotFoundException();
    await this.current(userId, deviceId, record.bookId);
    if (!['transfer_observed', 'user_confirmed'].includes(record.state))
      throw new ConflictException({ code: 'KOBO_REPLACEMENT_TRANSFER_NOT_OBSERVED' });
    await this.repository.transition(userId, deviceId, id, ['transfer_observed', 'user_confirmed'], 'user_confirmed');
    await this.repository.adoptForDeviceReadingState(userId, deviceId, record.bookId, id);
    return this.repository.findById(userId, deviceId, id);
  }

  async transferObserved(userId: number, deviceId: number, record: KoboDeliveryRecord) {
    const moved = await this.repository.transition(userId, deviceId, record.id, ['offered', 'transfer_observed'], 'transfer_observed');
    if (moved.length && !record.options.replacement) await this.repository.adoptForDeviceReadingState(userId, deviceId, record.bookId, record.id);
  }
}
