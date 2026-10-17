import { describe, expect, it, vi } from 'vitest';

import { KoboAnnotationExchangeService } from './kobo-annotation-exchange.service';

function makeService(onDevice: number[]) {
  const annotationSync = { listPendingKoboChangeBookIds: vi.fn().mockResolvedValue([1, 2]) };
  const bookIdentityService = {
    findByBookIds: vi.fn((_userId: number, bookIds: number[]) =>
      Promise.resolve(new Map(bookIds.map((id) => [id, { entitlementId: `content-${id}` }]))),
    ),
  };
  const bookmarkLinks = { findBookIdsWithRemovedBookmarks: vi.fn().mockResolvedValue([2, 3]) };
  const syncService = {
    findBookIdsOnDevice: vi.fn((_userId: number, _deviceId: number, bookIds: number[]) =>
      Promise.resolve(bookIds.filter((id) => onDevice.includes(id))),
    ),
  };
  const service = new KoboAnnotationExchangeService(
    annotationSync as never,
    bookIdentityService as never,
    {} as never,
    {} as never,
    { version: 1 } as never,
    { getSettings: vi.fn().mockResolvedValue({ syncBookOrbitAnnotationsToKobo: false }) } as never,
    {} as never,
    bookmarkLinks as never,
    syncService as never,
  );
  return { service, syncService, bookIdentityService };
}

describe('KoboAnnotationExchangeService.getChangedContentIds', () => {
  it('reports only books the device holds, once each, from annotation and bookmark changes', async () => {
    const { service, syncService } = makeService([2, 3]);

    await expect(service.getChangedContentIds(7, 11)).resolves.toEqual(['content-2', 'content-3']);

    expect(syncService.findBookIdsOnDevice).toHaveBeenCalledWith(7, 11, [1, 2, 3]);
  });

  it('reports nothing for changes on books the device never received', async () => {
    const { service, bookIdentityService } = makeService([]);

    await expect(service.getChangedContentIds(7, 11)).resolves.toEqual([]);

    expect(bookIdentityService.findByBookIds).not.toHaveBeenCalled();
  });
});
