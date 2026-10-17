import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Permission, UploadErrorCode } from '@bookorbit/types';
import { createHash } from 'crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { uploadError } from './upload-errors';
import { UploadSessionService } from './upload-session.service';
import { UploadValidatorService } from './upload-validator.service';

describe('UploadSessionService', () => {
  let root: string;
  let service: UploadSessionService;
  let rows: Map<string, any>;
  let repo: Record<string, any>;
  let storage: Record<string, any>;
  let upload: Record<string, any>;
  let library: Record<string, any>;
  const validator = new UploadValidatorService();
  const user = { id: 7, isSuperuser: false, permissions: [Permission.LibraryUpload, Permission.BookDockAccess] } as any;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-upload-session-test-'));
    await mkdir(join(root, 'upload-sessions'), { recursive: true });
    rows = new Map();
    repo = {
      findByIdempotencyKey: vi.fn(
        (userId: number, key: string) => [...rows.values()].find((row) => row.userId === userId && row.idempotencyKey === key) ?? null,
      ),
      // Enforces upload_sessions_user_idempotency_uidx, as Postgres does. Without it a test could
      // pass by making a second session under a key the database would refuse.
      create: vi.fn((values: any) => {
        if ([...rows.values()].some((row) => row.userId === values.userId && row.idempotencyKey === values.idempotencyKey)) {
          throw new Error('duplicate key value violates unique constraint "upload_sessions_user_idempotency_uidx"');
        }
        const row = makeRow(values);
        rows.set(row.id, row);
        return row;
      }),
      releaseIdempotencyKey: vi.fn((id: string) => {
        rows.set(id, { ...rows.get(id), idempotencyKey: `#released-${id}` });
      }),
      findById: vi.fn((id: string) => rows.get(id) ?? null),
      update: vi.fn((id: string, values: any) => {
        const current = rows.get(id);
        if (!current) return null;
        const updated = { ...current, ...values, updatedAt: new Date() };
        rows.set(id, updated);
        return updated;
      }),
      findProcessing: vi.fn(() => []),
      findExpiredReceiving: vi.fn(() => []),
      deleteTerminalBefore: vi.fn(() => undefined),
      findCapabilityLibraries: vi.fn(() => [{ id: 1, name: 'Main', allowedFormats: ['epub', 'pdf'], organizationMode: 'book_per_folder' }]),
      findCapabilityFolders: vi.fn(() => [{ id: 2, libraryId: 1, path: '/books/Main Shelf' }]),
      findLibrary: vi.fn((id: number) => {
        if (id === 1) return { id: 1, type: 'books', allowedFormats: ['epub', 'pdf'], organizationMode: 'book_per_folder' };
        if (id === 3) return { id: 3, type: 'podcasts', allowedFormats: [], organizationMode: 'book_per_folder' };
        return null;
      }),
      folderBelongsToLibrary: vi.fn((folderId: number, libraryId: number) => folderId === 2 && libraryId === 1),
      // Book 9's folder is a real directory; book 8's "folder" is a file, which is the shape that
      // reached `complete` and threw ENOTDIR before validateTarget checked it. See F-006.
      findBookTarget: vi.fn((id: number) => {
        if (id === 9) {
          return {
            id: 9,
            libraryId: 1,
            libraryType: 'books',
            allowedFormats: ['epub', 'pdf'],
            organizationMode: 'book_per_folder',
            folderPath: root,
          };
        }
        if (id === 8) {
          return {
            id: 8,
            libraryId: 1,
            libraryType: 'books',
            allowedFormats: ['epub', 'pdf'],
            organizationMode: 'book_per_folder',
            folderPath: join(root, 'a-book-that-is-a-file.cbz'),
          };
        }
        return null;
      }),
      findBookLibraryId: vi.fn(() => 1),
      findLibraryAllowedFormats: vi.fn(() => ['epub', 'pdf']),
      findPrimaryBookFile: vi.fn(() => null),
    };
    storage = {
      streamToTemp: vi.fn(),
      cleanup: vi.fn(async (path: string) => rm(path, { force: true })),
    };
    upload = {
      uploadForSession: vi.fn(),
      processStoredUpload: vi.fn(() => undefined),
      addFileToBook: vi.fn(() => ({ id: 22 })),
    };
    library = {
      findAccessibleLibraryIds: vi.fn(() => [1]),
      verifyUserAccess: vi.fn(() => undefined),
    };
    service = new UploadSessionService(
      { appDataPath: root } as any,
      repo as any,
      { getMaxUploadSizeMb: vi.fn(() => 500) } as any,
      library as any,
      validator,
      storage as any,
      upload as any,
      { processNewBookImport: vi.fn(() => undefined) } as any,
      { get: vi.fn() } as any,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns permission-scoped capabilities with safe folder display names', async () => {
    const result = await service.capabilities(user);

    expect(result.canUploadToLibrary).toBe(true);
    expect(result.canUseBookDock).toBe(true);
    expect(result.chunkSizeBytes).toBe(16 * 1_024 * 1_024);
    expect(result.libraries[0]?.folders).toEqual([{ id: 2, name: 'Main Shelf' }]);

    const denied = await service.capabilities({ ...user, permissions: [] });
    expect(denied.libraries).toEqual([]);
  });

  it('creates an empty durable staging file and reuses a matching idempotency key', async () => {
    const dto = createDto();
    const first = await service.create(dto, user);
    const second = await service.create(dto, user);

    expect(second.id).toBe(first.id);
    expect(repo.create).toHaveBeenCalledTimes(1);
    expect(await readFile(rows.get(first.id).stagingPath)).toHaveLength(0);
  });

  it('creates a new session when the key belongs to an expired one', async () => {
    const dto = createDto();
    const first = await service.create(dto, user);
    rows.set(first.id, { ...rows.get(first.id), expiresAt: new Date(Date.now() - 60_000) });

    const second = await service.create(dto, user);

    // The client's idempotency key is its queue record's own id and does not change when it
    // retries, so returning the expired session here left Retry unable to ever succeed: the next
    // chunk failed assertReceiving with the very error the retry was escaping. See F-007.
    expect(second.id).not.toBe(first.id);
    expect(repo.create).toHaveBeenCalledTimes(2);
  });

  it.each(['failed', 'cancelled', 'expired'])('creates a new session when the key belongs to a %s one, keeping its outcome', async (status) => {
    const dto = createDto();
    const first = await service.create(dto, user);
    rows.set(first.id, { ...rows.get(first.id), status, errorCode: UploadErrorCode.ImportFailed });

    // Even for different details: the dead session no longer claims the key.
    const second = await service.create({ ...dto, sizeBytes: 11 }, user);

    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('receiving');
    expect(rows.get(first.id)).toMatchObject({ status, errorCode: UploadErrorCode.ImportFailed, idempotencyKey: `#released-${first.id}` });
  });

  it.each(['processing', 'completed'])('hands back a %s session under its key rather than uploading twice', async (status) => {
    const dto = createDto();
    const first = await service.create(dto, user);
    rows.set(first.id, { ...rows.get(first.id), status });

    const second = await service.create(dto, user);

    expect(second.id).toBe(first.id);
    expect(repo.releaseIdempotencyKey).not.toHaveBeenCalled();
  });

  it('rejects an existing_book target whose folder path is a file', async () => {
    await writeFile(join(root, 'a-book-that-is-a-file.cbz'), 'not a directory');

    // Rejected at create, before a byte moves. Without the check the session was created, the whole
    // file was transferred, and complete threw ENOTDIR: not a coded upload error, so the filter
    // reported a 500 and persisted the absolute server path into errorMessage where the client
    // reads it. isRetryable then treats the 5xx as retryable and re-sends the file against a
    // condition that cannot improve. See F-006.
    await expect(service.create({ ...createDto(), target: { kind: 'existing_book', bookId: 8 } } as any, user)).rejects.toMatchObject({
      response: { errorCode: UploadErrorCode.InvalidTarget },
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('accepts an existing_book target whose folder path is a directory', async () => {
    await expect(service.create({ ...createDto(), target: { kind: 'existing_book', bookId: 9 } } as any, user)).resolves.toBeDefined();
  });

  it('rejects idempotency-key reuse with different upload details', async () => {
    const dto = createDto();
    await service.create(dto, user);

    await expect(service.create({ ...dto, sizeBytes: 11 }, user)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a library that does not hold books', async () => {
    await expect(service.create({ ...createDto(), target: { kind: 'library', libraryId: 3 } } as any, user)).rejects.toMatchObject({
      response: { errorCode: UploadErrorCode.InvalidTarget },
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('enforces upload permission and library-folder ownership before creating files', async () => {
    await expect(service.create(createDto(), { ...user, permissions: [] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create({ ...createDto(), target: { kind: 'library', libraryId: 1, folderId: 99 } } as any, user)).rejects.toMatchObject({
      response: { errorCode: UploadErrorCode.InvalidTarget },
    });
  });

  it('appends a checksummed chunk at the exact offset and reconciles durable byte count', async () => {
    const response = await service.create(createDto(), user);
    const chunk = Buffer.from('%PDF-1234');
    const chunkPath = join(root, 'chunk');
    await writeFile(chunkPath, chunk);
    storage.streamToTemp.mockResolvedValue({ tempPath: chunkPath, sizeBytes: chunk.length });
    const checksum = createHash('sha256').update(chunk).digest('hex');

    const result = await service.appendChunk(response.id, 0, `sha256 ${checksum}`, Readable.from(chunk), user);

    expect(result.receivedBytes).toBe(chunk.length);
    expect(await readFile(rows.get(response.id).stagingPath)).toEqual(chunk);
    await expect(service.appendChunk(response.id, 0, undefined, Readable.from('x'), user)).rejects.toMatchObject({
      response: { errorCode: UploadErrorCode.OffsetMismatch, expectedOffset: chunk.length },
    });
  });

  it('rejects a bad checksum without mutating the session staging file', async () => {
    const response = await service.create(createDto(), user);
    const chunkPath = join(root, 'bad-chunk');
    await writeFile(chunkPath, '%PDF-1234');
    storage.streamToTemp.mockResolvedValue({ tempPath: chunkPath, sizeBytes: 9 });

    await expect(service.appendChunk(response.id, 0, '0'.repeat(64), Readable.from('ignored'), user)).rejects.toMatchObject({
      response: { errorCode: UploadErrorCode.ChecksumMismatch },
    });
    expect(await readFile(rows.get(response.id).stagingPath)).toHaveLength(0);
  });

  it('reads a chunk before taking the session lock, so a stalled chunk does not hold up the next', async () => {
    const response = await service.create(createDto(), user);
    const chunkPath = join(root, 'chunk');
    await writeFile(chunkPath, '%PDF-1234');
    storage.streamToTemp.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce({ tempPath: chunkPath, sizeBytes: 9 });

    void service.appendChunk(response.id, 0, undefined, Readable.from('stalled'), user);
    const result = await service.appendChunk(response.id, 0, undefined, Readable.from('%PDF-1234'), user);

    expect(result.receivedBytes).toBe(9);
  });

  it('refuses contents that do not match the format at the first chunk and ends the session', async () => {
    const response = await service.create({ ...createDto(), sizeBytes: 1_024 }, user);
    const chunkPath = join(root, 'not-a-pdf');
    await writeFile(chunkPath, Buffer.alloc(600, 0x41));
    storage.streamToTemp.mockResolvedValue({ tempPath: chunkPath, sizeBytes: 600 });

    await expect(service.appendChunk(response.id, 0, undefined, Readable.from('ignored'), user)).rejects.toMatchObject({
      response: { errorCode: UploadErrorCode.InvalidContent },
    });
    expect(rows.get(response.id)).toMatchObject({ status: 'failed', errorCode: UploadErrorCode.InvalidContent, receivedBytes: 0 });
    expect(storage.cleanup).toHaveBeenCalledWith(rows.get(response.id).stagingPath);
  });

  it('leaves a first chunk shorter than the signature for complete to judge', async () => {
    const response = await service.create({ ...createDto(), sizeBytes: 1_024 }, user);
    const chunkPath = join(root, 'short');
    await writeFile(chunkPath, 'AAAA');
    storage.streamToTemp.mockResolvedValue({ tempPath: chunkPath, sizeBytes: 4 });

    await expect(service.appendChunk(response.id, 0, undefined, Readable.from('AAAA'), user)).resolves.toMatchObject({ receivedBytes: 4 });
  });

  it('ends the session when complete refuses its contents', async () => {
    const response = await service.create({ ...createDto(), sizeBytes: 9 }, user);
    const row = rows.get(response.id);
    await writeFile(row.stagingPath, 'AAAAAAAAA');
    rows.set(response.id, { ...row, receivedBytes: 9 });

    await expect(service.complete(response.id, user)).rejects.toMatchObject({ response: { errorCode: UploadErrorCode.InvalidContent } });
    expect(rows.get(response.id)).toMatchObject({ status: 'failed', errorCode: UploadErrorCode.InvalidContent });
  });

  it('stores the code an import failed with, and never a raw exception message', async () => {
    const conflict = await service.create({ ...createDto(), sizeBytes: 9, idempotencyKey: 'upload-key-conflict' }, user);
    const raw = await service.create({ ...createDto(), sizeBytes: 9, idempotencyKey: 'upload-key-raw' }, user);
    for (const id of [conflict.id, raw.id]) {
      await writeFile(rows.get(id).stagingPath, '%PDF-1234');
      rows.set(id, { ...rows.get(id), receivedBytes: 9 });
    }
    upload.uploadForSession
      .mockRejectedValueOnce(uploadError.destinationConflict('A file named "book.pdf" already exists at the target location'))
      .mockRejectedValueOnce(new Error("ENOTDIR: not a directory, open '/library/Some Book/book.pdf'"));

    await expect(service.complete(conflict.id, user)).rejects.toMatchObject({ response: { errorCode: UploadErrorCode.DestinationConflict } });
    await expect(service.complete(raw.id, user)).rejects.toThrow('ENOTDIR');

    expect(rows.get(conflict.id)).toMatchObject({
      status: 'failed',
      errorCode: UploadErrorCode.DestinationConflict,
      errorMessage: 'A file named "book.pdf" already exists at the target location',
    });
    expect(rows.get(raw.id)).toMatchObject({
      status: 'failed',
      errorCode: UploadErrorCode.ImportFailed,
      errorMessage: 'The file could not be added',
    });
  });

  it('will not complete a partial upload', async () => {
    const response = await service.create(createDto(), user);
    await expect(service.complete(response.id, user)).rejects.toMatchObject({
      response: { errorCode: UploadErrorCode.SessionStateInvalid },
    });
  });

  it('validates and adds a completed session to an existing book', async () => {
    const dto = { ...createDto(), sizeBytes: 9, target: { kind: 'existing_book', bookId: 9 } } as any;
    const response = await service.create(dto, user);
    const row = rows.get(response.id);
    await writeFile(row.stagingPath, '%PDF-1234');
    rows.set(response.id, { ...row, receivedBytes: 9 });

    const result = await service.complete(response.id, user);

    expect(upload.addFileToBook).toHaveBeenCalledWith(9, 'book.pdf', expect.anything(), user);
    expect(result.status).toBe('completed');
    expect(result.bookId).toBe(9);
  });

  it('hides sessions owned by another account and refuses cancellation during processing', async () => {
    const response = await service.create(createDto(), user);
    await expect(service.get(response.id, { ...user, id: 8 })).rejects.toBeInstanceOf(NotFoundException);
    rows.set(response.id, { ...rows.get(response.id), status: 'processing' });
    await expect(service.cancel(response.id, user)).rejects.toMatchObject({
      response: { errorCode: UploadErrorCode.SessionStateInvalid },
    });
  });

  it('expires abandoned sessions and removes their staged bytes', async () => {
    const response = await service.create(createDto(), user);
    const row = rows.get(response.id);
    repo.findExpiredReceiving.mockResolvedValue([row]);

    await service.cleanupExpired();

    expect(rows.get(response.id).status).toBe('expired');
    expect(storage.cleanup).toHaveBeenCalledWith(row.stagingPath);
    expect(repo.deleteTerminalBefore).toHaveBeenCalledOnce();
  });

  function createDto() {
    return {
      filename: 'book.pdf',
      sizeBytes: 10,
      idempotencyKey: 'upload-key-123',
      target: { kind: 'library', libraryId: 1, folderId: 2 },
    } as any;
  }

  function makeRow(values: any) {
    const now = new Date();
    return {
      receivedBytes: 0,
      status: 'receiving',
      expectedSha256: null,
      errorCode: null,
      errorMessage: null,
      resultBookId: null,
      resultBookDockFileId: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
      ...values,
    };
  }
});
