import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { Permission } from '@bookorbit/types';

import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
import { BookDockController } from './book-dock.controller';

vi.mock('fs', () => ({
  createReadStream: vi.fn(() => ({ kind: 'stream' })),
}));

vi.mock('fs/promises', () => ({
  access: vi.fn(),
}));

vi.mock('../../common/image-content-type', () => ({
  imageContentTypeFromPath: vi.fn(() => 'image/jpeg'),
}));

import { access } from 'fs/promises';
import { createReadStream } from 'fs';

function makeController() {
  const service = {
    listFiles: vi.fn(),
    getSummary: vi.fn(),
    getStatistics: vi.fn(),
    getFile: vi.fn(),
    updateFile: vi.fn(),
    discardFile: vi.fn(),
    bulkDiscard: vi.fn(),
    bulkApplyFetched: vi.fn(),
    bulkRetryFetch: vi.fn(),
    bulkSetTarget: vi.fn(),
    selectionSummary: vi.fn(),
    bulkEdit: vi.fn(),
    pauseProcessing: vi.fn(),
    resumeProcessing: vi.fn(),
  };
  const ingestService = { ingestUpload: vi.fn() };
  const finalizeService = { previewNames: vi.fn(), previewFinalize: vi.fn(), discardDuplicateCandidates: vi.fn(), finalize: vi.fn() };
  const watcherService = { rescan: vi.fn() };
  const repo = { findById: vi.fn() };
  const appSettings = { getMaxUploadSizeMb: vi.fn().mockResolvedValue(500) };

  const controller = new BookDockController(
    service as never,
    ingestService as never,
    finalizeService as never,
    watcherService as never,
    repo as never,
    appSettings as never,
  );

  return { controller, service, ingestService, finalizeService, watcherService, repo, appSettings };
}

const MOCK_USER = { id: 1, isSuperuser: false } as any;

