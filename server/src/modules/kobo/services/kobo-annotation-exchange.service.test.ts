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

function stillChanged(service: KoboAnnotationExchangeService) {
  return vi.spyOn(service, 'getContentAnnotations').mockResolvedValue({
    bookId: 2,
    etag: 'W/"2"',
    notModified: false,
    response: { annotations: [], nextPageOffsetToken: null },
    servedAck: { entries: [], tombstoneStateIds: [] },
    servedCount: 0,
    tombstoneCount: 0,
  });
}

describe('KoboAnnotationExchangeService.getChangedContentIds', () => {
  it('reports only books the device holds, once each, from annotation and bookmark changes', async () => {
    const { service, syncService } = makeService([2, 3]);
    stillChanged(service);

    await expect(
      service.getChangedContentIds(7, 11, [
        { ContentId: 'content-2', etag: 'W/"1"' },
        { ContentId: 'content-3', etag: 'W/"1"' },
      ]),
    ).resolves.toEqual(['content-2', 'content-3']);

    expect(syncService.findBookIdsOnDevice).toHaveBeenCalledWith(7, 11, [1, 2, 3]);
  });

  it('never reports a changed book the device did not list in its request', async () => {
    const { service } = makeService([2, 3]);
    stillChanged(service);

    await expect(service.getChangedContentIds(7, 11, [{ ContentId: 'content-2', etag: 'W/"1"' }])).resolves.toEqual(['content-2']);
    await expect(service.getChangedContentIds(7, 11)).resolves.toEqual([]);
  });

  it('reports nothing for changes on books the device never received', async () => {
    const { service, bookIdentityService } = makeService([]);

    await expect(service.getChangedContentIds(7, 11)).resolves.toEqual([]);

    expect(bookIdentityService.findByBookIds).not.toHaveBeenCalled();
  });

  it('acknowledges a delivered version only after the device reports its current etag', async () => {
    const { service } = makeService([2, 3]);
    const servedAck = { entries: [{ annotationId: 9, version: 2, externalKey: 'annotation-9', externalCreatedAt: null }], tombstoneStateIds: [] };
    const getContentAnnotations = vi.spyOn(service, 'getContentAnnotations').mockResolvedValue({
      bookId: 2,
      etag: 'W/"2"',
      notModified: true,
      servedAck,
      servedCount: 1,
      tombstoneCount: 0,
    });
    const markServedSeen = vi.spyOn(service, 'markServedSeen').mockResolvedValue();

    await expect(service.getChangedContentIds(7, 11, [{ ContentId: 'content-2', etag: 'W/"2"' }])).resolves.toEqual([]);

    expect(getContentAnnotations).toHaveBeenCalledWith(7, 'content-2', 11, 'W/"2"');
    expect(markServedSeen).toHaveBeenCalledWith(7, 11, servedAck);
  });

  it('keeps reporting a change when the device still reports its previous etag', async () => {
    const { service } = makeService([2]);
    vi.spyOn(service, 'getContentAnnotations').mockResolvedValue({
      bookId: 2,
      etag: 'W/"2"',
      notModified: false,
      response: { annotations: [], nextPageOffsetToken: null },
      servedAck: { entries: [], tombstoneStateIds: [] },
      servedCount: 0,
      tombstoneCount: 0,
    });
    const markServedSeen = vi.spyOn(service, 'markServedSeen').mockResolvedValue();

    await expect(service.getChangedContentIds(7, 11, [{ contentId: 'content-2', ETag: 'W/"1"' }])).resolves.toEqual(['content-2']);

    expect(markServedSeen).not.toHaveBeenCalled();
  });
});

describe('KoboAnnotationExchangeService chapter titles', () => {
  function makeTitler(title: string | null) {
    const epub = { chapterTitleForFile: vi.fn().mockResolvedValue(title) };
    const service = new KoboAnnotationExchangeService(
      ...(Array.from({ length: 11 }, () => ({})) as ConstructorParameters<typeof KoboAnnotationExchangeService>),
      epub as never,
    );
    const titleUnlistedChapters = (
      service as unknown as { titleUnlistedChapters(upserts: unknown[], file: { absolutePath: string; format: string | null }): Promise<void> }
    ).titleUnlistedChapters.bind(service);
    return { epub, titleUnlistedChapters };
  }
  const upsert = (chapterTitle: string | null, chapterFilename = 'Book_split_011.html') => ({
    kind: 'upsert',
    id: 'k1',
    deleted: false,
    type: 'highlight',
    color: 'yellow',
    text: 'yogurt',
    note: null,
    chapterTitle,
    location: { span: { chapterFilename, chapterTitle } },
    clientModifiedAt: new Date(),
  });

  it('takes the contents title for a chapter the Kobo named by its file', async () => {
    const { epub, titleUnlistedChapters } = makeTitler('part 3');
    const fromFile = upsert('Book_split_011.html');
    const dogear = upsert('Book_split_011.html');

    await titleUnlistedChapters([fromFile, dogear], { absolutePath: '/library/book.epub', format: 'epub' });

    expect(fromFile.chapterTitle).toBe('part 3');
    expect(dogear.chapterTitle).toBe('part 3');
    expect(epub.chapterTitleForFile).toHaveBeenCalledTimes(1);
    expect(epub.chapterTitleForFile).toHaveBeenCalledWith('/library/book.epub', 'Book_split_011.html');
  });

  it('keeps a real chapter title, and a file name the contents cannot replace', async () => {
    const titled = makeTitler('part 3');
    const real = upsert('Chapter V', 'text/part0015.html');
    await titled.titleUnlistedChapters([real], { absolutePath: '/library/book.epub', format: 'epub' });
    expect(real.chapterTitle).toBe('Chapter V');
    expect(titled.epub.chapterTitleForFile).not.toHaveBeenCalled();

    const untitled = makeTitler(null);
    const unlisted = upsert('Book_split_011.html');
    await untitled.titleUnlistedChapters([unlisted], { absolutePath: '/library/book.epub', format: 'epub' });
    expect(unlisted.chapterTitle).toBe('Book_split_011.html');
  });
});
