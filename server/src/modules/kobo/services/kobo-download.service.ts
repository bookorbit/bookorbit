import type { ReadStream } from 'fs';
import { mkdtemp, open, rm, stat } from 'fs/promises';
import type { FileHandle } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { HttpException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { computeFileHashFromHandle } from '../../../common/utils/file-hash.utils';
import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { AudiolessEpubService } from '../../book/audioless-epub.service';
import { KoboDownloadHashRegistrationService } from './kobo-download-hash-registration.service';
import { KoboDownloadRepository } from '../kobo-download.repository';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KepubConversionService } from './kepub-conversion.service';
import { KoboSettingsService } from './kobo-settings.service';

/** A narration-free rebuild, living in a temp directory for the length of one download. */
interface AudiolessCopy {
  path: string;
  size: number;
  cleanup: () => Promise<void>;
}

const MIME: Record<string, string> = {
  epub: 'application/epub+zip',
  'kepub.epub': 'application/epub+zip',
  pdf: 'application/pdf',
};

@Injectable()
export class KoboDownloadService {
  private readonly logger = new Logger(KoboDownloadService.name);

  constructor(
    private readonly repository: KoboDownloadRepository,
    private readonly hashRegistration: KoboDownloadHashRegistrationService,
    private readonly kepubConversionService: KepubConversionService,
    private readonly settingsService: KoboSettingsService,
    private readonly bookAccessService: KoboBookAccessService,
    private readonly audiolessEpubService: AudiolessEpubService,
  ) {}

  async streamBook(userId: number, bookId: number, reply: FastifyReply) {
    const book = await this.repository.findBook(bookId);
    if (!book) throw new NotFoundException('Book not found');

    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const file = await this.repository.findPrimaryFile(bookId, book.primaryFileId ?? -1);

    if (!file) throw new NotFoundException('No file found for this book');

    const format = (file.format ?? 'epub').toLowerCase();

    if (format === 'pdf') {
      return this.streamFile(file.absolutePath, file.id, format, reply);
    }

    if (format === 'kepub') {
      return this.streamFile(file.absolutePath, file.id, 'kepub.epub', reply);
    }

    if (format === 'epub') {
      const settings = await this.settingsService.getSettings(userId);
      // Strip the narration before anything else looks at the size. A read-along archive is
      // mostly audio the device cannot play, and left in place it pushes the file past the kepub
      // limit, so the Kobo would receive the whole thing unconverted.
      const audioless = file.mediaOverlayAvailable ? await this.buildAudiolessCopy(file.absolutePath, bookId, file.id) : null;
      const sourcePath = audioless?.path ?? file.absolutePath;
      const sourceSize = audioless?.size ?? file.sizeBytes;
      const limitBytes = settings.kepubConversionLimitMb * 1024 * 1024;
      const withinLimit = !sourceSize || sourceSize <= limitBytes;

      if (settings.convertToKepub && withinLimit) {
        return this.streamKepub(
          sourcePath,
          file.fileHash ?? 'nohash',
          bookId,
          file.id,
          settings.forceEnableHyphenation,
          audioless !== null,
          reply,
          audioless?.cleanup,
        );
      }
      if (audioless) {
        return this.streamFile(audioless.path, file.id, 'epub', reply, audioless.cleanup);
      }
    }

    return this.streamFile(file.absolutePath, file.id, format, reply);
  }

  /**
   * Rebuilds the archive without its narration. A failure is not fatal: the caller falls back to
   * the original file, matching what the KOReader catalog does.
   */
  private async buildAudiolessCopy(sourcePath: string, bookId: number, fileId: number): Promise<AudiolessCopy | null> {
    const start = Date.now();
    const tempDir = await mkdtemp(join(tmpdir(), 'bookorbit-kobo-epub-'));
    const tempPath = join(tempDir, 'book.epub');
    const cleanup = () => rm(tempDir, { recursive: true, force: true });
    try {
      await this.audiolessEpubService.writeArchive(sourcePath, tempPath);
      const { size } = await stat(tempPath);
      return { path: tempPath, size, cleanup };
    } catch (err) {
      await cleanup().catch(() => undefined);
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        `[kobo.download] [fail] bookId=${bookId} fileId=${fileId} durationMs=${Date.now() - start} errorClass=${error.constructor.name} error="${sanitizeLogValue(error.message)}" - audioless rebuild failed, serving original EPUB`,
      );
      return null;
    }
  }

  private async streamFile(absolutePath: string, fileId: number, format: string, reply: FastifyReply, cleanup?: () => Promise<void>) {
    const startedAt = Date.now();
    let handle: FileHandle | undefined;
    let stream: ReadStream | undefined;
    let cleanupStarted = false;
    const release = async () => {
      if (cleanupStarted) return;
      cleanupStarted = true;
      await cleanup?.().catch(() => undefined);
    };
    try {
      handle = await open(absolutePath, 'r');
      const [{ size }, hash] = await Promise.all([handle.stat(), computeFileHashFromHandle(handle)]);
      // Persist the identity of the bytes being sent, including cache hits and fallback EPUBs.
      // File history preserves ambiguity and never replaces a user's explicit hash link.
      await this.hashRegistration.record(fileId, hash).catch((error: unknown) => {
        this.logger.warn(
          `[kobo.download_hash_registration] [fail] fileId=${fileId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'UnknownError'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - identity registration failed`,
        );
      });
      reply.header('Content-Length', size);
      reply.header('Content-Disposition', `attachment; filename="book-${fileId}.${format}"`);
      reply.type(MIME[format] ?? 'application/octet-stream');
      // Hash and stream the same open file even if its cache path is replaced concurrently.
      stream = handle.createReadStream({ start: 0 });
      // A temp rebuild is only safe to delete once the response has finished reading it.
      if (cleanup) stream.once('close', () => void release());
      reply.send(stream);
    } catch (err) {
      stream?.destroy();
      await handle?.close().catch(() => undefined);
      await release();
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR') {
        throw new NotFoundException('File not found on disk');
      }
      if (err instanceof HttpException) throw err;
      this.logger.warn(
        `[kobo.download] [fail] fileId=${fileId} durationMs=${Date.now() - startedAt} errorClass=${err instanceof Error ? err.name : 'UnknownError'} error="${sanitizeLogValue(err instanceof Error ? err.message : String(err))}" - download preparation failed`,
      );
      throw new InternalServerErrorException('Unable to prepare book download');
    }
  }

  private async streamKepub(
    sourcePath: string,
    fileHash: string,
    bookId: number,
    fileId: number,
    hyphenate: boolean,
    audioless: boolean,
    reply: FastifyReply,
    cleanup?: () => Promise<void>,
  ) {
    const start = Date.now();
    let cachedPath: string | null = null;
    try {
      cachedPath = await this.kepubConversionService.getKepubPath({ sourcePath, fileHash, bookId, hyphenate, audioless });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        `[kobo.download] [fail] bookId=${bookId} fileId=${fileId} durationMs=${Date.now() - start} errorClass=${error.constructor.name} error="${sanitizeLogValue(error.message)}" - kepub conversion failed, falling back to epub`,
      );
    }

    // Whichever file is actually sent owns the cleanup, so a temp rebuild is never removed while
    // the response is still reading it.
    return cachedPath
      ? this.streamFile(cachedPath, fileId, 'kepub.epub', reply, cleanup)
      : this.streamFile(sourcePath, fileId, 'epub', reply, cleanup);
  }
}
