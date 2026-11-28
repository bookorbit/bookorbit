import { libraryFilePolicy } from '../../common/services/library-file-policy';
import { ConflictException, ForbiddenException, HttpException, Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
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
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import {
  HARD_MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_SIZE_BYTES,
  UPLOAD_SESSION_RETENTION_MS,
  UPLOAD_SESSION_TTL_MS,
} from '../../common/constants/upload.constants';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryService } from '../library/library.service';
import { BookDockIngestService } from '../book-dock/book-dock-ingest.service';
import { LibraryDockService } from '../book-dock/library-dock.service';
import type { CreateUploadSessionDto } from './dto/create-upload-session.dto';
import { UploadProcessorService } from './upload-processor.service';
import { UploadService } from './upload.service';
import { RequestUploadReceiver } from './request-upload-receiver';
import { UploadSessionRepository } from './upload-session.repository';
import { UploadStorageService } from './upload-storage.service';
import { CONTENT_SIGNATURE_BYTES, UploadValidatorService } from './upload-validator.service';
import { uploadError } from './upload-errors';

const IMPORT_FAILED_MESSAGE = 'The file could not be added';
const CHUNK_IDLE_TIMEOUT_MS = 120_000;

@Injectable()
export class UploadSessionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UploadSessionService.name);
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
    if (existing && isResumable(existing)) {
      this.assertIdempotentMatch(existing, dto);
      return this.toResponse(existing);
    }
    // A key belongs to one live upload, not to every attempt made under it. Clients that keep their
    // key across a retry were handed the failed, cancelled or expired session back, which can never
    // receive or complete, and the unique index refused them a new one.
    if (existing) await this.repo.releaseIdempotencyKey(existing.id);

    const maxMb = await this.appSettings.getMaxUploadSizeMb();
    const maxBytes = Math.min(HARD_MAX_UPLOAD_BYTES, maxMb * 1_024 * 1_024);
    if (dto.sizeBytes > maxBytes) throw uploadError.tooLarge(`File exceeds the ${maxMb} MB upload limit`);

    const filename = this.validator.sanitizeFilename(dto.filename);
    const target = this.parseTarget(dto);
    if (target.kind === 'book_request') await this.requestReceiver().admit(target.requestFileId, filename, dto.sizeBytes, user);
    else await this.validateTarget(target, filename, user);

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
        targetLibraryId: targetLibraryId(target),
        targetFolderId: target.kind === 'library' ? (target.folderId ?? null) : null,
        targetBookId: target.kind === 'existing_book' ? target.bookId : null,
        targetRequestFileId: target.kind === 'book_request' ? target.requestFileId : null,
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
    // The body is read before the session's lock is taken. Read under the lock, a chunk whose
    // connection went half-open held it for as long as the connection lasted, and every later
    // chunk, complete and cancel for the session queued behind it.
    const before = await this.owned(id, user);
    this.assertReceiving(before);
    if (offset !== before.receivedBytes) throw offsetMismatch(before.receivedBytes, offset);
    const allowedChunk = Math.min(UPLOAD_CHUNK_SIZE_BYTES, before.sizeBytes - offset);
    const stagedChunk = await this.storageService.streamToTemp(chunkStream as Readable, allowedChunk, { idleTimeoutMs: CHUNK_IDLE_TIMEOUT_MS });
    try {
      if (stagedChunk.sizeBytes === 0) throw uploadError.empty();
      if (checksum) {
        const normalized = normalizeChecksum(checksum);
        const actual = await sha256File(stagedChunk.tempPath);
        if (normalized !== actual) throw uploadError.checksumMismatch('Chunk checksum does not match');
      }

      return await this.withLock(id, async () => {
        let row = await this.owned(id, user);
        row = await this.reconcileSize(row);
        this.assertReceiving(row);
        if (offset !== row.receivedBytes) throw offsetMismatch(row.receivedBytes, offset);
        if (stagedChunk.sizeBytes > row.sizeBytes - row.receivedBytes) throw uploadError.tooLarge('Chunk exceeds the remaining upload size');
        if (row.receivedBytes === 0) await this.refuseUnreadableStart(row, stagedChunk);

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
        if (row.targetKind === 'book_request' && row.targetRequestFileId !== null) await this.reportRequestProgress(row);
        return this.toResponse(row);
      });
    } finally {
      await this.storageService.cleanup(stagedChunk.tempPath);
    }
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

      if (row.targetKind === 'book_request') return this.completeRequestFile(row, user);

      const format = this.validator.validateFormat(row.filename, await this.allowedFormats(row));
      await this.refuseUnreadable(row, () => this.validator.validateContent(row.stagingPath, format));
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
          // Checked again: the dock may have been turned off while the bytes were arriving.
          const dock = row.targetLibraryId ? await this.libraryDocks().resolveUploadDock(user, row.targetLibraryId, row.filename) : undefined;
          const fileId = await ingest.ingestUpload(row.filename, createReadStream(row.stagingPath), user.id, dock);
          row = (await this.repo.update(row.id, {
            status: 'completed',
            resultBookDockFileId: fileId,
            completedAt: new Date(),
          }))!;
          await this.storageService.cleanup(row.stagingPath);
        }
        return this.toResponse(row);
      } catch (error) {
        await this.failImport(row.id, error);
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

  /**
   * Ends the sessions still delivering these request files, because the attempt they belong to is
   * over. Each waits for its own lock, so a chunk in flight lands or fails before its file goes.
   */
  async cancelForRequestFiles(requestFileIds: number[]): Promise<void> {
    if (requestFileIds.length === 0) return;
    for (const row of await this.repo.findReceivingForRequestFiles(requestFileIds)) {
      await this.withLock(row.id, async () => {
        const current = await this.repo.findById(row.id);
        if (!current || current.status !== 'receiving') return;
        await this.repo.update(current.id, { status: 'cancelled', completedAt: new Date() });
        await this.storageService.cleanup(current.stagingPath);
      });
    }
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
      await this.failImport(row.id, error);
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
      await this.failImport(row.id, error);
    }
  }

  /**
   * A request file is checked against what the attempt declared rather than against a library's
   * formats: the import decides what the files become, and artwork and archives travel with them.
   * The contents are still checked wherever the extension names a format with a signature.
   */
  private async completeRequestFile(row: UploadSessionRow, user: RequestUser): Promise<UploadSessionResponse> {
    const format = this.validator.signatureFormatOf(row.filename);
    if (format) await this.refuseUnreadable(row, () => this.validator.validateContent(row.stagingPath, format));
    row = (await this.repo.update(row.id, { status: 'processing', errorCode: null, errorMessage: null }))!;
    try {
      if (row.targetRequestFileId === null) throw uploadError.invalidTarget('This upload is no longer expected');
      await this.requestReceiver().receive(row.targetRequestFileId, row.stagingPath, user);
      row = (await this.repo.update(row.id, { status: 'completed', completedAt: new Date() }))!;
      await this.storageService.cleanup(row.stagingPath);
      return this.toResponse(row);
    } catch (error) {
      await this.failImport(row.id, error);
      await this.storageService.cleanup(row.stagingPath);
      throw error;
    }
  }

  private async reportRequestProgress(row: UploadSessionRow): Promise<void> {
    try {
      await this.requestReceiver().progress(row.targetRequestFileId!, row.receivedBytes);
    } catch (error) {
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      this.logger.warn(
        `[upload_session.request_progress] [fail] sessionId=${row.id} requestFileId=${row.targetRequestFileId} errorClass=${error instanceof Error ? error.name : typeof error} error="${message}" - request upload progress was not recorded`,
      );
    }
  }

  private async validateTarget(target: UploadTarget, filename: string, user: RequestUser): Promise<void> {
    if (target.kind === 'book_request') return;
    if (target.kind === 'book_dock') {
      if (!this.hasPermission(user, Permission.BookDockAccess)) throw new ForbiddenException('Library Dock access is required');
      if (target.libraryId) await this.libraryDocks().resolveUploadDock(user, target.libraryId, filename);
      else this.validator.validateFormat(filename, []);
      return;
    }
    if (!this.hasPermission(user, Permission.LibraryUpload)) throw new ForbiddenException('Library upload permission is required');
    if (target.kind === 'library') {
      const library = await this.repo.findLibrary(target.libraryId);
      if (!library) throw uploadError.invalidTarget('Library not found');
      await this.libraryService.verifyAccess(user, library.id);
      libraryFilePolicy.assertWritable(library.id, library.readOnly);
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
    await this.libraryService.verifyAccess(user, book.libraryId);
    libraryFilePolicy.assertWritable(book.libraryId, book.readOnly);
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
    if (dto.target.kind === 'book_dock') return dto.target.libraryId ? { kind: 'book_dock', libraryId: dto.target.libraryId } : { kind: 'book_dock' };
    if (dto.target.kind === 'book_request' && dto.target.requestFileId) return { kind: 'book_request', requestFileId: dto.target.requestFileId };
    throw uploadError.invalidTarget('Upload target fields are invalid');
  }

  private async allowedFormats(row: UploadSessionRow): Promise<string[]> {
    if (row.targetKind === 'book_dock' && !row.targetLibraryId) return [];
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
      row.targetLibraryId === targetLibraryId(target) &&
      row.targetFolderId === (target.kind === 'library' ? (target.folderId ?? null) : null) &&
      row.targetBookId === (target.kind === 'existing_book' ? target.bookId : null) &&
      row.targetRequestFileId === (target.kind === 'book_request' ? target.requestFileId : null);
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

  /** Resolved lazily, like the ingest service: the Book Dock module imports this one. */
  private libraryDocks(): LibraryDockService {
    return this.moduleRef.get(LibraryDockService, { strict: false });
  }

  /** Provided by the book request module, which imports this one. */
  private requestReceiver(): RequestUploadReceiver {
    return this.moduleRef.get(RequestUploadReceiver, { strict: false });
  }

  private hasPermission(user: RequestUser, permission: Permission): boolean {
    return user.isSuperuser || user.permissions.includes(permission);
  }

  /**
   * A format's signature is in its first bytes, so a file that is not what its name says is refused
   * at its first chunk rather than after every byte has been sent.
   */
  private async refuseUnreadableStart(row: UploadSessionRow, chunk: { tempPath: string; sizeBytes: number }): Promise<void> {
    if (chunk.sizeBytes < CONTENT_SIGNATURE_BYTES && chunk.sizeBytes < row.sizeBytes) return;
    const format =
      row.targetKind === 'book_request' ? this.validator.signatureFormatOf(row.filename) : this.validator.validateFormat(row.filename, []);
    if (!format) return;
    await this.refuseUnreadable(row, () => this.validator.validateContent(chunk.tempPath, format));
  }

  /** Contents that do not match the format will not get better, so the session ends with them. */
  private async refuseUnreadable(row: UploadSessionRow, check: () => Promise<void>): Promise<void> {
    try {
      await check();
    } catch (error) {
      if (uploadErrorCodeOf(error) === UploadErrorCode.InvalidContent) {
        await this.fail(row.id, UploadErrorCode.InvalidContent, (error as HttpException).message);
        await this.storageService.cleanup(row.stagingPath);
      }
      throw error;
    }
  }

  /**
   * Stores why an import failed. A coded upload error keeps its code and its message, which are
   * written for the client. Anything else is stored as an import failure with a fixed message,
   * because a raw exception message can carry server paths; the raw error goes to the log.
   */
  private async failImport(id: string, error: unknown): Promise<void> {
    const code = uploadErrorCodeOf(error);
    if (code) {
      await this.fail(id, code, (error as HttpException).message);
      return;
    }
    const errorClass = error instanceof Error ? error.name : typeof error;
    const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
    this.logger.warn(`[upload_session.import] [fail] sessionId=${id} errorClass=${errorClass} error="${message}" - upload import failed`);
    await this.fail(id, UploadErrorCode.ImportFailed, IMPORT_FAILED_MESSAGE);
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
      target: responseTarget(row),
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

function responseTarget(row: UploadSessionRow): UploadTarget {
  switch (row.targetKind) {
    case 'library':
      return { kind: 'library', libraryId: row.targetLibraryId!, ...(row.targetFolderId ? { folderId: row.targetFolderId } : {}) };
    case 'existing_book':
      return { kind: 'existing_book', bookId: row.targetBookId! };
    case 'book_request':
      // The manifest entry outlives nothing it belongs to, so a session can outlive the entry.
      return { kind: 'book_request', requestFileId: row.targetRequestFileId ?? 0 };
    default:
      return { kind: 'book_dock', ...(row.targetLibraryId ? { libraryId: row.targetLibraryId } : {}) };
  }
}

/** The library a session is for: a library upload's, or a library dock's. */
function targetLibraryId(target: UploadTarget): number | null {
  if (target.kind === 'library') return target.libraryId;
  if (target.kind === 'book_dock') return target.libraryId ?? null;
  return null;
}

/** A session a repeated create may hand back: still able to take bytes, importing, or added. */
function isResumable(row: UploadSessionRow): boolean {
  if (row.status === 'processing' || row.status === 'completed') return true;
  return row.status === 'receiving' && row.expiresAt.getTime() > Date.now();
}

function offsetMismatch(expectedOffset: number, offset: number): ConflictException {
  return new ConflictException({
    errorCode: UploadErrorCode.OffsetMismatch,
    message: `Expected upload offset ${expectedOffset}, received ${offset}`,
    expectedOffset,
  });
}

function uploadErrorCodeOf(error: unknown): UploadErrorCode | null {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  const code = typeof response === 'object' && response !== null ? (response as { errorCode?: unknown }).errorCode : undefined;
  return (Object.values(UploadErrorCode) as unknown[]).includes(code) ? (code as UploadErrorCode) : null;
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
