import { ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Interval } from '@nestjs/schedule';
import { Permission, UploadErrorCode, UPLOAD_SUPPORTED_FORMATS } from '@bookorbit/types';
import type { UploadCapabilitiesResponse, UploadSessionResponse, UploadTarget } from '@bookorbit/types';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, open, stat, truncate } from 'fs/promises';
import { basename, join } from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import type { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';

import type { UploadSessionRow } from '../../db/schema';
import type { RequestUser } from '../../common/types/request-user';
import { storageConfig } from '../../config/config';
import {
  HARD_MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_SIZE_BYTES,
  UPLOAD_SESSION_RETENTION_MS,
  UPLOAD_SESSION_TTL_MS,
} from '../../common/constants/upload.constants';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryService } from '../library/library.service';
import { BookDockIngestService } from '../book-dock/book-dock-ingest.service';
import type { CreateUploadSessionDto } from './dto/create-upload-session.dto';
import { UploadProcessorService } from './upload-processor.service';
import { UploadService } from './upload.service';
import { UploadSessionRepository } from './upload-session.repository';
import { UploadStorageService } from './upload-storage.service';
import { UploadValidatorService } from './upload-validator.service';
import { uploadError } from './upload-errors';

@Injectable()
export class UploadSessionService implements OnApplicationBootstrap {
  private readonly stagingDirectory: string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    @Inject(storageConfig.KEY) storage: ConfigType<typeof storageConfig>,
    private readonly repo: UploadSessionRepository,
    private readonly appSettings: AppSettingsService,
    private readonly libraryService: LibraryService,
    private readonly validator: UploadValidatorService,
    private readonly storageService: UploadStorageService,
    private readonly uploadService: UploadService,
    private readonly processor: UploadProcessorService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.stagingDirectory = join(storage.appDataPath, 'upload-sessions');
  }

  async onApplicationBootstrap(): Promise<void> {
    await mkdir(this.stagingDirectory, { recursive: true });
    await this.cleanupExpired();
    for (const row of await this.repo.findProcessing()) {
      if (row.resultBookId && row.targetLibraryId) {
        void this.resumeBookProcessing(row);
      } else {
        await this.fail(row.id, UploadErrorCode.ImportFailed, 'Upload processing was interrupted before the file was committed');
      }
    }
  }

  async capabilities(user: RequestUser): Promise<UploadCapabilitiesResponse> {
    const maxMb = await this.appSettings.getMaxUploadSizeMb();
    const libraryIds = await this.libraryService.findAccessibleLibraryIds(user);
    const [libraryRows, folderRows] = await Promise.all([this.repo.findCapabilityLibraries(libraryIds), this.repo.findCapabilityFolders(libraryIds)]);

    const canUploadToLibrary = this.hasPermission(user, Permission.LibraryUpload);
    return {
      maxFileSizeBytes: Math.min(HARD_MAX_UPLOAD_BYTES, maxMb * 1_024 * 1_024),
      chunkSizeBytes: UPLOAD_CHUNK_SIZE_BYTES,
      supportedFormats: [...UPLOAD_SUPPORTED_FORMATS],
      canUploadToLibrary,
      canUseBookDock: this.hasPermission(user, Permission.BookDockAccess),
      libraries: canUploadToLibrary
        ? libraryRows.map((library) => ({
            id: library.id,
            name: library.name,
            allowedFormats: library.allowedFormats,
            organizationMode: library.organizationMode === 'book_per_file' ? ('book_per_file' as const) : ('book_per_folder' as const),
            folders: folderRows
              .filter((folder) => folder.libraryId === library.id)
              .map((folder) => ({ id: folder.id, name: basename(folder.path) || library.name })),
          }))
        : [],
    };
  }

  async create(dto: CreateUploadSessionDto, user: RequestUser): Promise<UploadSessionResponse> {
    const existing = await this.repo.findByIdempotencyKey(user.id, dto.idempotencyKey);
    if (existing) {
      this.assertIdempotentMatch(existing, dto);
      return this.toResponse(existing);
    }

    const maxMb = await this.appSettings.getMaxUploadSizeMb();
    const maxBytes = Math.min(HARD_MAX_UPLOAD_BYTES, maxMb * 1_024 * 1_024);
    if (dto.sizeBytes > maxBytes) throw uploadError.tooLarge(`File exceeds the ${maxMb} MB upload limit`);

    const filename = this.validator.sanitizeFilename(dto.filename);
    const target = this.parseTarget(dto);
    await this.validateTarget(target, filename, user);

    const id = randomUUID();
    const stagingPath = join(this.stagingDirectory, `${id}.upload`);
    const handle = await open(stagingPath, 'wx');
    await handle.close();
    try {
      const row = await this.repo.create({
        id,
        userId: user.id,
        idempotencyKey: dto.idempotencyKey,
        targetKind: target.kind,
        targetLibraryId: target.kind === 'library' ? target.libraryId : null,
        targetFolderId: target.kind === 'library' ? (target.folderId ?? null) : null,
        targetBookId: target.kind === 'existing_book' ? target.bookId : null,
        filename,
        contentType: dto.contentType ?? null,
        sizeBytes: dto.sizeBytes,
        expectedSha256: dto.sha256?.toLowerCase() ?? null,
        stagingPath,
        expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS),
      });
      return this.toResponse(row);
    } catch (error) {
      await this.storageService.cleanup(stagingPath);
      throw error;
    }
  }

  async get(id: string, user: RequestUser): Promise<UploadSessionResponse> {
    const row = await this.owned(id, user);
    return this.toResponse(await this.reconcileSize(row));
  }

  async appendChunk(
    id: string,
    offset: number,
    checksum: string | undefined,
    chunkStream: NodeJS.ReadableStream,
    user: RequestUser,
  ): Promise<UploadSessionResponse> {
    return this.withLock(id, async () => {
      let row = await this.owned(id, user);
      row = await this.reconcileSize(row);
      this.assertReceiving(row);
      if (offset !== row.receivedBytes) {
        throw new ConflictException({
          errorCode: UploadErrorCode.OffsetMismatch,
          message: `Expected upload offset ${row.receivedBytes}, received ${offset}`,
          expectedOffset: row.receivedBytes,
        });
      }

      const remaining = row.sizeBytes - row.receivedBytes;
      const allowedChunk = Math.min(UPLOAD_CHUNK_SIZE_BYTES, remaining);
      const stagedChunk = await this.storageService.streamToTemp(chunkStream as Readable, allowedChunk);
      try {
        if (stagedChunk.sizeBytes === 0) throw uploadError.empty();
        if (stagedChunk.sizeBytes > remaining) throw uploadError.tooLarge('Chunk exceeds the remaining upload size');
        if (checksum) {
          const normalized = normalizeChecksum(checksum);
          const actual = await sha256File(stagedChunk.tempPath);
          if (normalized !== actual) throw uploadError.checksumMismatch('Chunk checksum does not match');
        }

        try {
          await pipeline(createReadStream(stagedChunk.tempPath), createWriteStream(row.stagingPath, { flags: 'a' }));
        } catch (error) {
          await truncate(row.stagingPath, row.receivedBytes).catch(() => undefined);
          if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
            throw uploadError.storageFull('The server does not have enough storage for this upload');
          }
          throw error;
        }

        const receivedBytes = row.receivedBytes + stagedChunk.sizeBytes;
        row = (await this.repo.update(row.id, { receivedBytes, expiresAt: new Date(Date.now() + UPLOAD_SESSION_TTL_MS) }))!;
        return this.toResponse(row);
      } finally {
        await this.storageService.cleanup(stagedChunk.tempPath);
      }
    });
  }

  async complete(id: string, user: RequestUser): Promise<UploadSessionResponse> {
    return this.withLock(id, async () => {
      let row = await this.reconcileSize(await this.owned(id, user));
      if (row.status === 'completed' || row.status === 'processing') return this.toResponse(row);
      this.assertReceiving(row);
      if (row.receivedBytes !== row.sizeBytes) {
        throw uploadError.invalidSessionState(`Upload is incomplete: ${row.receivedBytes} of ${row.sizeBytes} bytes received`);
      }
      if (row.expectedSha256) {
        const actual = await sha256File(row.stagingPath);
        if (actual !== row.expectedSha256) throw uploadError.checksumMismatch('File checksum does not match');
      }

      await this.validator.validateContent(row.stagingPath, this.validator.validateFormat(row.filename, await this.allowedFormats(row)));
      row = (await this.repo.update(row.id, { status: 'processing', errorCode: null, errorMessage: null }))!;

      try {
        if (row.targetKind === 'library') {
          if (!row.targetLibraryId) throw uploadError.invalidTarget('Target library no longer exists');
          const stored = await this.uploadService.uploadForSession(
            row.targetLibraryId,
            row.targetFolderId ?? undefined,
            row.filename,
            createReadStream(row.stagingPath),
            user,
            row.id,
          );
          row = (await this.repo.update(row.id, { resultBookId: stored.bookId }))!;
          void this.finishStoredBook(row, stored);
        } else if (row.targetKind === 'existing_book') {
          if (!row.targetBookId) throw uploadError.invalidTarget('Target book no longer exists');
          const result = await this.uploadService.addFileToBook(row.targetBookId, row.filename, createReadStream(row.stagingPath), user);
          row = (await this.repo.update(row.id, {
            status: 'completed',
            resultBookId: row.targetBookId,
            completedAt: new Date(),
          }))!;
          await this.storageService.cleanup(row.stagingPath);
          void result;
        } else {
          const ingest = this.moduleRef.get(BookDockIngestService, { strict: false });
          const fileId = await ingest.ingestUpload(row.filename, createReadStream(row.stagingPath), user.id);
          row = (await this.repo.update(row.id, {
            status: 'completed',
            resultBookDockFileId: fileId,
            completedAt: new Date(),
          }))!;
          await this.storageService.cleanup(row.stagingPath);
        }
        return this.toResponse(row);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.fail(row.id, UploadErrorCode.ImportFailed, message);
        throw error;
      }
    });
  }

  async cancel(id: string, user: RequestUser): Promise<UploadSessionResponse> {
    return this.withLock(id, async () => {
      let row = await this.owned(id, user);
      if (row.status === 'processing') throw uploadError.invalidSessionState('An upload cannot be cancelled after import processing begins');
      if (row.status === 'completed') return this.toResponse(row);
      row = (await this.repo.update(row.id, { status: 'cancelled', completedAt: new Date() }))!;
      await this.storageService.cleanup(row.stagingPath);
      return this.toResponse(row);
    });
  }

  @Interval(60 * 60 * 1_000)
  async cleanupExpired(): Promise<void> {
    const rows = await this.repo.findExpiredReceiving(new Date());
    for (const row of rows) {
      await this.repo.update(row.id, { status: 'expired', completedAt: new Date() });
      await this.storageService.cleanup(row.stagingPath);
    }
    await this.repo.deleteTerminalBefore(new Date(Date.now() - UPLOAD_SESSION_RETENTION_MS));
  }

  private async finishStoredBook(row: UploadSessionRow, stored: Awaited<ReturnType<UploadService['uploadForSession']>>): Promise<void> {
    try {
      await this.uploadService.processStoredUpload(stored);
      await this.repo.update(row.id, { status: 'completed', completedAt: new Date() });
      await this.storageService.cleanup(row.stagingPath);
    } catch (error) {
      await this.fail(row.id, UploadErrorCode.ImportFailed, error instanceof Error ? error.message : String(error));
    }
  }

  private async resumeBookProcessing(row: UploadSessionRow): Promise<void> {
    const file = await this.repo.findPrimaryBookFile(row.resultBookId!);
    if (!file?.format) {
      await this.fail(row.id, UploadErrorCode.ImportFailed, 'Imported book file could not be found after restart');
      return;
    }
    try {
      await this.processor.processNewBookImport(row.resultBookId!, file.libraryId, file.absolutePath, file.format);
      await this.repo.update(row.id, { status: 'completed', completedAt: new Date() });
      await this.storageService.cleanup(row.stagingPath);
    } catch (error) {
      await this.fail(row.id, UploadErrorCode.ImportFailed, error instanceof Error ? error.message : String(error));
    }
  }

  private async validateTarget(target: UploadTarget, filename: string, user: RequestUser): Promise<void> {
    if (target.kind === 'book_dock') {
      if (!this.hasPermission(user, Permission.BookDockAccess)) throw new ForbiddenException('Book Dock access is required');
      this.validator.validateFormat(filename, []);
      return;
    }
    if (!this.hasPermission(user, Permission.LibraryUpload)) throw new ForbiddenException('Library upload permission is required');
    if (target.kind === 'library') {
      const library = await this.repo.findLibrary(target.libraryId);
      if (!library) throw uploadError.invalidTarget('Library not found');
      await this.libraryService.verifyUserAccess(user.id, library.id, user.isSuperuser);
      if (target.folderId) {
        if (!(await this.repo.folderBelongsToLibrary(target.folderId, target.libraryId))) {
          throw uploadError.invalidTarget('Folder does not belong to this library');
        }
      }
      this.validator.validateFormat(filename, library.allowedFormats);
      return;
    }
    const book = await this.repo.findBookTarget(target.bookId);
    if (!book) throw uploadError.invalidTarget('Book not found');
    await this.libraryService.verifyUserAccess(user.id, book.libraryId, user.isSuperuser);
    if (book.organizationMode === 'book_per_file') throw uploadError.invalidTarget('This library does not allow multiple files per book');
    await this.assertBookFolderIsADirectory(book.folderPath);
    this.validator.validateFormat(filename, book.allowedFormats);
  }

  /**
   * Rejects a book whose stored folder path is not a directory.
   *
   * Without this the upload is accepted, every byte is transferred, and it fails only at `complete`
   * with an `ENOTDIR` that is not a coded upload error, so the filter reports a 500 and the raw
   * message, absolute server path included, is persisted into `errorMessage` where the client reads
   * it. The client's `isRetryable` then treats the 5xx as retryable and re-sends the whole file
   * against a condition that cannot improve.
   *
   * It belongs next to the `book_per_file` rejection: both say the same thing, that this target
   * cannot receive another file, and both are knowable before a byte moves. See F-006.
   */
  private async assertBookFolderIsADirectory(folderPath: string | null): Promise<void> {
    if (!folderPath) return;
    try {
      const stats = await stat(folderPath);
      if (!stats.isDirectory()) {
        throw uploadError.invalidTarget('This book cannot accept additional files');
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // A missing folder is the scanner's problem, not this request's, and failing creation here
      // would block an upload the import may well be able to place. Let it through.
    }
  }

  private parseTarget(dto: CreateUploadSessionDto): UploadTarget {
    if (dto.target.kind === 'library' && dto.target.libraryId) {
      return { kind: 'library', libraryId: dto.target.libraryId, folderId: dto.target.folderId };
    }
    if (dto.target.kind === 'existing_book' && dto.target.bookId) return { kind: 'existing_book', bookId: dto.target.bookId };
    if (dto.target.kind === 'book_dock') return { kind: 'book_dock' };
    throw uploadError.invalidTarget('Upload target fields are invalid');
  }

  private async allowedFormats(row: UploadSessionRow): Promise<string[]> {
    if (row.targetKind === 'book_dock') return [];
    const libraryId = row.targetLibraryId ?? (await this.repo.findBookLibraryId(row.targetBookId!));
    if (!libraryId) throw uploadError.invalidTarget('Target library no longer exists');
    const allowedFormats = await this.repo.findLibraryAllowedFormats(libraryId);
    if (!allowedFormats) throw uploadError.invalidTarget('Target library no longer exists');
    return allowedFormats;
  }

  private assertIdempotentMatch(row: UploadSessionRow, dto: CreateUploadSessionDto): void {
    const target = this.parseTarget(dto);
    const matches =
      row.filename === this.validator.sanitizeFilename(dto.filename) &&
      row.sizeBytes === dto.sizeBytes &&
      row.targetKind === target.kind &&
      row.targetLibraryId === (target.kind === 'library' ? target.libraryId : null) &&
      row.targetFolderId === (target.kind === 'library' ? (target.folderId ?? null) : null) &&
      row.targetBookId === (target.kind === 'existing_book' ? target.bookId : null);
    if (!matches) throw uploadError.invalidSessionState('Idempotency key is already used by a different upload');
  }

  private async reconcileSize(row: UploadSessionRow): Promise<UploadSessionRow> {
    if (row.status !== 'receiving') return row;
    const actual = await stat(row.stagingPath)
      .then((value) => value.size)
      .catch(() => 0);
    if (actual > row.sizeBytes) {
      await truncate(row.stagingPath, row.receivedBytes).catch(() => undefined);
      throw uploadError.invalidSessionState('Upload staging file exceeded its declared size');
    }
    if (actual !== row.receivedBytes) return (await this.repo.update(row.id, { receivedBytes: actual }))!;
    return row;
  }

  private assertReceiving(row: UploadSessionRow): void {
    if (row.expiresAt.getTime() <= Date.now()) throw uploadError.sessionExpired();
    if (row.status !== 'receiving') throw uploadError.invalidSessionState(`Upload session is ${row.status}`);
  }

  private async owned(id: string, user: RequestUser): Promise<UploadSessionRow> {
    const row = await this.repo.findById(id);
    if (!row || row.userId !== user.id) throw new NotFoundException('Upload session not found');
    return row;
  }

  private hasPermission(user: RequestUser, permission: Permission): boolean {
    return user.isSuperuser || user.permissions.includes(permission);
  }

  private async fail(id: string, errorCode: string, errorMessage: string): Promise<void> {
    await this.repo.update(id, { status: 'failed', errorCode, errorMessage: errorMessage.slice(0, 2_000), completedAt: new Date() });
  }

  private toResponse(row: UploadSessionRow): UploadSessionResponse {
    return {
      id: row.id,
      filename: row.filename,
      sizeBytes: row.sizeBytes,
      receivedBytes: row.receivedBytes,
      chunkSizeBytes: UPLOAD_CHUNK_SIZE_BYTES,
      status: row.status as UploadSessionResponse['status'],
      target:
        row.targetKind === 'library'
          ? { kind: 'library', libraryId: row.targetLibraryId!, ...(row.targetFolderId ? { folderId: row.targetFolderId } : {}) }
          : row.targetKind === 'existing_book'
            ? { kind: 'existing_book', bookId: row.targetBookId! }
            : { kind: 'book_dock' },
      errorCode: (row.errorCode as UploadSessionResponse['errorCode']) ?? null,
      errorMessage: row.errorMessage,
      bookId: row.resultBookId,
      bookDockFileId: row.resultBookDockFileId,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }

  private async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.locks.set(id, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(id) === queued) this.locks.delete(id);
    }
  }
}

function normalizeChecksum(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^sha-?256[=: ]+/, '');
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw uploadError.checksumMismatch('Checksum must be a SHA-256 hex value');
  return normalized;
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}