describe('BookDockController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listFiles applies defaults before delegating', async () => {
    const { controller, service } = makeController();
    service.listFiles.mockResolvedValue({ items: [], total: 0, page: 1, size: 20 });

    await controller.listFiles(MOCK_USER, {});

    expect(service.listFiles).toHaveBeenCalledWith({
      status: undefined,
      page: 1,
      limit: 20,
      sort: 'createdAt',
      order: 'desc',
      search: undefined,
      userId: MOCK_USER.id,
      isSuperuser: MOCK_USER.isSuperuser,
    });
  });

  it('getCover throws when file has no cover path or cover file does not exist', async () => {
    const { controller, repo } = makeController();
    const reply = { header: vi.fn(), send: vi.fn() } as any;

    repo.findById.mockResolvedValueOnce({ id: 1, coverPath: null });
    await expect(controller.getCover(1, reply)).rejects.toBeInstanceOf(NotFoundException);

    repo.findById.mockResolvedValueOnce({ id: 1, coverPath: '/covers/1.jpg' });
    vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'));
    await expect(controller.getCover(1, reply)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getCover streams cover bytes with proper headers', async () => {
    const { controller, repo } = makeController();
    repo.findById.mockResolvedValue({ id: 1, coverPath: '/covers/1.jpg' });
    vi.mocked(access).mockResolvedValue(undefined as never);
    const reply = {
      header: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as any;

    await controller.getCover(1, reply);

    expect(createReadStream).toHaveBeenCalledWith('/covers/1.jpg');
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/jpeg');
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'private, max-age=3600');
    expect(reply.send).toHaveBeenCalledWith({ kind: 'stream' });
  });

  it('upload rejects requests with no multipart file', async () => {
    const { controller } = makeController();
    const req = {
      file: vi.fn().mockResolvedValue(null),
    } as any;

    await expect(controller.upload(MOCK_USER, req)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('upload ingests file and returns hydrated row', async () => {
    const { controller, ingestService, service } = makeController();
    const req = {
      file: vi.fn().mockResolvedValue({
        filename: 'book.epub',
        file: Readable.from('book'),
      }),
    } as any;
    ingestService.ingestUpload.mockResolvedValue(44);
    service.getFile.mockResolvedValue({ id: 44, fileName: 'book.epub' });

    await expect(controller.upload(MOCK_USER, req)).resolves.toEqual({ id: 44, fileName: 'book.epub' });
    expect(ingestService.ingestUpload).toHaveBeenCalledWith('book.epub', expect.any(Readable), MOCK_USER.id);
    expect(service.getFile).toHaveBeenCalledWith(44);
  });

  it('bulk and finalize endpoints delegate payload fields as expected', async () => {
    const { controller, service, finalizeService, watcherService } = makeController();

    await controller.bulkDiscard(MOCK_USER, { fileIds: [1], selectAll: false, excludedIds: [2], status: 'error', search: 'x' });
    await controller.applyFetched(MOCK_USER, { fileIds: [1], selectAll: true, excludedIds: [2], status: 'ready', search: 'x' });
    await controller.retryFetch(MOCK_USER, { fileIds: [3], selectAll: false, excludedIds: [4], status: 'error', search: 'y' });
    await controller.setTarget(MOCK_USER, {
      fileIds: [5],
      selectAll: false,
      excludedIds: [6],
      targetLibraryId: undefined,
      targetFolderId: undefined,
    });
    await controller.selectionSummary(MOCK_USER, { fileIds: [7], selectAll: false, excludedIds: [8] });
    await controller.bulkEdit(MOCK_USER, {
      fileIds: [9],
      selectAll: false,
      excludedIds: [],
      fields: { title: 'Edited' },
      enabledFields: ['title'],
      mergeArrays: false,
    } as any);
    await controller.previewNames(MOCK_USER, { fileIds: [10], selectAll: false, excludedIds: [], defaultLibraryId: 2 } as any);
    await controller.previewFinalize(MOCK_USER, {
      fileIds: [10],
      selectAll: false,
      excludedIds: [],
      defaultLibraryId: 2,
      defaultFolderId: 3,
      overrides: [],
    } as any);
    await controller.discardFinalizeDuplicates(MOCK_USER, {
      fileIds: [10],
      selectAll: false,
      excludedIds: [],
      defaultLibraryId: 2,
      defaultFolderId: 3,
      overrides: [],
    } as any);
    await controller.finalize(
      { id: 99, isSuperuser: true } as any,
      { fileIds: [1], defaultLibraryId: 2, defaultFolderId: 3, selectAll: false, excludedIds: [], overrides: [] } as any,
    );
    await controller.rescan();
    await controller.pause();
    await controller.resume();

    expect(service.bulkSetTarget).toHaveBeenCalledWith([5], false, [6], null, null, undefined, undefined, MOCK_USER.id, MOCK_USER.isSuperuser);
    expect(finalizeService.previewNames).toHaveBeenCalledWith([10], false, [], 2, MOCK_USER.id, MOCK_USER.isSuperuser, undefined, undefined);
    expect(finalizeService.previewFinalize).toHaveBeenCalledWith(1, false, [10], false, [], 2, 3, [], undefined, undefined);
    expect(finalizeService.discardDuplicateCandidates).toHaveBeenCalledWith(1, false, [10], false, [], 2, 3, [], undefined, undefined);
    expect(finalizeService.finalize).toHaveBeenCalledWith(99, true, [1], false, [], 2, 3, [], undefined, undefined);
    expect(watcherService.rescan).toHaveBeenCalled();
    expect(service.pauseProcessing).toHaveBeenCalledTimes(1);
    expect(service.resumeProcessing).toHaveBeenCalledTimes(1);
  });

  it('marks bulk edit endpoint as demo-restricted', () => {
    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, BookDockController.prototype.bulkEdit)).toEqual({
      permission: Permission.DemoRestricted,
      message: 'Demo-restricted account cannot perform bulk edits',
    });
    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, BookDockController.prototype.finalize)).toBeUndefined();
  });
});
