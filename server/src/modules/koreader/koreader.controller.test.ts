import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import { Permission } from '@bookorbit/types';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderController } from './koreader.controller';

function makeController() {
  const koreaderService = {
    saveProgress: vi.fn().mockResolvedValue({ document: 'abc', timestamp: 1 }),
    getProgress: vi.fn().mockResolvedValue({ document: 'abc', percentage: 0.5 }),
    createCredentials: vi.fn().mockResolvedValue(undefined),
    updateCredentials: vi.fn().mockResolvedValue(undefined),
    deleteCredentials: vi.fn().mockResolvedValue(undefined),
    getCredentials: vi.fn().mockResolvedValue({ username: 'reader', syncEnabled: true, createdAt: '2026-01-01' }),
    getSyncStatus: vi.fn().mockResolvedValue({ credentials: null }),
    getDevices: vi.fn().mockResolvedValue([]),
    getKoreaderUserDefaultPattern: vi.fn().mockResolvedValue('{authors}/{title}'),
    setKoreaderUserDefaultPattern: vi.fn().mockResolvedValue(undefined),
    setDeviceFileNamingPattern: vi.fn().mockResolvedValue(undefined),
    clearDeviceFileNamingPattern: vi.fn().mockResolvedValue(undefined),
    removeDevice: vi.fn().mockResolvedValue(undefined),
    getBookProgress: vi.fn().mockResolvedValue(null),
    testConnection: vi.fn().mockResolvedValue(true),
  };
  const hashLinkService = {
    listUnmatchedBooks: vi.fn().mockResolvedValue([]),
    linkUnmatchedBook: vi.fn().mockResolvedValue({ hash: 'a'.repeat(32), bookId: 1, bookFileId: 2 }),
    dismissUnmatchedBook: vi.fn().mockResolvedValue({ hash: 'a'.repeat(32) }),
    dismissAllUnmatchedBooks: vi.fn().mockResolvedValue({ count: 3 }),
    listManualHashLinks: vi.fn().mockResolvedValue([]),
    relinkManualHashLink: vi.fn().mockResolvedValue({ hash: 'a'.repeat(32), bookId: 1, bookFileId: 2 }),
    unlinkManualHashLink: vi.fn().mockResolvedValue({ hash: 'a'.repeat(32) }),
  };
  const packageService = {
    buildPluginPackage: vi.fn().mockResolvedValue(Buffer.from('fake-zip-content')),
  };

  return {
    controller: new KoreaderController(koreaderService as never, hashLinkService as never, packageService as never),
    koreaderService,
    hashLinkService,
    packageService,
  };
}

