import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import { Permission } from '@bookorbit/types';

import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
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
    getCoverPath: vi.fn(),
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
  const appSettings = {
    getMaxUploadSizeMb: vi.fn().mockResolvedValue(500),
    getBookDockSettings: vi.fn(),
    updateBookDockSettings: vi.fn(),
  };

  const controller = new BookDockController(
    service as never,
    ingestService as never,
    finalizeService as never,
    watcherService as never,
    appSettings as never,
  );

  return { controller, service, ingestService, finalizeService, watcherService, appSettings };
}

const MOCK_USER = { id: 1, isSuperuser: false, permissions: [Permission.BookDockAccess] } as any;

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
      canManageAll: false,
    });
  });

  it('getCover throws when file has no cover path or cover file does not exist', async () => {
    const { controller, service } = makeController();
    const reply = { header: vi.fn(), send: vi.fn() } as any;

    service.getCoverPath.mockRejectedValueOnce(new NotFoundException('No cover available'));
    await expect(controller.getCover(MOCK_USER, 1, reply)).rejects.toBeInstanceOf(NotFoundException);

    service.getCoverPath.mockResolvedValueOnce('/covers/1.jpg');
    vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'));
    await expect(controller.getCover(MOCK_USER, 1, reply)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getCover streams cover bytes with proper headers', async () => {
    const { controller, service } = makeController();
    service.getCoverPath.mockResolvedValue('/covers/1.jpg');
    vi.mocked(access).mockResolvedValue(undefined as never);
    const reply = {
      header: vi.fn().mockReturnThis(),
      send: vi.fn(),
    } as any;

    await controller.getCover(MOCK_USER, 1, reply);

    expect(service.getCoverPath).toHaveBeenCalledWith(1, MOCK_USER.id, false);
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
    expect(service.getFile).toHaveBeenCalledWith(44, MOCK_USER.id, false);
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
      { id: 99, isSuperuser: true, permissions: [] } as any,
      { fileIds: [1], defaultLibraryId: 2, defaultFolderId: 3, selectAll: false, excludedIds: [], overrides: [] } as any,
    );
    await controller.rescan();
    await controller.pause();
    await controller.resume();

    expect(service.bulkSetTarget).toHaveBeenCalledWith([5], false, [6], null, null, undefined, undefined, MOCK_USER.id, false, undefined);
    expect(finalizeService.previewNames).toHaveBeenCalledWith([10], false, [], 2, MOCK_USER.id, false, undefined, undefined, undefined);
    expect(finalizeService.previewFinalize).toHaveBeenCalledWith(1, false, false, [10], false, [], 2, 3, [], undefined, undefined, undefined);
    expect(finalizeService.discardDuplicateCandidates).toHaveBeenCalledWith(
      1,
      false,
      false,
      [10],
      false,
      [],
      2,
      3,
      [],
      undefined,
      undefined,
      undefined,
    );
    expect(finalizeService.finalize).toHaveBeenCalledWith(99, true, true, [1], false, [], 2, 3, [], undefined, undefined, undefined);
    expect(watcherService.rescan).toHaveBeenCalled();
    expect(service.pauseProcessing).toHaveBeenCalledTimes(1);
    expect(service.resumeProcessing).toHaveBeenCalledTimes(1);
  });

  it('reads and updates Book Dock settings through the scoped service methods', async () => {
    const { controller, appSettings } = makeController();
    const settings = {
      bookDockPath: '/data/book-dock',
      autoFetchMetadata: true,
      autoFinalizeEnabled: false,
      autoFinalizeThreshold: 85,
      autoFinalizeLibraryId: null,
      autoFinalizeFolderId: null,
      autoFinalizeMetadataMode: 'safe_merge' as const,
    };
    const update = { ...settings };
    delete (update as Partial<typeof settings>).bookDockPath;
    appSettings.getBookDockSettings.mockResolvedValue(settings);
    appSettings.updateBookDockSettings.mockResolvedValue(settings);

    await expect(controller.getSettings()).resolves.toEqual(settings);
    await expect(controller.updateSettings(update as any)).resolves.toEqual(settings);

    expect(appSettings.getBookDockSettings).toHaveBeenCalledOnce();
    expect(appSettings.updateBookDockSettings).toHaveBeenCalledWith(update);
  });

  it('marks bulk edit endpoint as demo-restricted', () => {
    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, BookDockController.prototype.bulkEdit)).toEqual({
      permission: Permission.DemoRestricted,
      message: 'Demo-restricted account cannot perform bulk edits',
    });
    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, BookDockController.prototype.finalize)).toBeUndefined();
  });

  it('requires upload permission for finalization and management permission for global controls', () => {
    const finalizationPermissions = [Permission.BookDockAccess, Permission.LibraryUpload];

    expect(Reflect.getMetadata(PERMISSION_KEY, BookDockController.prototype.previewFinalize)).toEqual(finalizationPermissions);
    expect(Reflect.getMetadata(PERMISSION_KEY, BookDockController.prototype.discardFinalizeDuplicates)).toEqual(finalizationPermissions);
    expect(Reflect.getMetadata(PERMISSION_KEY, BookDockController.prototype.finalize)).toEqual(finalizationPermissions);
    expect(Reflect.getMetadata(PERMISSION_KEY, BookDockController.prototype.pause)).toBe(Permission.ManageBookDock);
    expect(Reflect.getMetadata(PERMISSION_KEY, BookDockController.prototype.resume)).toBe(Permission.ManageBookDock);
    expect(Reflect.getMetadata(PERMISSION_KEY, BookDockController.prototype.rescan)).toBe(Permission.ManageBookDock);
    expect(Reflect.getMetadata(PERMISSION_KEY, BookDockController.prototype.getSettings)).toBe(Permission.ManageBookDock);
    expect(Reflect.getMetadata(PERMISSION_KEY, BookDockController.prototype.updateSettings)).toBe(Permission.ManageBookDock);
  });

  it('grants global scope only to superusers and Book Dock managers', async () => {
    const { controller, service } = makeController();
    service.getSummary.mockResolvedValue({});

    await controller.getSummary(MOCK_USER);
    await controller.getSummary({ ...MOCK_USER, permissions: [Permission.BookDockAccess, Permission.ManageBookDock] });
    await controller.getSummary({ ...MOCK_USER, isSuperuser: true, permissions: [] });

    expect(service.getSummary).toHaveBeenNthCalledWith(1, MOCK_USER.id, false);
    expect(service.getSummary).toHaveBeenNthCalledWith(2, MOCK_USER.id, true);
    expect(service.getSummary).toHaveBeenNthCalledWith(3, MOCK_USER.id, true);
  });
});
