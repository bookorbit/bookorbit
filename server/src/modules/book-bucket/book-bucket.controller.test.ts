import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';

import { BookBucketController } from './book-bucket.controller';

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
  };
  const ingestService = { ingestUpload: vi.fn() };
  const finalizeService = { previewNames: vi.fn(), finalize: vi.fn() };
  const watcherService = { rescan: vi.fn() };
  const repo = { findById: vi.fn() };

  const controller = new BookBucketController(
    service as never,
    ingestService as never,
    finalizeService as never,
    watcherService as never,
    repo as never,
  );

  return { controller, service, ingestService, finalizeService, watcherService, repo };
}

describe('BookBucketController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listFiles applies defaults before delegating', async () => {
    const { controller, service } = makeController();
    service.listFiles.mockResolvedValue({ items: [], total: 0, page: 1, size: 20 });

    await controller.listFiles({});

    expect(service.listFiles).toHaveBeenCalledWith({
      status: undefined,
      page: 1,
      limit: 20,
      sort: 'createdAt',
      order: 'desc',
      search: undefined,
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

    await expect(controller.upload(req)).rejects.toBeInstanceOf(BadRequestException);
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

    await expect(controller.upload(req)).resolves.toEqual({ id: 44, fileName: 'book.epub' });
    expect(ingestService.ingestUpload).toHaveBeenCalledWith('book.epub', expect.any(Readable));
    expect(service.getFile).toHaveBeenCalledWith(44);
  });

  it('bulk and finalize endpoints delegate payload fields as expected', async () => {
    const { controller, service, finalizeService, watcherService } = makeController();

    await controller.bulkDiscard({ fileIds: [1], selectAll: false, excludedIds: [2], status: 'error', search: 'x' });
    await controller.applyFetched({ fileIds: [1], selectAll: true, excludedIds: [2], status: 'ready', search: 'x' });
    await controller.retryFetch({ fileIds: [3], selectAll: false, excludedIds: [4], status: 'error', search: 'y' });
    await controller.setTarget({ fileIds: [5], selectAll: false, excludedIds: [6], targetLibraryId: undefined, targetFolderId: undefined });
    await controller.selectionSummary({ fileIds: [7], selectAll: false, excludedIds: [8] });
    await controller.bulkEdit({
      fileIds: [9],
      selectAll: false,
      excludedIds: [],
      fields: { title: 'Edited' },
      enabledFields: ['title'],
      mergeArrays: false,
    } as any);
    await controller.previewNames({ fileIds: [10], selectAll: false, excludedIds: [], defaultLibraryId: 2 } as any);
    await controller.finalize(
      { id: 99, isSuperuser: true } as any,
      { fileIds: [1], defaultLibraryId: 2, defaultFolderId: 3, selectAll: false, excludedIds: [], overrides: [] } as any,
    );
    await controller.rescan();

    expect(service.bulkSetTarget).toHaveBeenCalledWith([5], false, [6], null, null, undefined, undefined);
    expect(finalizeService.finalize).toHaveBeenCalledWith(99, true, [1], false, [], 2, 3, [], undefined, undefined);
    expect(watcherService.rescan).toHaveBeenCalled();
  });
});