describe('KoreaderController', () => {
  it('uses the KOReader auth guard and marks itself public only on kosync protocol routes', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, KoreaderController.prototype.authenticateKoreader)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, KoreaderController.prototype.authenticateKoreader)).toEqual([KoreaderAuthGuard]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, KoreaderController.prototype.saveProgress)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, KoreaderController.prototype.saveProgress)).toEqual([KoreaderAuthGuard]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, KoreaderController.prototype.getProgress)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, KoreaderController.prototype.getProgress)).toEqual([KoreaderAuthGuard]);

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, KoreaderController.prototype.getSyncStatus)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, KoreaderController.prototype.getSyncStatus)).toBe(Permission.KoreaderSync);
    expect(Reflect.getMetadata(PERMISSION_KEY, KoreaderController.prototype.listUnmatchedBooks)).toBe(Permission.KoreaderSync);
    expect(Reflect.getMetadata(PERMISSION_KEY, KoreaderController.prototype.unlinkManualHashLink)).toBe(Permission.KoreaderSync);
  });

  it('registerKoreader always rejects plugin self-registration', () => {
    const { controller } = makeController();

    expect(() => controller.registerKoreader()).toThrow('Registration disabled. Create credentials in BookOrbit settings.');
  });

  it('forwards kosync protocol routes to the service', async () => {
    const { controller, koreaderService } = makeController();
    const user = { id: 7 } as never;

    expect(controller.authenticateKoreader('reader')).toEqual({ authorized: 'OK', username: 'reader' });

    const progressDto = { document: 'abc', percentage: 0.5 } as never;
    await controller.saveProgress(user, progressDto);
    expect(koreaderService.saveProgress).toHaveBeenCalledWith(7, progressDto);

    await expect(controller.getProgress(user, 'abc')).resolves.toEqual({ document: 'abc', percentage: 0.5 });
    expect(koreaderService.getProgress).toHaveBeenCalledWith(7, 'abc');
  });

  it('returns an empty object when no progress is found for a document', async () => {
    const { controller, koreaderService } = makeController();
    koreaderService.getProgress.mockResolvedValue(null);

    await expect(controller.getProgress({ id: 7 } as never, 'abc')).resolves.toEqual({});
  });

  it('forwards credential management routes to the service', async () => {
    const { controller, koreaderService } = makeController();
    const user = { id: 7 } as never;

    await expect(controller.createCredentials(user, { username: 'reader', password: 'secret1' } as never)).resolves.toEqual({ success: true });
    expect(koreaderService.createCredentials).toHaveBeenCalledWith(7, 'reader', 'secret1');

    await expect(controller.updateCredentials(user, { syncEnabled: false } as never)).resolves.toEqual({ success: true });
    expect(koreaderService.updateCredentials).toHaveBeenCalledWith(7, { syncEnabled: false });

    await expect(controller.deleteCredentials(user)).resolves.toEqual({ success: true });
    expect(koreaderService.deleteCredentials).toHaveBeenCalledWith(7);

    await expect(controller.getCredentials(user)).resolves.toEqual({ username: 'reader', syncEnabled: true, createdAt: '2026-01-01' });
    expect(koreaderService.getCredentials).toHaveBeenCalledWith(7);
  });

  it('forwards sync status, devices, and book progress routes to the service', async () => {
    const { controller, koreaderService } = makeController();
    const user = { id: 7 } as never;

    await expect(controller.getSyncStatus(user)).resolves.toEqual({ credentials: null });
    expect(koreaderService.getSyncStatus).toHaveBeenCalledWith(7);

    await expect(controller.getDevices(user)).resolves.toEqual([]);
    expect(koreaderService.getDevices).toHaveBeenCalledWith(7);

    await expect(controller.getBookProgress(user, 10)).resolves.toBeNull();
    expect(koreaderService.getBookProgress).toHaveBeenCalledWith(7, 10);
  });

  it('scopes KOReader default pattern reads and writes to the authenticated user', async () => {
    const { controller, koreaderService } = makeController();
    const user = { id: 7 } as never;

    await expect(controller.getFileNamingPattern(user)).resolves.toEqual({ pattern: '{authors}/{title}' });
    expect(koreaderService.getKoreaderUserDefaultPattern).toHaveBeenCalledWith(7);

    await expect(controller.setFileNamingPattern(user, { pattern: '{title}' } as never)).resolves.toEqual({ pattern: '{title}' });
    expect(koreaderService.setKoreaderUserDefaultPattern).toHaveBeenCalledWith(7, '{title}');
  });

  it('forwards device file naming updates and clears to the service', async () => {
    const { controller, koreaderService } = makeController();
    const user = { id: 7 } as never;
    const dto = { pattern: '{title}', seriesPattern: '{series}/{title}', standalonePattern: 'Standalone/{title}' } as never;

    await expect(controller.setDeviceFileNamingPattern(user, { deviceId: 'device-one' }, dto)).resolves.toBe(dto);
    expect(koreaderService.setDeviceFileNamingPattern).toHaveBeenCalledWith(7, 'device-one', {
      fileNamingPattern: '{title}',
      seriesFileNamingPattern: '{series}/{title}',
      standaloneFileNamingPattern: 'Standalone/{title}',
    });

    await expect(controller.clearDeviceFileNamingPattern(user, { deviceId: 'device-one' })).resolves.toEqual({ success: true });
    expect(koreaderService.clearDeviceFileNamingPattern).toHaveBeenCalledWith(7, 'device-one');
  });

  it('forwards device removal requests to the service', async () => {
    const { controller, koreaderService } = makeController();
    const user = { id: 7 } as never;

    await expect(controller.removeDevice(user, { deviceId: 'device-1' })).resolves.toEqual({ success: true });
    expect(koreaderService.removeDevice).toHaveBeenCalledWith(7, 'device-1');
  });

  it('grants Koreader Sync permission for the device removal route', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, KoreaderController.prototype.removeDevice)).toBe(Permission.KoreaderSync);
  });

  it('grants Koreader Sync permission for the unmatched-book dismiss route', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, KoreaderController.prototype.dismissUnmatchedBook)).toBe(Permission.KoreaderSync);
  });

  it('grants Koreader Sync permission for the unmatched-book bulk dismiss route', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, KoreaderController.prototype.dismissAllUnmatchedBooks)).toBe(Permission.KoreaderSync);
  });

  it('forwards unmatched-book and manual hash link routes to the hash link service', async () => {
    const { controller, hashLinkService } = makeController();
    const user = { id: 7 } as never;
    const hash = 'a'.repeat(32);

    await expect(controller.listUnmatchedBooks(user)).resolves.toEqual([]);
    expect(hashLinkService.listUnmatchedBooks).toHaveBeenCalledWith(user);

    await expect(controller.linkUnmatchedBook(user, hash, { bookId: 55 } as never)).resolves.toEqual({ hash, bookId: 1, bookFileId: 2 });
    expect(hashLinkService.linkUnmatchedBook).toHaveBeenCalledWith(user, hash, 55);

    await expect(controller.dismissUnmatchedBook(user, hash)).resolves.toEqual({ hash });
    expect(hashLinkService.dismissUnmatchedBook).toHaveBeenCalledWith(user, hash);

    await expect(controller.dismissAllUnmatchedBooks(user)).resolves.toEqual({ count: 3 });
    expect(hashLinkService.dismissAllUnmatchedBooks).toHaveBeenCalledWith(user);

    await expect(controller.listManualHashLinks(user)).resolves.toEqual([]);
    expect(hashLinkService.listManualHashLinks).toHaveBeenCalledWith(user);

    await expect(controller.relinkManualHashLink(user, hash, { bookId: 66 } as never)).resolves.toEqual({ hash, bookId: 1, bookFileId: 2 });
    expect(hashLinkService.relinkManualHashLink).toHaveBeenCalledWith(user, hash, 66);

    await expect(controller.unlinkManualHashLink(user, hash)).resolves.toEqual({ hash });
    expect(hashLinkService.unlinkManualHashLink).toHaveBeenCalledWith(user, hash);
  });

  it('downloads the preconfigured plugin package with the expected headers', async () => {
    const { controller, packageService } = makeController();
    const user = { id: 7 } as never;
    const reply = { header: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await controller.downloadPluginPackage(user, { origin: 'https://bookorbit.example' } as never, reply);

    expect(packageService.buildPluginPackage).toHaveBeenCalledWith(7, 'https://bookorbit.example');
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/zip');
    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="bookorbit.koplugin.zip"');
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('fake-zip-content'));
  });

  it('forwards test-connection requests and reports the plugin server URL', async () => {
    const { controller, koreaderService } = makeController();
    const user = { id: 7 } as never;

    await expect(controller.testConnection(user, { username: 'reader', password: 'secret1' } as never)).resolves.toEqual({
      success: true,
      username: 'reader',
      serverUrl: '/api/v1/koreader',
    });
    expect(koreaderService.testConnection).toHaveBeenCalledWith(7, 'reader', 'secret1');
  });
});
