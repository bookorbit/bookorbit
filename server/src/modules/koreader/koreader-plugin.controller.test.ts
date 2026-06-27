import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it, vi } from 'vitest';

import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderPluginController } from './koreader-plugin.controller';

function makeController() {
  const pluginService = {
    matchCheck: vi.fn().mockResolvedValue({ matches: [], libraryVersion: 'v1' }),
    uploadBookStates: vi.fn().mockResolvedValue({ results: [], unmatched: [] }),
    bulkProgress: vi.fn().mockResolvedValue({ results: [], unmatched: [] }),
    sweepComplete: vi.fn().mockResolvedValue({ ok: true, lastSweepAt: '2026-01-01', libraryVersion: 'v1' }),
  };
  const statsService = {
    uploadPageStats: vi.fn().mockResolvedValue({ uploaded: 1 }),
  };
  const annotationService = {
    uploadAnnotations: vi.fn().mockResolvedValue({ uploaded: 1 }),
  };
  const annotationExchangeService = {
    exchange: vi.fn().mockResolvedValue({ books: [] }),
    exchangeAck: vi.fn().mockResolvedValue({ ok: true }),
  };
  const packageService = {
    getVersionInfo: vi.fn().mockResolvedValue({ pluginVersion: '0.4.0', serverVersion: '1.0.0' }),
    buildPluginPackage: vi.fn().mockResolvedValue(Buffer.from('fake-zip-content')),
    buildRawPluginPackage: vi.fn().mockResolvedValue(Buffer.from('fake-zip-content')),
  };

  return {
    controller: new KoreaderPluginController(
      pluginService as never,
      statsService as never,
      annotationService as never,
      annotationExchangeService as never,
      packageService as never,
    ),
    pluginService,
    statsService,
    annotationService,
    annotationExchangeService,
    packageService,
  };
}

describe('KoreaderPluginController', () => {
  it('is public for the global JWT guard and uses the KOReader auth guard', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, KoreaderPluginController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, KoreaderPluginController)).toEqual([KoreaderAuthGuard]);
  });

  it('matchCheck delegates to plugin service', async () => {
    const { controller, pluginService } = makeController();
    const user = { id: 7 } as never;
    const dto = { deviceId: 'abc123', deviceModel: 'Kobo', pluginVersion: '0.4.0', hashes: ['aabbccdd'] } as never;

    await controller.matchCheck(user, dto);

    expect(pluginService.matchCheck).toHaveBeenCalledWith(user, dto);
  });

  it('uploadPageStats delegates to stats service', async () => {
    const { controller, statsService } = makeController();
    const user = { id: 7 } as never;
    const dto = {} as never;

    await controller.uploadPageStats(user, dto);

    expect(statsService.uploadPageStats).toHaveBeenCalledWith(user, dto);
  });

  it('uploadAnnotations delegates to annotation service', async () => {
    const { controller, annotationService } = makeController();
    const user = { id: 7 } as never;
    const dto = {} as never;

    await controller.uploadAnnotations(user, dto);

    expect(annotationService.uploadAnnotations).toHaveBeenCalledWith(user, dto);
  });

  it('exchangeAnnotations delegates to annotation exchange service', async () => {
    const { controller, annotationExchangeService } = makeController();
    const user = { id: 7 } as never;
    const dto = {} as never;

    await controller.exchangeAnnotations(user, dto);

    expect(annotationExchangeService.exchange).toHaveBeenCalledWith(user, dto);
  });

  it('exchangeAnnotationsAck delegates to annotation exchange service', async () => {
    const { controller, annotationExchangeService } = makeController();
    const user = { id: 7 } as never;
    const dto = {} as never;

    await controller.exchangeAnnotationsAck(user, dto);

    expect(annotationExchangeService.exchangeAck).toHaveBeenCalledWith(user, dto);
  });

  it('uploadBookStates delegates to plugin service', async () => {
    const { controller, pluginService } = makeController();
    const user = { id: 7 } as never;
    const dto = {} as never;

    await controller.uploadBookStates(user, dto);

    expect(pluginService.uploadBookStates).toHaveBeenCalledWith(user, dto);
  });

  it('bulkProgress delegates to plugin service', async () => {
    const { controller, pluginService } = makeController();
    const user = { id: 7 } as never;
    const dto = {} as never;

    await controller.bulkProgress(user, dto);

    expect(pluginService.bulkProgress).toHaveBeenCalledWith(user, dto);
  });

  it('sweepComplete delegates to plugin service', async () => {
    const { controller, pluginService } = makeController();
    const user = { id: 7 } as never;
    const dto = {} as never;

    await controller.sweepComplete(user, dto);

    expect(pluginService.sweepComplete).toHaveBeenCalledWith(user, dto);
  });

  it('getVersion returns plugin and server versions from package service', async () => {
    const { controller, packageService } = makeController();

    const result = await controller.getVersion();

    expect(packageService.getVersionInfo).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ pluginVersion: '0.4.0', serverVersion: '1.0.0' });
  });

  it('downloadUpdatePackage builds a raw package and streams it with correct headers', async () => {
    const { controller, packageService } = makeController();
    const user = { id: 7 } as never;
    const reply = { header: vi.fn().mockReturnThis(), send: vi.fn() } as never;

    await controller.downloadUpdatePackage(user, reply);

    expect(packageService.buildRawPluginPackage).toHaveBeenCalledWith(7);
    expect(packageService.buildPluginPackage).not.toHaveBeenCalled();
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'application/zip');
    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="bookorbit.koplugin.zip"');
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('fake-zip-content'));
  });
});
