import { createHash } from 'crypto';
import { open } from 'fs/promises';
import { ConflictException, Injectable, NotFoundException, Logger } from '@nestjs/common';
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

export type KoboDeliveryRecord = NonNullable<Awaited<ReturnType<KoboDeliveryRepository['findCurrent']>>>;

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
      if (['prepared', 'cancelled'].includes(current.state)) {
        const previous = current.previousId ? await this.repository.findById(userId, deviceId, current.previousId) : null;
        if (previous) return previous;
        throw new ConflictException({ code: 'KOBO_REPLACEMENT_NOT_OFFERED' });
      }
      return current;
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
        } catch (error) {
          converterVersion = null;
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
          options: { hyphenate: settings.forceEnableHyphenation, converterVersion, replacement: replacementVariant !== undefined },
          state: replacementVariant === undefined ? 'offered' : 'prepared',
        },
        replacementVariant !== undefined,
      );
    } finally {
      await conversionRelease?.();
      await artifact.release();
    }
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
        if ((await this.binary.getVersion()) !== record.options.converterVersion)
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
      if (artifact.sha256 !== record.metadata.sha256) throw new ConflictException({ code: 'DELIVERY_ARTIFACT_UNAVAILABLE' });
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
    await this.repository.cancel(userId, deviceId, id);
    return this.byId(userId, deviceId, id);
  }

  async confirm(userId: number, deviceId: number, id: string) {
    const record = await this.repository.findById(userId, deviceId, id);
    if (!record || !record.current || !record.options.replacement) throw new NotFoundException();
    await this.current(userId, deviceId, record.bookId);
    if (!['transfer_observed', 'user_confirmed'].includes(record.state))
      throw new ConflictException({ code: 'KOBO_REPLACEMENT_TRANSFER_NOT_OBSERVED' });
    await this.repository.transition(userId, deviceId, id, ['transfer_observed', 'user_confirmed'], 'user_confirmed');
    return this.repository.findById(userId, deviceId, id);
  }

  async transferObserved(userId: number, deviceId: number, record: KoboDeliveryRecord) {
    await this.repository.transition(userId, deviceId, record.id, ['offered', 'transfer_observed'], 'transfer_observed');
  }
}
