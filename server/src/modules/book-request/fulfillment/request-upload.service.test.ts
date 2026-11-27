import { BadRequestException } from '@nestjs/common';
import { UploadErrorCode } from '@bookorbit/types';
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadValidatorService } from '../../upload/upload-validator.service';
import { BOOK_REQUEST_DOWNLOAD_FAILED, BOOK_REQUEST_UPLOAD_ARRIVED, BookRequestEventsService } from '../book-request-events.service';
import { RequestAlreadyClaimedException } from './request-fulfillment.service';
import { RequestUploadService } from './request-upload.service';

const MB = 1024 * 1024;

describe('RequestUploadService', () => {
  let root: string;
  let request: Record<string, any>;
  let downloads: Map<number, any>;
  let files: Map<number, any>;
  let service: RequestUploadService;
  let events: BookRequestEventsService;
  const requestsRepo = {
    findById: vi.fn(() => ({ request })),
    claimForGrab: vi.fn(() => 'claimed'),
    updateIf: vi.fn((_id: number, _from: unknown, patch: Record<string, unknown>) => {
      Object.assign(request, patch);
      return request;
    }),
    clearDismissals: vi.fn(() => undefined),
    findRequestViewerIds: vi.fn(() => new Map([[5, [3]]])),
  };
  const gateway = { emitChanged: vi.fn(), emitProgress: vi.fn() };
  const storage = { directoryFor: (id: number) => join(root, String(id)), discard: vi.fn(() => undefined) };
  const user = { id: 3, username: 'neon', isSuperuser: true, permissions: [] } as any;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'bookorbit-request-upload-'));
    request = { id: 5, status: 'failed', title: 'The Silent Patient', mediaKind: 'audiobook', targetLibraryId: 2 };
    downloads = new Map();
    files = new Map();
    events = new BookRequestEventsService();
    vi.clearAllMocks();

    const downloadsRepo = {
      create: vi.fn((values: any) => {
        const row = { id: downloads.size + 100, progressPercent: 0, downloadedBytes: 0, contentPath: null, createdAt: new Date(), ...values };
        downloads.set(row.id, row);
        return row;
      }),
      update: vi.fn((id: number, patch: any) => {
        const row = { ...downloads.get(id), ...patch };
        downloads.set(id, row);
        return row;
      }),
      updateIf: vi.fn((id: number, from: readonly string[], patch: any) => {
        const row = downloads.get(id);
        if (!row || !from.includes(row.status)) return undefined;
        const next = { ...row, ...patch };
        downloads.set(id, next);
        return next;
      }),
      findById: vi.fn((id: number) => downloads.get(id)),
      findLatestForRequests: vi.fn(() => {
        const latest = [...downloads.values()].pop();
        return new Map(latest ? [[5, { download: latest }]] : []);
      }),
    };
    const filesRepo = {
      createMany: vi.fn((rows: any[]) =>
        rows.map((values, index) => {
          const row = { id: 40 + index, receivedBytes: 0, status: 'pending', ...values };
          files.set(row.id, row);
          return row;
        }),
      ),
      findForDownload: vi.fn((id: number) => [...files.values()].filter((file) => file.downloadId === id)),
      findWithAttempt: vi.fn((id: number) => {
        const file = files.get(id);
        return file ? { file, download: downloads.get(file.downloadId) } : undefined;
      }),
      recordProgress: vi.fn((id: number, receivedBytes: number) => {
        const file = files.get(id);
        if (!file || file.status !== 'pending' || file.receivedBytes >= receivedBytes) return false;
        file.receivedBytes = Math.min(receivedBytes, file.sizeBytes);
        return true;
      }),
      markReceived: vi.fn((id: number) => {
        const file = files.get(id);
        if (!file || file.status !== 'pending') return undefined;
        Object.assign(file, { status: 'received', receivedBytes: file.sizeBytes });
        return file;
      }),
      totals: vi.fn((id: number) => {
        const rows = [...files.values()].filter((file) => file.downloadId === id);
        return {
          fileCount: rows.length,
          receivedCount: rows.filter((file) => file.status === 'received').length,
          receivedBytes: rows.reduce((sum, file) => sum + file.receivedBytes, 0),
          totalBytes: rows.reduce((sum, file) => sum + file.sizeBytes, 0),
        };
      }),
    };

    service = new RequestUploadService(
      requestsRepo as never,
      downloadsRepo as never,
      filesRepo as never,
      storage as never,
      { getMaxUploadSizeMb: vi.fn(() => 4096) } as never,
      new UploadValidatorService(),
      gateway as never,
      events,
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const album = [
    { path: 'The Silent Patient/01.mp3', sizeBytes: 4 },
    { path: 'The Silent Patient/02.mp3', sizeBytes: 4 },
    { path: 'The Silent Patient/cover.jpg', sizeBytes: 3 },
  ];

  it('starts an upload attempt that claims the request and declares every file', async () => {
    const manifest = await service.start(5, album, true, user);

    const download = downloads.get(manifest.downloadId);
    expect(requestsRepo.claimForGrab).toHaveBeenCalledWith(5, ['approved', 'searching', 'failed']);
    expect(download).toMatchObject({
      source: 'upload',
      downloadClientId: null,
      uploadedByUserId: 3,
      holdForReview: true,
      status: 'downloading',
      totalBytes: 11,
      releaseTitle: 'The Silent Patient',
      contentPath: join(root, String(manifest.downloadId), 'The Silent Patient'),
    });
    expect(manifest.files.map((file) => file.path)).toEqual(['01.mp3', '02.mp3', 'cover.jpg']);
    expect(request.status).toBe('downloading');
    expect((await stat(download.contentPath)).isDirectory()).toBe(true);
  });

  it('refuses to start with files the plan would leave out', async () => {
    await expect(service.start(5, [...album, { path: 'The Silent Patient/.DS_Store', sizeBytes: 6 }], false, user)).rejects.toThrow(
      'Leave out the files the upload does not use',
    );
    expect(requestsRepo.claimForGrab).not.toHaveBeenCalled();
  });

  it('refuses files that could never close the request', async () => {
    await expect(service.start(5, [{ path: 'Book.epub', sizeBytes: MB }], false, user)).rejects.toThrow(BadRequestException);
  });

  it('refuses a request that is not waiting for a release', async () => {
    request.status = 'available';
    await expect(service.plan(5, album)).rejects.toThrow('cannot take an upload');
  });

  it('refuses when another release already holds the request', async () => {
    requestsRepo.claimForGrab.mockResolvedValueOnce('moved');
    await expect(service.start(5, album, false, user)).rejects.toThrow(RequestAlreadyClaimedException);
  });

  it('admits only the declared file, by name and size, from the person who started the upload', async () => {
    const manifest = await service.start(5, album, false, user);
    const first = manifest.files[0]!.id;

    await expect(service.admit(first, '01.mp3', 4, user)).resolves.toBeUndefined();
    await expect(service.admit(first, '02.mp3', 4, user)).rejects.toMatchObject({ response: { errorCode: UploadErrorCode.InvalidTarget } });
    await expect(service.admit(first, '01.mp3', 5, user)).rejects.toMatchObject({ response: { errorCode: UploadErrorCode.InvalidTarget } });
    await expect(service.admit(first, '01.mp3', 4, { ...user, id: 9 })).rejects.toThrow('Only the person who started this upload');
    await expect(service.admit(999, '01.mp3', 4, user)).rejects.toThrow('no longer expected');
  });

  it('moves each file into the attempt and imports once the last one lands', async () => {
    const manifest = await service.start(5, album, false, user);
    const arrived = vi.fn();
    events.on(BOOK_REQUEST_UPLOAD_ARRIVED, arrived);

    for (const [index, file] of manifest.files.entries()) {
      const staged = join(root, `session-${index}.upload`);
      await writeFile(staged, 'x'.repeat(file.sizeBytes));
      await service.receive(file.id, staged, user);
      if (index < manifest.files.length - 1) expect(arrived).not.toHaveBeenCalled();
    }

    const download = downloads.get(manifest.downloadId);
    expect(download).toMatchObject({ status: 'completed', progressPercent: 100, downloadedBytes: 11 });
    expect(await readFile(join(download.contentPath, '02.mp3'), 'utf8')).toBe('xxxx');
    expect(arrived).toHaveBeenCalledWith(manifest.downloadId);
  });

  it('reports bytes as they arrive without ever reading as finished', async () => {
    const manifest = await service.start(5, album, false, user);

    await service.progress(manifest.files[0]!.id, 4);
    await service.progress(manifest.files[0]!.id, 2);

    const download = downloads.get(manifest.downloadId);
    expect(download.downloadedBytes).toBe(4);
    expect(download.progressPercent).toBe(36);
    expect(gateway.emitProgress).toHaveBeenCalledWith(expect.objectContaining({ requestId: 5, downloadedBytes: 4, totalBytes: 11 }), [3], false);
  });

  it('turns away a file for an upload that was cancelled', async () => {
    const manifest = await service.start(5, album, false, user);
    downloads.set(manifest.downloadId, { ...downloads.get(manifest.downloadId), status: 'failed' });
    const staged = join(root, 'late.upload');
    await writeFile(staged, 'xxxx');

    await expect(service.receive(manifest.files[0]!.id, staged, user)).rejects.toThrow('This upload has ended');
  });

  it('drops the files of an upload attempt that failed', async () => {
    const manifest = await service.start(5, album, false, user);
    service.onModuleInit();

    events.emit(BOOK_REQUEST_DOWNLOAD_FAILED, manifest.downloadId);
    await vi.waitFor(() => expect(storage.discard).toHaveBeenCalledWith(expect.objectContaining({ id: manifest.downloadId })));
    service.onModuleDestroy();
  });

  it('reads back the running upload for a page that lost track of it', async () => {
    const manifest = await service.start(5, album, false, user);

    await expect(service.manifest(5)).resolves.toMatchObject({ downloadId: manifest.downloadId, uploadedByUserId: 3, files: expect.any(Array) });
    downloads.set(manifest.downloadId, { ...downloads.get(manifest.downloadId), status: 'completed' });
    await expect(service.manifest(5)).resolves.toBeNull();
  });
});
