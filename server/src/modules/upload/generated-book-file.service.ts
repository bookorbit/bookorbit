import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { constants, createWriteStream } from 'node:fs';
import { link, lstat, open, readdir, rename, rm, stat, statfs, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';

import type { RequestUser } from '../../common/types/request-user';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { FileLockService, bookOperationLockKey } from '../file-write/file-lock.service';
import { FileWriteRepository } from '../file-write/file-write.repository';
import { LibraryService } from '../library/library.service';
import { PathPolicyService } from '../path/path-policy.service';
import { inspectEpubMediaOverlayFields } from '../reader/epub/epub-media-overlay-capability';
import { computeFileHash } from '../scanner/lib/hash';
import { GeneratedBookFileRepository } from './generated-book-file.repository';
import { UploadProcessorService } from './upload-processor.service';
import { UploadService } from './upload.service';
import { UploadValidatorService } from './upload-validator.service';

const FREE_SPACE_MARGIN_BYTES = 256 * 1024 * 1024;
const MAX_NAME_ATTEMPTS = 50;
const LINK_UNSUPPORTED = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS']);
const PARTIAL_PREFIX = '.bookorbit-generated-';
const PARTIAL_KEY = /^[0-9a-z-]{1,36}$/i;
const NO_FOLLOW = constants.O_NOFOLLOW ?? 0;
/** Filesystems cap a name at 255 bytes; this leaves room for the `-50` a taken name gets. */
export const GENERATED_FILENAME_MAX_BYTES = 252;

/** Cuts `text` to at most `maxBytes` of UTF-8 without splitting a character. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let result = '';
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

/** Shortens the stem, never the extension, so the name fits `GENERATED_FILENAME_MAX_BYTES`. */
export function fitGeneratedFilename(filename: string): string {
  if (Buffer.byteLength(filename) <= GENERATED_FILENAME_MAX_BYTES) return filename;
  const extension = extname(filename);
  const stem = truncateUtf8(basename(filename, extension), GENERATED_FILENAME_MAX_BYTES - Buffer.byteLength(extension)).trimEnd();
  return `${stem || 'file'}${extension}`;
}

export type GeneratedFileFailure = 'insufficient_storage' | 'not_allowed' | 'invalid_content' | 'too_large' | 'missing_target';

/** A failure the caller can map to its own error codes; the message is safe to show and log. */
export class GeneratedFileError extends Error {
  constructor(
    readonly reason: GeneratedFileFailure,
    message: string,
    readonly details: Record<string, number> = {},
  ) {
    super(message);
    this.name = 'GeneratedFileError';
  }
}

export type GeneratedFileSource = {
  bookId: number;
  /** A file outside the library, such as a finished job's output. It is copied, never moved. */
  sourcePath: string;
  /** Distinguishes this attempt's partial file, so a retry can find and remove a stale one. */
  partialKey: string;
  maxBytes: number;
  user: RequestUser;
};

/**
 * Puts files the server produced itself into a book folder. Unlike an upload there is no request
 * body to bound, so the admin upload limit doesn't apply, and the copy is staged inside the book
 * folder rather than in `/tmp`, which is memory-backed in the container.
 */
@Injectable()
export class GeneratedBookFileService {
  private readonly logger = new Logger(GeneratedBookFileService.name);

  constructor(
    private readonly repository: GeneratedBookFileRepository,
    private readonly libraryService: LibraryService,
    private readonly validator: UploadValidatorService,
    private readonly pathPolicy: PathPolicyService,
    private readonly uploads: UploadService,
    private readonly processor: UploadProcessorService,
    private readonly fileLocks: FileLockService,
    private readonly fileWriteRepo: FileWriteRepository,
  ) {}

  /**
   * Adds `<stem>.epub` (or `<stem>-2.epub` and so on when taken) to the book. Never overwrites. Holds
   * the book's operation lock throughout, so a rename or move cannot shift the folder mid-copy.
   */
  async addFile(source: GeneratedFileSource & { filename: string }): Promise<{ fileId: number; reused: boolean }> {
    const event = 'generated_file.add';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] bookId=${source.bookId} userId=${source.user.id} partialKey=${source.partialKey} - adding generated file`);
    try {
      return await this.fileLocks.withLock(bookOperationLockKey(source.bookId), () => this.addFileLocked(source, event, startedAt));
    } catch (error) {
      this.logFailure(event, source, startedAt, error);
      throw error;
    }
  }

  private async addFileLocked(
    source: GeneratedFileSource & { filename: string },
    event: string,
    startedAt: number,
  ): Promise<{ fileId: number; reused: boolean }> {
    const book = await this.loadBook(source.bookId, source.user);
    const filename = fitGeneratedFilename(this.validator.sanitizeFilename(source.filename));
    const format = this.assertAllowed(book, filename);
    const sizeBytes = await this.assertSourceSize(source);
    await this.clearPartials(book.folderPath, source.bookId);
    await this.assertFreeSpace(book.folderPath, sizeBytes);

    let partial: string | null = null;
    let destination: string | null = null;
    try {
      partial = await this.stage(book.folderPath, source);
      const fileHash = await this.validateStaged(partial, format);
      const duplicate = await this.repository.findFileIdByHash(source.bookId, fileHash);
      if (duplicate) {
        await rm(partial, { force: true });
        this.logger.log(
          `[${event}] [end] bookId=${source.bookId} fileId=${duplicate} reused=true durationMs=${Date.now() - startedAt} - generated file already attached`,
        );
        return { fileId: duplicate, reused: true };
      }
      destination = await this.claimDestination(book.folderPath, filename, partial);
      const result = await this.uploads.registerBookFile({
        bookId: source.bookId,
        libraryFolderId: book.libraryFolderId,
        libraryFolderPath: book.libraryFolderPath,
        destination,
        sizeBytes,
        fileHash,
        format,
      });
      this.logger.log(
        `[${event}] [end] bookId=${source.bookId} fileId=${result.id} sizeBytes=${sizeBytes} durationMs=${Date.now() - startedAt} - generated file added`,
      );
      return { fileId: result.id, reused: false };
    } catch (error) {
      if (partial) await rm(partial, { force: true }).catch(() => undefined);
      const adopted = destination ? await this.settleUnregistered(source.bookId, destination) : null;
      if (adopted !== null) {
        this.logger.log(
          `[${event}] [end] bookId=${source.bookId} fileId=${adopted} reused=true durationMs=${Date.now() - startedAt} - generated file was registered by the library watcher`,
        );
        return { fileId: adopted, reused: true };
      }
      throw error;
    }
  }

  /**
   * Registration failed after the file reached its final name. A file nothing tracks would be picked
   * up by the next scan and doubled by the next attempt, so it goes; one the watcher registered for
   * this book in the meantime is adopted. When the lookup itself fails the file stays, because
   * deleting a tracked file is worse than leaving an untracked one.
   */
  private async settleUnregistered(bookId: number, destination: string): Promise<number | null> {
    let owner: { id: number; bookId: number } | null;
    try {
      owner = await this.repository.findFileByPath(destination);
    } catch {
      return null;
    }
    if (owner) return owner.bookId === bookId ? owner.id : null;
    await rm(destination, { force: true }).catch(() => undefined);
    return null;
  }

  /**
   * Overwrites an existing file's content and keeps its row, so reading sessions, progress,
   * bookmarks and device links that point at the file id survive. The previous hash goes into the
   * hash history the same way a metadata write-back records it. The target is read under the book's
   * operation lock, so a rename or write-back that ran during an earlier attempt cannot leave it stale.
   */
  async replaceFile(source: GeneratedFileSource & { fileId: number }): Promise<{ fileId: number }> {
    const event = 'generated_file.replace';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] bookId=${source.bookId} fileId=${source.fileId} userId=${source.user.id} partialKey=${source.partialKey} - replacing file content`,
    );
    try {
      return await this.fileLocks.withLock(bookOperationLockKey(source.bookId), () => this.replaceFileLocked(source, event, startedAt));
    } catch (error) {
      this.logFailure(event, source, startedAt, error);
      throw error;
    }
  }

  private async replaceFileLocked(source: GeneratedFileSource & { fileId: number }, event: string, startedAt: number): Promise<{ fileId: number }> {
    const book = await this.loadBook(source.bookId, source.user);
    const target = await this.loadTarget(source.bookId, source.fileId);
    const folder = dirname(target.absolutePath);
    const format = this.assertAllowed(book, basename(target.absolutePath));
    const sizeBytes = await this.assertSourceSize(source);
    await this.pathPolicy.assertWithinRoot(target.absolutePath, book.folderPath);
    await this.clearPartials(folder, source.bookId);
    await this.assertFreeSpace(folder, sizeBytes);

    let partial: string | null = null;
    try {
      partial = await this.stage(folder, source);
      const staged = partial;
      const fileHash = await this.validateStaged(staged, format);
      const overlay = await inspectEpubMediaOverlayFields(staged, format);
      await this.fileLocks.withLock(target.absolutePath, async () => {
        const previous = await this.keepPrevious(target.absolutePath, folder, source);
        try {
          if (target.fileHash) await this.fileWriteRepo.recordHashHistory(target.id, target.fileHash, 'read_aloud_replace');
          await rename(staged, target.absolutePath);
          const fileStat = await stat(target.absolutePath, { bigint: true });
          await this.fileWriteRepo.updateFileStateAfterMetadataWrite(source.bookId, target.id, target.fileHash, {
            fileHash,
            mtime: fileStat.mtime,
            sizeBytes: Number(fileStat.size),
            ino: fileStat.ino,
            ...overlay,
          });
        } catch (error) {
          // The row still describes the old content, so the old content goes back under its name.
          if (previous) await rename(previous, target.absolutePath).catch(() => undefined);
          throw error;
        }
        if (previous) await rm(previous, { force: true }).catch(() => undefined);
      });
      this.processor.reconcileCoversAsync([source.bookId]);
      this.logger.log(
        `[${event}] [end] bookId=${source.bookId} fileId=${target.id} sizeBytes=${sizeBytes} durationMs=${Date.now() - startedAt} - file content replaced`,
      );
      return { fileId: target.id };
    } catch (error) {
      if (partial) await rm(partial, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async loadBook(bookId: number, user: RequestUser) {
    const book = await this.repository.findBookPlacement(bookId);
    if (!book) throw new NotFoundException(`Book ${bookId} not found`);
    await this.libraryService.verifyUserAccess(user.id, book.libraryId, user.isSuperuser);
    if (book.organizationMode === 'book_per_file') {
      throw new GeneratedFileError('not_allowed', 'Single-file libraries cannot hold more than one file per book');
    }
    return book;
  }

  private async loadTarget(bookId: number, fileId: number) {
    const target = await this.repository.findFile(bookId, fileId);
    if (!target) throw new GeneratedFileError('missing_target', 'The file to replace no longer exists');
    return target;
  }

  private assertAllowed(book: { allowedFormats: string[] }, filename: string): string {
    try {
      return this.validator.validateFormat(filename, book.allowedFormats);
    } catch {
      throw new GeneratedFileError('not_allowed', `The library does not allow ${extname(filename).slice(1).toUpperCase()} files`);
    }
  }

  /** Not following links: the source was written by another process, and a link there could point anywhere. */
  private async assertSourceSize(source: GeneratedFileSource): Promise<number> {
    const info = await lstat(source.sourcePath);
    if (!info.isFile() || info.size <= 0) throw new GeneratedFileError('invalid_content', 'The generated file is missing or empty');
    if (info.size > source.maxBytes) {
      throw new GeneratedFileError('too_large', 'The generated file exceeds the configured size limit', {
        sizeBytes: info.size,
        maxBytes: source.maxBytes,
      });
    }
    return info.size;
  }

  private async assertFreeSpace(folder: string, sizeBytes: number): Promise<void> {
    const fs = await statfs(folder, { bigint: true });
    const available = Number(fs.bavail * fs.bsize);
    const needed = Math.ceil(sizeBytes * 1.05) + FREE_SPACE_MARGIN_BYTES;
    if (available < needed) {
      throw new GeneratedFileError('insufficient_storage', 'Not enough free space in the library folder', {
        neededBytes: needed,
        availableBytes: available,
      });
    }
  }

  /**
   * Copies the source next to its destination under a short hidden name. The name does not grow with
   * the book's file name, which would push a long one past the filesystem's 255-byte limit.
   */
  private async stage(folder: string, source: GeneratedFileSource): Promise<string> {
    if (!PARTIAL_KEY.test(source.partialKey)) throw new Error('Invalid partial key');
    const partial = join(folder, `${PARTIAL_PREFIX}${source.bookId}-${source.partialKey}.partial`);
    await this.pathPolicy.assertWithinRoot(partial, folder);
    await rm(partial, { force: true });
    try {
      const input = await open(source.sourcePath, constants.O_RDONLY | NO_FOLLOW);
      await pipeline(input.createReadStream(), createWriteStream(partial, { flags: 'wx', flush: true }));
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      throw error;
    }
    return partial;
  }

  /**
   * A second name for the content about to be replaced, so a failed update can put it back. It is
   * best effort: without hard links (or with the file already gone) a retry or rescan settles the row.
   * The name ends in `.partial`, so one a crash leaves behind is cleared by the next attempt.
   */
  private async keepPrevious(targetPath: string, folder: string, source: GeneratedFileSource): Promise<string | null> {
    const previous = join(folder, `${PARTIAL_PREFIX}${source.bookId}-${source.partialKey}.previous.partial`);
    await this.pathPolicy.assertWithinRoot(previous, folder);
    await rm(previous, { force: true });
    try {
      await link(targetPath, previous);
      return previous;
    } catch {
      return null;
    }
  }

  /**
   * Removes this book's partial copies left by an attempt that died mid-copy (a restart, or a job
   * started over under a new key). They are hidden from the scanner, so nothing else ever would,
   * and they must go before the free-space check they would otherwise fail. Callers hold the
   * book's operation lock, so none of them is being written.
   */
  private async clearPartials(folder: string, bookId: number): Promise<void> {
    const prefix = `${PARTIAL_PREFIX}${bookId}-`;
    const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith('.partial')) continue;
      await rm(join(folder, entry.name), { force: true }).catch(() => undefined);
    }
  }

  private async validateStaged(partial: string, format: string): Promise<string> {
    try {
      await this.validator.validateContent(partial, format);
    } catch {
      throw new GeneratedFileError('invalid_content', 'The generated file failed content validation');
    }
    return computeFileHash(partial);
  }

  /**
   * Moves the partial to the first free name. A hard link fails if the name exists, which makes the
   * claim atomic; filesystems without hard links fall back to a check then a rename.
   */
  private async claimDestination(folder: string, filename: string, partial: string): Promise<string> {
    const extension = extname(filename);
    const stem = basename(filename, extension);
    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
      const candidate = join(folder, attempt === 1 ? filename : `${stem}-${attempt}${extension}`);
      await this.pathPolicy.assertWithinRoot(candidate, folder);
      try {
        await link(partial, candidate);
        await unlink(partial);
        return candidate;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') continue;
        if (!code || !LINK_UNSUPPORTED.has(code)) throw error;
        const exists = await stat(candidate).then(
          () => true,
          () => false,
        );
        if (exists) continue;
        await rename(partial, candidate);
        return candidate;
      }
    }
    throw new GeneratedFileError('not_allowed', 'No free file name was available in the book folder');
  }

  private logFailure(event: string, source: GeneratedFileSource, startedAt: number, error: unknown): void {
    const errorClass = error instanceof Error ? error.name : 'Error';
    const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
    this.logger.warn(
      `[${event}] [fail] bookId=${source.bookId} userId=${source.user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${message}" - generated file failed`,
    );
  }
}
